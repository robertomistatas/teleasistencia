-- =============================================
-- phase4_2_beneficiary_contacts_import
-- Importacion controlada de beneficiarios y
-- contactos desde archivo Excel con preview,
-- trazabilidad y ejecucion segura por RPC.
-- =============================================

create type public.import_type as enum (
	'beneficiary_contacts'
);

create type public.import_row_result_status as enum (
	'created',
	'updated',
	'skipped',
	'warning',
	'error'
);

create table public.import_runs (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	created_by uuid not null references public.profiles (id) on delete restrict,
	import_type public.import_type not null,
	source_filename text not null,
	status public.import_run_status not null default 'uploaded',
	total_rows integer not null default 0 check (total_rows >= 0),
	created_rows integer not null default 0 check (created_rows >= 0),
	updated_rows integer not null default 0 check (updated_rows >= 0),
	skipped_rows integer not null default 0 check (skipped_rows >= 0),
	warning_rows integer not null default 0 check (warning_rows >= 0),
	error_rows integer not null default 0 check (error_rows >= 0),
	metadata jsonb not null default '{}'::jsonb,
	notes text,
	finished_at timestamptz
);

create table public.import_run_rows (
	id uuid primary key default gen_random_uuid(),
	import_run_id uuid not null references public.import_runs (id) on delete cascade,
	row_number integer not null check (row_number > 0),
	raw_payload jsonb not null default '{}'::jsonb,
	normalized_payload jsonb not null default '{}'::jsonb,
	result_status public.import_row_result_status not null,
	message text not null,
	beneficiary_id uuid references public.beneficiaries (id) on delete set null,
	beneficiary_contact_id uuid references public.beneficiary_contacts (id) on delete set null,
	created_at timestamptz not null default now(),
	unique (import_run_id, row_number)
);

create index idx_import_runs_created_at_desc
	on public.import_runs (created_at desc);

create index idx_import_runs_created_by
	on public.import_runs (created_by);

create index idx_import_runs_import_type
	on public.import_runs (import_type);

create index idx_import_runs_status
	on public.import_runs (status);

create index idx_import_run_rows_import_run_id
	on public.import_run_rows (import_run_id);

create index idx_import_run_rows_result_status
	on public.import_run_rows (result_status);

create index idx_import_run_rows_beneficiary_id
	on public.import_run_rows (beneficiary_id);

create index idx_import_run_rows_beneficiary_contact_id
	on public.import_run_rows (beneficiary_contact_id);

alter table public.import_runs enable row level security;
alter table public.import_run_rows enable row level security;

create policy "import_runs_select_admin_super_admin"
	on public.import_runs
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "import_run_rows_select_admin_super_admin"
	on public.import_run_rows
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create or replace function public.normalize_person_name(input text)
returns text
language sql
immutable
as $$
	select nullif(regexp_replace(btrim(coalesce(input, '')), '\s+', ' ', 'g'), '');
$$;

create or replace function public.normalize_import_contact_type(input text)
returns text
language plpgsql
immutable
as $$
declare
	v_value text := lower(coalesce(input, ''));
begin
	v_value := translate(v_value, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU');
	v_value := regexp_replace(v_value, '[^a-z0-9]+', '', 'g');

	if v_value = 'principal' or v_value = 'telefono' or v_value = 'telefonoprincipal' then
		return 'principal';
	end if;

	if v_value in ('redapoyo', 'reddeapoyo', 'supportnetwork', 'contactofamiliar', 'contactoemergencia', 'familiar', 'emergencia') then
		return 'red_apoyo';
	end if;

	return null;
end;
$$;

create or replace function public.evaluate_beneficiary_contacts_import_rows(
	p_rows jsonb
)
returns table (
	row_number integer,
	raw_payload jsonb,
	normalized_payload jsonb,
	result_status public.import_row_result_status,
	message text,
	beneficiary_id uuid,
	contact_id uuid,
	should_create_beneficiary boolean,
	should_update_beneficiary_name boolean,
	should_create_contact boolean,
	should_replace_primary boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_item jsonb;
	v_index integer := 0;
	v_row_number integer;
	v_raw_payload jsonb;
	v_normalized_payload jsonb;
	v_result_status public.import_row_result_status;
	v_message text;
	v_beneficiary_id uuid;
	v_contact_id uuid;
	v_should_create_beneficiary boolean;
	v_should_update_beneficiary_name boolean;
	v_should_create_contact boolean;
	v_should_replace_primary boolean;
	v_rut_raw text;
	v_rut_normalized text;
	v_name_raw text;
	v_name_normalized text;
	v_phone_raw text;
	v_phone_normalized text;
	v_type_raw text;
	v_import_contact_type text;
	v_contact_type public.contact_type;
	v_is_primary boolean;
	v_existing_name text;
	v_effective_name text;
	v_active_primary_phone text;
	v_beneficiary_created_in_file boolean;
	v_existing_contact_id uuid;
	v_shared_phone_owner_rut text;
	v_shared_phone_exists boolean;
	v_errors text[];
	v_warnings text[];
	v_base_message text;
	v_contact_key text;
	v_state jsonb;
	v_state_by_rut jsonb := '{}'::jsonb;
	v_phone_owner_by_phone jsonb := '{}'::jsonb;
	v_seen_contact_keys text[] := array[]::text[];
begin
	if v_requester_id is null then
		raise exception 'No autorizado para previsualizar importaciones';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if v_requester_role not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden importar beneficiarios';
	end if;

	if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
		raise exception 'Las filas de importacion deben enviarse como un arreglo JSON';
	end if;

	if jsonb_array_length(p_rows) = 0 then
		raise exception 'El archivo no contiene filas de datos';
	end if;

	for v_item in select value from jsonb_array_elements(p_rows)
	loop
		v_index := v_index + 1;
		v_raw_payload := coalesce(v_item, '{}'::jsonb);
		v_row_number := coalesce(nullif(v_item->>'rowNumber', '')::integer, v_index);
		v_errors := array[]::text[];
		v_warnings := array[]::text[];
		v_beneficiary_id := null;
		v_contact_id := null;
		v_should_create_beneficiary := false;
		v_should_update_beneficiary_name := false;
		v_should_create_contact := false;
		v_should_replace_primary := false;
		v_existing_name := null;
		v_effective_name := null;
		v_active_primary_phone := null;
		v_beneficiary_created_in_file := false;
		v_existing_contact_id := null;
		v_shared_phone_owner_rut := null;
		v_shared_phone_exists := false;

		v_rut_raw := nullif(btrim(coalesce(v_item->>'rut', '')), '');
		v_name_raw := nullif(btrim(coalesce(v_item->>'nombre', '')), '');
		v_phone_raw := nullif(btrim(coalesce(v_item->>'telefono', '')), '');
		v_type_raw := nullif(btrim(coalesce(v_item->>'tipoTelefono', '')), '');

		if v_rut_raw is null then
			v_errors := array_append(v_errors, 'RUT obligatorio');
		else
			v_rut_normalized := public.normalize_rut(v_rut_raw);
			if v_rut_normalized is null then
				v_errors := array_append(v_errors, 'RUT invalido');
			end if;
		end if;

		v_name_normalized := public.normalize_person_name(v_name_raw);
		if v_name_normalized is null then
			v_errors := array_append(v_errors, 'Nombre obligatorio');
		end if;

		if v_phone_raw is null then
			v_errors := array_append(v_errors, 'Telefono obligatorio');
		else
			v_phone_normalized := public.normalize_chilean_phone(v_phone_raw);
			if v_phone_normalized is null then
				v_errors := array_append(v_errors, 'Telefono invalido');
			end if;
		end if;

		if v_type_raw is null then
			v_errors := array_append(v_errors, 'Tipo telefono obligatorio');
		else
			v_import_contact_type := public.normalize_import_contact_type(v_type_raw);
			if v_import_contact_type is null then
				v_errors := array_append(v_errors, 'Tipo telefono invalido; usa principal o red_apoyo');
			end if;
		end if;

		if array_length(v_errors, 1) is not null then
			row_number := v_row_number;
			raw_payload := v_raw_payload;
			normalized_payload := jsonb_build_object(
				'rutNormalized', v_rut_normalized,
				'beneficiaryName', v_name_normalized,
				'phoneNormalized', v_phone_normalized,
				'importContactType', v_import_contact_type
			);
			result_status := 'error';
			message := array_to_string(v_errors, ' | ');
			beneficiary_id := null;
			contact_id := null;
			should_create_beneficiary := false;
			should_update_beneficiary_name := false;
			should_create_contact := false;
			should_replace_primary := false;
			return next;
			continue;
		end if;

		if v_import_contact_type = 'principal' then
			v_contact_type := 'primary_phone';
			v_is_primary := true;
		else
			v_contact_type := 'support_network';
			v_is_primary := false;
		end if;

		if v_state_by_rut ? v_rut_normalized then
			v_state := v_state_by_rut -> v_rut_normalized;
			v_beneficiary_id := nullif(v_state->>'beneficiary_id', '')::uuid;
			v_effective_name := nullif(v_state->>'effective_name', '');
			v_existing_name := v_effective_name;
			v_active_primary_phone := nullif(v_state->>'active_primary_phone', '');
			v_beneficiary_created_in_file := coalesce((v_state->>'created_in_file')::boolean, false);
			v_should_create_beneficiary := false;
		else
			select b.id, public.normalize_person_name(b.full_name)
			into v_beneficiary_id, v_existing_name
			from public.beneficiaries as b
			where b.rut_normalized = v_rut_normalized
			limit 1;

			if v_beneficiary_id is null then
				v_should_create_beneficiary := true;
				v_beneficiary_created_in_file := true;
				v_effective_name := v_name_normalized;
			else
				v_should_create_beneficiary := false;
				v_beneficiary_created_in_file := false;
				select bc.phone_normalized
				into v_active_primary_phone
				from public.beneficiary_contacts as bc
				where bc.beneficiary_id = v_beneficiary_id
					and bc.is_active is true
					and bc.is_primary is true
				order by bc.created_at desc
				limit 1;

				v_effective_name := coalesce(v_existing_name, v_name_normalized);
			end if;
		end if;

		if v_existing_name is null and v_beneficiary_id is not null then
			v_should_update_beneficiary_name := true;
			v_effective_name := v_name_normalized;
		elsif v_effective_name is distinct from v_name_normalized then
			v_warnings := array_append(v_warnings, 'Nombre distinto; se conserva el nombre ya registrado');
			v_effective_name := coalesce(v_effective_name, v_name_normalized);
		end if;

		v_contact_key := v_rut_normalized || '|' || v_phone_normalized;

		if v_contact_key = any(v_seen_contact_keys) then
			row_number := v_row_number;
			raw_payload := v_raw_payload;
			normalized_payload := jsonb_build_object(
				'rutNormalized', v_rut_normalized,
				'beneficiaryName', v_effective_name,
				'inputName', v_name_normalized,
				'phoneNormalized', v_phone_normalized,
				'importContactType', v_import_contact_type,
				'contactType', v_contact_type,
				'isPrimary', v_is_primary
			);
			result_status := 'skipped';
			message := 'Contacto duplicado dentro del mismo archivo; no se creara un nuevo registro';
			beneficiary_id := v_beneficiary_id;
			contact_id := null;
			should_create_beneficiary := false;
			should_update_beneficiary_name := false;
			should_create_contact := false;
			should_replace_primary := false;
			return next;
			continue;
		end if;

		if v_beneficiary_id is not null then
			select bc.id
			into v_existing_contact_id
			from public.beneficiary_contacts as bc
			where bc.beneficiary_id = v_beneficiary_id
				and bc.phone_normalized = v_phone_normalized
			order by bc.created_at desc
			limit 1;
		end if;

		if v_existing_contact_id is not null then
			row_number := v_row_number;
			raw_payload := v_raw_payload;
			normalized_payload := jsonb_build_object(
				'rutNormalized', v_rut_normalized,
				'beneficiaryName', v_effective_name,
				'inputName', v_name_normalized,
				'phoneNormalized', v_phone_normalized,
				'importContactType', v_import_contact_type,
				'contactType', v_contact_type,
				'isPrimary', v_is_primary
			);
			result_status := 'skipped';
			message := 'Contacto duplicado para el beneficiario; no se creara un nuevo registro';
			beneficiary_id := v_beneficiary_id;
			contact_id := v_existing_contact_id;
			should_create_beneficiary := false;
			should_update_beneficiary_name := false;
			should_create_contact := false;
			should_replace_primary := false;
			return next;
			continue;
		end if;

		if v_phone_owner_by_phone ? v_phone_normalized then
			v_shared_phone_owner_rut := nullif(v_phone_owner_by_phone->>v_phone_normalized, '');
			if v_shared_phone_owner_rut is distinct from v_rut_normalized then
				v_warnings := array_append(v_warnings, 'Telefono compartido con otro beneficiario del mismo archivo');
			end if;
		else
			select exists (
				select 1
				from public.beneficiary_contacts as bc
				where bc.phone_normalized = v_phone_normalized
					and (v_beneficiary_id is null or bc.beneficiary_id is distinct from v_beneficiary_id)
			)
			into v_shared_phone_exists;

			if v_shared_phone_exists then
				v_warnings := array_append(v_warnings, 'Telefono compartido con otro beneficiario existente');
			end if;

			v_phone_owner_by_phone := v_phone_owner_by_phone || jsonb_build_object(v_phone_normalized, v_rut_normalized);
		end if;

		if v_is_primary and v_active_primary_phone is not null and v_active_primary_phone <> v_phone_normalized then
			v_should_replace_primary := true;
			v_warnings := array_append(v_warnings, 'Principal anterior reemplazado');
		end if;

		v_should_create_contact := true;
		v_seen_contact_keys := array_append(v_seen_contact_keys, v_contact_key);

		v_state_by_rut := v_state_by_rut || jsonb_build_object(
			v_rut_normalized,
			jsonb_build_object(
				'beneficiary_id', v_beneficiary_id,
				'beneficiary_exists_in_db', coalesce(v_beneficiary_id is not null, false),
				'created_in_file', v_beneficiary_created_in_file,
				'effective_name', v_effective_name,
				'active_primary_phone', case when v_is_primary then v_phone_normalized else v_active_primary_phone end
			)
		);

		if v_should_create_beneficiary then
			v_base_message := 'Se creara un nuevo beneficiario y su contacto';
		elsif v_beneficiary_created_in_file then
			v_base_message := 'Se agregara un contacto adicional al beneficiario creado en esta corrida';
		elsif v_should_update_beneficiary_name then
			v_base_message := 'Se actualizara el nombre vacio del beneficiario y se agregara el contacto';
		else
			v_base_message := 'Se agregara un contacto al beneficiario existente';
		end if;

		v_normalized_payload := jsonb_build_object(
			'rutNormalized', v_rut_normalized,
			'beneficiaryName', v_effective_name,
			'inputName', v_name_normalized,
			'phoneNormalized', v_phone_normalized,
			'importContactType', v_import_contact_type,
			'contactType', v_contact_type,
			'isPrimary', v_is_primary
		);

		row_number := v_row_number;
		raw_payload := v_raw_payload;
		normalized_payload := v_normalized_payload;
		if array_length(v_warnings, 1) is not null then
			result_status := 'warning';
			message := v_base_message || '. Advertencias: ' || array_to_string(v_warnings, ' | ');
		elsif v_should_create_beneficiary then
			result_status := 'created';
			message := v_base_message;
		else
			result_status := 'updated';
			message := v_base_message;
		end if;
		beneficiary_id := v_beneficiary_id;
		contact_id := null;
		should_create_beneficiary := v_should_create_beneficiary;
		should_update_beneficiary_name := v_should_update_beneficiary_name;
		should_create_contact := v_should_create_contact;
		should_replace_primary := v_should_replace_primary;
		return next;
	end loop;
end;
$$;

create or replace function public.preview_beneficiary_contacts_import(
	p_source_filename text,
	p_rows jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
	with evaluated as (
		select *
		from public.evaluate_beneficiary_contacts_import_rows(p_rows)
	),
	summary as (
		select jsonb_build_object(
			'totalRows', count(*),
			'createdRows', count(*) filter (where result_status = 'created'),
			'updatedRows', count(*) filter (where result_status = 'updated'),
			'skippedRows', count(*) filter (where result_status = 'skipped'),
			'warningRows', count(*) filter (where result_status = 'warning'),
			'errorRows', count(*) filter (where result_status = 'error')
		) as payload
		from evaluated
	),
	rows as (
		select coalesce(
			jsonb_agg(
				jsonb_build_object(
					'rowNumber', row_number,
					'rawPayload', raw_payload,
					'normalizedPayload', normalized_payload,
					'resultStatus', result_status,
					'message', message,
					'beneficiaryId', beneficiary_id,
					'contactId', contact_id,
					'shouldCreateBeneficiary', should_create_beneficiary,
					'shouldUpdateBeneficiaryName', should_update_beneficiary_name,
					'shouldCreateContact', should_create_contact,
					'shouldReplacePrimary', should_replace_primary
				)
				order by row_number
			),
			'[]'::jsonb
		) as payload
		from evaluated
	)
	select jsonb_build_object(
		'sourceFilename', nullif(btrim(coalesce(p_source_filename, '')), ''),
		'summary', summary.payload,
		'rows', rows.payload
	)
	from summary, rows;
$$;

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

comment on function public.normalize_person_name(text)
	is 'Colapsa espacios y devuelve null cuando el nombre queda vacio.';

comment on function public.normalize_import_contact_type(text)
	is 'Normaliza aliases del archivo de importacion a principal o red_apoyo.';

comment on function public.evaluate_beneficiary_contacts_import_rows(jsonb)
	is 'Evalua las filas del import de beneficiarios/contactos usando reglas canonicas sin persistir cambios.';

comment on function public.preview_beneficiary_contacts_import(text, jsonb)
	is 'Devuelve una previsualizacion no persistente del import de beneficiarios/contactos.';

comment on function public.execute_beneficiary_contacts_import(text, jsonb)
	is 'Persiste el import de beneficiarios/contactos y registra trazabilidad completa por corrida y fila.';

revoke all on function public.evaluate_beneficiary_contacts_import_rows(jsonb) from public;
revoke all on function public.preview_beneficiary_contacts_import(text, jsonb) from public;
revoke all on function public.execute_beneficiary_contacts_import(text, jsonb) from public;

grant execute on function public.preview_beneficiary_contacts_import(text, jsonb) to authenticated;
grant execute on function public.execute_beneficiary_contacts_import(text, jsonb) to authenticated;