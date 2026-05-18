-- =============================================
-- fix_phase4_2_execute_import_run_status_cast
-- Corrige el cast del enum import_run_status en
-- el cierre de execute_beneficiary_contacts_import.
-- =============================================

create or replace function public.execute_beneficiary_contacts_import(
	p_source_filename text,
	p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_run_id uuid := gen_random_uuid();
	v_now timestamptz := now();
	v_created_rows integer := 0;
	v_updated_rows integer := 0;
	v_skipped_rows integer := 0;
	v_warning_rows integer := 0;
	v_error_rows integer := 0;
	v_source_filename text := nullif(btrim(coalesce(p_source_filename, '')), '');
	v_eval record;
	v_actual_beneficiary_id uuid;
	v_actual_contact_id uuid;
	v_duplicate_contact_id uuid;
	v_created_beneficiary_ids jsonb := '{}'::jsonb;
	v_rut_normalized text;
	v_beneficiary_name text;
	v_phone_normalized text;
	v_phone_raw text;
	v_contact_type public.contact_type;
	v_is_primary boolean;
	v_effective_status public.import_row_result_status;
	v_effective_message text;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para ejecutar importaciones';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if v_requester_role not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden importar beneficiarios';
	end if;

	if v_source_filename is null then
		raise exception 'El nombre del archivo es obligatorio';
	end if;

	insert into public.import_runs (
		id,
		created_by,
		import_type,
		source_filename,
		status,
		total_rows,
		metadata
	)
	values (
		v_run_id,
		v_requester_id,
		'beneficiary_contacts',
		v_source_filename,
		'processing',
		jsonb_array_length(p_rows),
		jsonb_build_object('previewedAt', v_now)
	);

	for v_eval in
		select *
		from public.evaluate_beneficiary_contacts_import_rows(p_rows)
	loop
		v_actual_beneficiary_id := v_eval.beneficiary_id;
		v_actual_contact_id := v_eval.contact_id;
		v_effective_status := v_eval.result_status;
		v_effective_message := v_eval.message;

		if v_eval.result_status = 'error' then
			v_error_rows := v_error_rows + 1;
		elsif v_eval.result_status = 'skipped' then
			v_skipped_rows := v_skipped_rows + 1;
		else
			v_rut_normalized := nullif(v_eval.normalized_payload->>'rutNormalized', '');
			v_beneficiary_name := nullif(v_eval.normalized_payload->>'beneficiaryName', '');
			v_phone_normalized := nullif(v_eval.normalized_payload->>'phoneNormalized', '');
			v_phone_raw := nullif(v_eval.raw_payload->>'telefono', '');
			v_contact_type := (v_eval.normalized_payload->>'contactType')::public.contact_type;
			v_is_primary := coalesce((v_eval.normalized_payload->>'isPrimary')::boolean, false);

			if v_actual_beneficiary_id is null and v_created_beneficiary_ids ? v_rut_normalized then
				v_actual_beneficiary_id := nullif(v_created_beneficiary_ids->>v_rut_normalized, '')::uuid;
			end if;

			if v_actual_beneficiary_id is null then
				insert into public.beneficiaries (
					rut_raw,
					rut_normalized,
					full_name,
					status,
					created_by,
					updated_by,
					created_at,
					updated_at
				)
				values (
					v_eval.raw_payload->>'rut',
					v_rut_normalized,
					v_beneficiary_name,
					'active',
					v_requester_id,
					v_requester_id,
					v_now,
					v_now
				)
				returning id into v_actual_beneficiary_id;

				v_created_beneficiary_ids := v_created_beneficiary_ids || jsonb_build_object(v_rut_normalized, v_actual_beneficiary_id);
			elsif v_eval.should_update_beneficiary_name and v_beneficiary_name is not null then
				update public.beneficiaries
				set
					full_name = v_beneficiary_name,
					updated_by = v_requester_id,
					updated_at = v_now
				where id = v_actual_beneficiary_id
					and public.normalize_person_name(full_name) is null;
			end if;

			if v_is_primary then
				update public.beneficiary_contacts
				set
					is_active = false,
					is_primary = false,
					updated_at = v_now
				where beneficiary_id = v_actual_beneficiary_id
					and is_active is true
					and is_primary is true
					and phone_normalized is distinct from v_phone_normalized;
			end if;

			select bc.id
			into v_duplicate_contact_id
			from public.beneficiary_contacts as bc
			where bc.beneficiary_id = v_actual_beneficiary_id
				and bc.phone_normalized = v_phone_normalized
			order by bc.created_at desc
			limit 1;

			if v_duplicate_contact_id is not null then
				v_actual_contact_id := v_duplicate_contact_id;
				v_effective_status := 'skipped';
				v_effective_message := 'Contacto duplicado detectado durante la ejecucion; no se creo un nuevo registro';
				v_skipped_rows := v_skipped_rows + 1;
			else
				insert into public.beneficiary_contacts (
					beneficiary_id,
					contact_type,
					contact_name,
					relationship,
					phone_raw,
					phone_normalized,
					is_primary,
					is_active,
					counts_as_valid_followup,
					notes,
					created_at,
					updated_at
				)
				values (
					v_actual_beneficiary_id,
					v_contact_type,
					null,
					case when v_contact_type = 'support_network' then 'Red de apoyo importada' else null end,
					v_phone_raw,
					v_phone_normalized,
					v_is_primary,
					true,
					true,
					'Importado desde archivo ' || v_source_filename,
					v_now,
					v_now
				)
				returning id into v_actual_contact_id;

				case v_effective_status
					when 'created' then
						v_created_rows := v_created_rows + 1;
					when 'updated' then
						v_updated_rows := v_updated_rows + 1;
					when 'warning' then
						v_warning_rows := v_warning_rows + 1;
					else
						null;
				end case;
			end if;
		end if;

		insert into public.import_run_rows (
			import_run_id,
			row_number,
			raw_payload,
			normalized_payload,
			result_status,
			message,
			beneficiary_id,
			beneficiary_contact_id,
			created_at
		)
		values (
			v_run_id,
			v_eval.row_number,
			v_eval.raw_payload,
			v_eval.normalized_payload,
			v_effective_status,
			v_effective_message,
			v_actual_beneficiary_id,
			v_actual_contact_id,
			v_now
		);
	end loop;

	update public.import_runs
	set
		status = case when v_error_rows > 0 then 'processed_with_errors'::public.import_run_status else 'processed'::public.import_run_status end,
		created_rows = v_created_rows,
		updated_rows = v_updated_rows,
		skipped_rows = v_skipped_rows,
		warning_rows = v_warning_rows,
		error_rows = v_error_rows,
		finished_at = now(),
		metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
			'executedAt', now(),
			'importType', 'beneficiary_contacts'
		)
	where id = v_run_id;

	return (
		with rows as (
			select coalesce(
				jsonb_agg(
					jsonb_build_object(
						'rowNumber', irr.row_number,
						'rawPayload', irr.raw_payload,
						'normalizedPayload', irr.normalized_payload,
						'resultStatus', irr.result_status,
						'message', irr.message,
						'beneficiaryId', irr.beneficiary_id,
						'contactId', irr.beneficiary_contact_id
					)
					order by irr.row_number
				),
				'[]'::jsonb
			) as payload
			from public.import_run_rows as irr
			where irr.import_run_id = v_run_id
		)
		select jsonb_build_object(
			'runId', v_run_id,
			'sourceFilename', v_source_filename,
			'status', case when v_error_rows > 0 then 'processed_with_errors' else 'processed' end,
			'summary', jsonb_build_object(
				'totalRows', jsonb_array_length(p_rows),
				'createdRows', v_created_rows,
				'updatedRows', v_updated_rows,
				'skippedRows', v_skipped_rows,
				'warningRows', v_warning_rows,
				'errorRows', v_error_rows
			),
			'rows', rows.payload
		)
		from rows
	);
end;
$$;

comment on function public.execute_beneficiary_contacts_import(text, jsonb)
	is 'Persiste el import de beneficiarios/contactos y registra trazabilidad completa por corrida y fila.';
