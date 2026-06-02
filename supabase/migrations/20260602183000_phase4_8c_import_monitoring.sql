-- =============================================
-- phase4_8c_import_monitoring
-- Monitoreo institucional y diagnostico de
-- importaciones de call logs.
-- =============================================

alter table public.import_runs
	add column if not exists source_type text,
	add column if not exists started_at timestamptz,
	add column if not exists processed_rows integer,
	add column if not exists valid_rows integer,
	add column if not exists invalid_rows integer,
	add column if not exists correlated_rows integer,
	add column if not exists uncorrelated_rows integer;

update public.import_runs
set
	source_type = coalesce(source_type, nullif(metadata->>'source', ''), import_type::text),
	started_at = coalesce(started_at, created_at),
	processed_rows = coalesce(processed_rows, created_rows + updated_rows + skipped_rows + warning_rows + error_rows),
	valid_rows = coalesce(valid_rows, greatest(total_rows - error_rows, 0)),
	invalid_rows = coalesce(invalid_rows, error_rows),
	correlated_rows = coalesce(
		correlated_rows,
		case
			when import_type = 'call_logs_import'
				then coalesce((metadata->>'matchedSingleRows')::integer, 0)
			else 0
		end
	),
	uncorrelated_rows = coalesce(
		uncorrelated_rows,
		case
			when import_type = 'call_logs_import'
				then coalesce((metadata->>'matchedMultipleRows')::integer, 0)
					+ coalesce((metadata->>'unmatchedRows')::integer, 0)
					+ coalesce((metadata->>'invalidPhoneRows')::integer, 0)
			else 0
		end
	)
where source_type is null
	or started_at is null
	or processed_rows is null
	or valid_rows is null
	or invalid_rows is null
	or correlated_rows is null
	or uncorrelated_rows is null;

alter table public.import_runs
	alter column source_type set default 'unknown',
	alter column source_type set not null,
	alter column started_at set default now(),
	alter column started_at set not null,
	alter column processed_rows set default 0,
	alter column processed_rows set not null,
	alter column valid_rows set default 0,
	alter column valid_rows set not null,
	alter column invalid_rows set default 0,
	alter column invalid_rows set not null,
	alter column correlated_rows set default 0,
	alter column correlated_rows set not null,
	alter column uncorrelated_rows set default 0,
	alter column uncorrelated_rows set not null;

do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conname = 'import_runs_processed_rows_check'
	) then
		alter table public.import_runs
			add constraint import_runs_processed_rows_check check (processed_rows >= 0);
	end if;

	if not exists (
		select 1
		from pg_constraint
		where conname = 'import_runs_valid_rows_check'
	) then
		alter table public.import_runs
			add constraint import_runs_valid_rows_check check (valid_rows >= 0);
	end if;

	if not exists (
		select 1
		from pg_constraint
		where conname = 'import_runs_invalid_rows_check'
	) then
		alter table public.import_runs
			add constraint import_runs_invalid_rows_check check (invalid_rows >= 0);
	end if;

	if not exists (
		select 1
		from pg_constraint
		where conname = 'import_runs_correlated_rows_check'
	) then
		alter table public.import_runs
			add constraint import_runs_correlated_rows_check check (correlated_rows >= 0);
	end if;

	if not exists (
		select 1
		from pg_constraint
		where conname = 'import_runs_uncorrelated_rows_check'
	) then
		alter table public.import_runs
			add constraint import_runs_uncorrelated_rows_check check (uncorrelated_rows >= 0);
	end if;
end
$$;

create index if not exists idx_import_runs_started_at_desc
	on public.import_runs (started_at desc);

create index if not exists idx_import_runs_source_type
	on public.import_runs (source_type);

do $$
begin
	if not exists (
		select 1
		from pg_type
		where typnamespace = 'public'::regnamespace
			and typname = 'call_log_correlation_issue_type'
	) then
		create type public.call_log_correlation_issue_type as enum (
			'beneficiary_not_found',
			'phone_not_matched',
			'assignment_not_found',
			'assignment_inactive',
			'operator_not_found',
			'ambiguous_match',
			'invalid_call_data',
			'duplicate_call',
			'unknown'
		);
	end if;
end
$$;

create table if not exists public.import_job_errors (
	id uuid primary key default gen_random_uuid(),
	import_job_id uuid not null references public.import_runs (id) on delete cascade,
	import_run_row_id uuid references public.import_run_rows (id) on delete set null,
	row_number integer,
	severity text not null check (severity in ('warning', 'error')),
	error_code text not null,
	message text not null,
	details jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now()
);

create index if not exists idx_import_job_errors_import_job_id
	on public.import_job_errors (import_job_id);

create index if not exists idx_import_job_errors_import_run_row_id
	on public.import_job_errors (import_run_row_id);

create index if not exists idx_import_job_errors_severity
	on public.import_job_errors (severity);

create table if not exists public.call_log_correlation_issues (
	id uuid primary key default gen_random_uuid(),
	import_job_id uuid not null references public.import_runs (id) on delete cascade,
	import_run_row_id uuid references public.import_run_rows (id) on delete set null,
	row_number integer,
	raw_call_log_id uuid references public.raw_call_logs (id) on delete set null,
	correlation_id uuid references public.call_correlations (id) on delete set null,
	issue_type public.call_log_correlation_issue_type not null,
	external_call_id text,
	phone_normalized text,
	beneficiary_id uuid references public.beneficiaries (id) on delete set null,
	beneficiary_contact_id uuid references public.beneficiary_contacts (id) on delete set null,
	assignment_id_at_call_time uuid references public.beneficiary_assignments (id) on delete set null,
	responsible_user_id_at_call_time uuid,
	issue_message text not null,
	details jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now()
);

create index if not exists idx_call_log_correlation_issues_import_job_id
	on public.call_log_correlation_issues (import_job_id);

create index if not exists idx_call_log_correlation_issues_import_run_row_id
	on public.call_log_correlation_issues (import_run_row_id);

create index if not exists idx_call_log_correlation_issues_issue_type
	on public.call_log_correlation_issues (issue_type);

create index if not exists idx_call_log_correlation_issues_external_call_id
	on public.call_log_correlation_issues (external_call_id);

alter table public.import_job_errors enable row level security;
alter table public.call_log_correlation_issues enable row level security;

drop policy if exists "import_job_errors_select_admin_super_admin" on public.import_job_errors;
create policy "import_job_errors_select_admin_super_admin"
	on public.import_job_errors
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

drop policy if exists "import_job_errors_insert_admin_super_admin" on public.import_job_errors;
create policy "import_job_errors_insert_admin_super_admin"
	on public.import_job_errors
	for insert
	to authenticated
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

drop policy if exists "import_job_errors_update_admin_super_admin" on public.import_job_errors;
create policy "import_job_errors_update_admin_super_admin"
	on public.import_job_errors
	for update
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	)
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

drop policy if exists "call_log_correlation_issues_select_admin_super_admin" on public.call_log_correlation_issues;
create policy "call_log_correlation_issues_select_admin_super_admin"
	on public.call_log_correlation_issues
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

drop policy if exists "call_log_correlation_issues_insert_admin_super_admin" on public.call_log_correlation_issues;
create policy "call_log_correlation_issues_insert_admin_super_admin"
	on public.call_log_correlation_issues
	for insert
	to authenticated
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

drop policy if exists "call_log_correlation_issues_update_admin_super_admin" on public.call_log_correlation_issues;
create policy "call_log_correlation_issues_update_admin_super_admin"
	on public.call_log_correlation_issues
	for update
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	)
	with check (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create or replace function public.classify_call_log_correlation_issue(
	p_result_status public.import_row_result_status,
	p_correlation_status public.call_correlation_status,
	p_beneficiary_id uuid,
	p_assignment_id_at_call_time uuid,
	p_responsible_user_id_at_call_time uuid,
	p_message text
)
returns public.call_log_correlation_issue_type
language plpgsql
stable
set search_path = public
as $$
declare
	v_has_primary_assignment boolean := false;
begin
	if p_result_status = 'skipped'
		and p_message ilike 'La llamada ya existia al momento de ejecutar la importacion%' then
		return 'duplicate_call';
	end if;

	if p_result_status = 'error' then
		return 'invalid_call_data';
	end if;

	case p_correlation_status
		when 'invalid_phone' then
			return 'invalid_call_data';
		when 'unmatched' then
			return 'phone_not_matched';
		when 'matched_multiple' then
			return 'ambiguous_match';
		when 'matched_single' then
			if p_beneficiary_id is null then
				return 'beneficiary_not_found';
			end if;

			if p_assignment_id_at_call_time is null then
				select exists (
					select 1
					from public.beneficiary_assignments as ba
					where ba.beneficiary_id = p_beneficiary_id
						and ba.assignment_type = 'primary'
				)
				into v_has_primary_assignment;

				if v_has_primary_assignment then
					return 'assignment_inactive';
				end if;

				return 'assignment_not_found';
			end if;

			if p_responsible_user_id_at_call_time is null then
				return 'operator_not_found';
			end if;
		else
			null;
	end case;

	if p_result_status in ('warning', 'error', 'skipped') then
		return 'unknown';
	end if;

	return null;
end;
$$;

insert into public.import_job_errors (
	import_job_id,
	import_run_row_id,
	row_number,
	severity,
	error_code,
	message,
	details,
	created_at
)
select
	ir.import_run_id,
	ir.id,
	ir.row_number,
	case when ir.result_status = 'error' then 'error' else 'warning' end,
	coalesce(public.classify_call_log_correlation_issue(
		ir.result_status,
		ir.correlation_status,
		ir.beneficiary_id,
		nullif(ir.normalized_payload->>'assignmentIdAtCallTime', '')::uuid,
		nullif(ir.normalized_payload->>'responsibleUserIdAtCallTime', '')::uuid,
		ir.message
	)::text, case when ir.result_status = 'error' then 'invalid_call_data' else 'unknown' end),
	ir.message,
	jsonb_build_object(
		'externalCallId', ir.external_call_id,
		'correlationStatus', ir.correlation_status,
		'rawCallLogId', ir.raw_call_log_id,
		'correlationId', ir.correlation_id
	),
	ir.created_at
from public.import_run_rows as ir
join public.import_runs as run
	on run.id = ir.import_run_id
where run.import_type = 'call_logs_import'
	and ir.result_status in ('warning', 'error')
	and not exists (
		select 1
		from public.import_job_errors as existing
		where existing.import_run_row_id = ir.id
	);

insert into public.call_log_correlation_issues (
	import_job_id,
	import_run_row_id,
	row_number,
	raw_call_log_id,
	correlation_id,
	issue_type,
	external_call_id,
	phone_normalized,
	beneficiary_id,
	beneficiary_contact_id,
	assignment_id_at_call_time,
	responsible_user_id_at_call_time,
	issue_message,
	details,
	created_at
)
select
	ir.import_run_id,
	ir.id,
	ir.row_number,
	ir.raw_call_log_id,
	ir.correlation_id,
	public.classify_call_log_correlation_issue(
		ir.result_status,
		ir.correlation_status,
		ir.beneficiary_id,
		nullif(ir.normalized_payload->>'assignmentIdAtCallTime', '')::uuid,
		nullif(ir.normalized_payload->>'responsibleUserIdAtCallTime', '')::uuid,
		ir.message
	),
	ir.external_call_id,
	ir.phone_normalized,
	ir.beneficiary_id,
	ir.beneficiary_contact_id,
	nullif(ir.normalized_payload->>'assignmentIdAtCallTime', '')::uuid,
	nullif(ir.normalized_payload->>'responsibleUserIdAtCallTime', '')::uuid,
	ir.message,
	jsonb_build_object(
		'resultStatus', ir.result_status,
		'correlationStatus', ir.correlation_status,
		'normalizedPayload', ir.normalized_payload
	),
	ir.created_at
from public.import_run_rows as ir
join public.import_runs as run
	on run.id = ir.import_run_id
where run.import_type = 'call_logs_import'
	and public.classify_call_log_correlation_issue(
		ir.result_status,
		ir.correlation_status,
		ir.beneficiary_id,
		nullif(ir.normalized_payload->>'assignmentIdAtCallTime', '')::uuid,
		nullif(ir.normalized_payload->>'responsibleUserIdAtCallTime', '')::uuid,
		ir.message
	) is not null
	and not exists (
		select 1
		from public.call_log_correlation_issues as existing
		where existing.import_run_row_id = ir.id
	);

create or replace function public.execute_call_logs_import(
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
	v_source_filename text := nullif(btrim(coalesce(p_source_filename, '')), '');
	v_eval record;
	v_raw_call record;
	v_correlation record;
	v_effective_status public.import_row_result_status;
	v_effective_message text;
	v_effective_normalized_payload jsonb;
	v_effective_phone_normalized text;
	v_effective_correlation_status public.call_correlation_status;
	v_effective_beneficiary_id uuid;
	v_effective_beneficiary_contact_id uuid;
	v_effective_assignment_id uuid;
	v_effective_responsible_user_id uuid;
	v_effective_raw_call_log_id uuid;
	v_effective_correlation_id uuid;
	v_created_rows integer := 0;
	v_skipped_rows integer := 0;
	v_warning_rows integer := 0;
	v_error_rows integer := 0;
	v_processed_rows integer := 0;
	v_valid_rows integer := 0;
	v_invalid_rows integer := 0;
	v_correlated_rows integer := 0;
	v_uncorrelated_rows integer := 0;
	v_matched_single_rows integer := 0;
	v_matched_multiple_rows integer := 0;
	v_unmatched_rows integer := 0;
	v_invalid_phone_rows integer := 0;
	v_existing_raw_call record;
	v_has_empty_raw_status boolean;
	v_import_run_row_id uuid;
	v_issue_type public.call_log_correlation_issue_type;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para ejecutar importaciones de llamadas';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if v_requester_role not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden importar llamadas';
	end if;

	if v_source_filename is null then
		raise exception 'El nombre del archivo es obligatorio';
	end if;

	insert into public.import_runs (
		id,
		created_by,
		import_type,
		source_filename,
		source_type,
		status,
		started_at,
		total_rows,
		processed_rows,
		valid_rows,
		invalid_rows,
		correlated_rows,
		uncorrelated_rows,
		metadata
	)
	values (
		v_run_id,
		v_requester_id,
		'call_logs_import',
		v_source_filename,
		'amaia_net2phone_excel',
		'processing',
		v_now,
		jsonb_array_length(coalesce(p_rows, '[]'::jsonb)),
		0,
		0,
		0,
		0,
		0,
		jsonb_build_object('previewedAt', v_now, 'source', 'amaia_net2phone_excel')
	);

	for v_eval in
		select *
		from public.evaluate_call_logs_import_rows(p_rows)
	loop
		v_processed_rows := v_processed_rows + 1;
		v_effective_status := v_eval.result_status;
		v_effective_message := v_eval.message;
		v_effective_normalized_payload := coalesce(v_eval.normalized_payload, '{}'::jsonb);
		v_effective_phone_normalized := v_eval.phone_normalized;
		v_effective_correlation_status := v_eval.correlation_status;
		v_effective_beneficiary_id := v_eval.beneficiary_id;
		v_effective_beneficiary_contact_id := v_eval.beneficiary_contact_id;
		v_effective_assignment_id := v_eval.assignment_id_at_call_time;
		v_effective_responsible_user_id := v_eval.responsible_user_id_at_call_time;
		v_effective_raw_call_log_id := v_eval.raw_call_log_id;
		v_effective_correlation_id := v_eval.correlation_id;
		v_has_empty_raw_status := nullif(btrim(coalesce(v_eval.raw_payload->>'estado', '')), '') is null;

		if v_eval.result_status = 'error' then
			v_error_rows := v_error_rows + 1;
			v_invalid_rows := v_invalid_rows + 1;
		elsif not v_eval.should_apply then
			v_skipped_rows := v_skipped_rows + 1;
			v_valid_rows := v_valid_rows + 1;
		else
			begin
				insert into public.raw_call_logs (
					source,
					external_call_id,
					called_at,
					raw_phone,
					call_type,
					raw_status,
					duration_seconds,
					raw_beneficiary_label,
					raw_observations,
					raw_payload,
					created_by
				)
				values (
					'amaia_net2phone_excel',
					v_eval.external_call_id,
					v_eval.called_at,
					nullif(btrim(coalesce(v_eval.raw_payload->>'telefono', '')), ''),
					nullif(btrim(coalesce(v_eval.raw_payload->>'tipoLlamada', '')), ''),
					nullif(btrim(coalesce(v_eval.raw_payload->>'estado', '')), ''),
					v_eval.duration_seconds,
					nullif(btrim(coalesce(v_eval.raw_payload->>'beneficiario', '')), ''),
					nullif(btrim(coalesce(v_eval.raw_payload->>'observaciones', '')), ''),
					v_eval.raw_payload,
					v_requester_id
				)
				returning id, phone_normalized
				into v_raw_call;

				select *
				into v_correlation
				from public.correlate_raw_call_log(v_raw_call.id)
				limit 1;

				v_effective_raw_call_log_id := v_raw_call.id;
				v_effective_correlation_id := v_correlation.correlation_id;
				v_effective_phone_normalized := coalesce(v_raw_call.phone_normalized, v_correlation.matched_phone, v_effective_phone_normalized);
				v_effective_correlation_status := v_correlation.correlation_status;
				v_effective_beneficiary_id := v_correlation.beneficiary_id;
				v_effective_beneficiary_contact_id := v_correlation.beneficiary_contact_id;
				v_effective_assignment_id := v_correlation.assignment_id_at_call_time;
				v_effective_responsible_user_id := v_correlation.responsible_user_id_at_call_time;
				v_effective_normalized_payload := jsonb_set(
					jsonb_set(
						jsonb_set(
							coalesce(v_effective_normalized_payload, '{}'::jsonb),
							'{phoneNormalized}',
							coalesce(to_jsonb(v_effective_phone_normalized), 'null'::jsonb),
							true
						),
						'{correlationStatus}',
						coalesce(to_jsonb(v_effective_correlation_status), 'null'::jsonb),
						true
					),
					'{shouldApply}',
					'true'::jsonb,
					true
				);

				if v_eval.duration_seconds = 0
					or v_has_empty_raw_status
					or v_effective_correlation_status in ('matched_multiple', 'unmatched', 'invalid_phone') then
					v_effective_status := 'warning';
					v_warning_rows := v_warning_rows + 1;
				else
					v_effective_status := 'created';
					v_created_rows := v_created_rows + 1;
				end if;

				v_effective_message := v_correlation.reason;
				if v_eval.duration_seconds = 0 then
					v_effective_message := concat_ws(' ', v_effective_message, 'La duracion es 0 segundos; se conserva la evidencia.');
				end if;
				if v_has_empty_raw_status then
					v_effective_message := concat_ws(' ', v_effective_message, 'Estado de llamada vacío. Se conserva como evidencia, pero no se usa para matching.');
				end if;

				v_valid_rows := v_valid_rows + 1;
			exception
				when unique_violation then
					select
						rcl.id as raw_call_log_id,
						rcl.phone_normalized,
						cc.id as correlation_id,
						cc.correlation_status,
						cc.beneficiary_id,
						cc.beneficiary_contact_id,
						cc.assignment_id_at_call_time,
						cc.responsible_user_id_at_call_time
					into v_existing_raw_call
					from public.raw_call_logs as rcl
					left join public.call_correlations as cc
						on cc.raw_call_log_id = rcl.id
					where rcl.source = 'amaia_net2phone_excel'
						and rcl.external_call_id = v_eval.external_call_id
					limit 1;

					v_effective_status := 'skipped';
					v_effective_message := 'La llamada ya existia al momento de ejecutar la importacion; se omitio la recreacion.';
					v_effective_raw_call_log_id := v_existing_raw_call.raw_call_log_id;
					v_effective_correlation_id := v_existing_raw_call.correlation_id;
					v_effective_phone_normalized := coalesce(v_existing_raw_call.phone_normalized, v_effective_phone_normalized);
					v_effective_correlation_status := v_existing_raw_call.correlation_status;
					v_effective_beneficiary_id := v_existing_raw_call.beneficiary_id;
					v_effective_beneficiary_contact_id := v_existing_raw_call.beneficiary_contact_id;
					v_effective_assignment_id := v_existing_raw_call.assignment_id_at_call_time;
					v_effective_responsible_user_id := v_existing_raw_call.responsible_user_id_at_call_time;
					v_effective_normalized_payload := jsonb_set(
						jsonb_set(
							coalesce(v_effective_normalized_payload, '{}'::jsonb),
							'{operation}',
							to_jsonb('skipped'::text),
							true
						),
						'{shouldApply}',
						'false'::jsonb,
						true
					);
					v_skipped_rows := v_skipped_rows + 1;
					v_valid_rows := v_valid_rows + 1;
			end;
		end if;

		case v_effective_correlation_status
			when 'matched_single' then
				v_matched_single_rows := v_matched_single_rows + 1;
				v_correlated_rows := v_correlated_rows + 1;
			when 'matched_multiple' then
				v_matched_multiple_rows := v_matched_multiple_rows + 1;
				v_uncorrelated_rows := v_uncorrelated_rows + 1;
			when 'unmatched' then
				v_unmatched_rows := v_unmatched_rows + 1;
				v_uncorrelated_rows := v_uncorrelated_rows + 1;
			when 'invalid_phone' then
				v_invalid_phone_rows := v_invalid_phone_rows + 1;
				v_uncorrelated_rows := v_uncorrelated_rows + 1;
			else
				null;
		end case;

		insert into public.import_run_rows (
			import_run_id,
			row_number,
			raw_payload,
			normalized_payload,
			result_status,
			message,
			beneficiary_id,
			beneficiary_contact_id,
			external_call_id,
			raw_call_log_id,
			correlation_id,
			phone_normalized,
			correlation_status,
			created_at
		)
		values (
			v_run_id,
			v_eval.row_number,
			v_eval.raw_payload,
			v_effective_normalized_payload,
			v_effective_status,
			v_effective_message,
			v_effective_beneficiary_id,
			v_effective_beneficiary_contact_id,
			v_eval.external_call_id,
			v_effective_raw_call_log_id,
			v_effective_correlation_id,
			v_effective_phone_normalized,
			v_effective_correlation_status,
			v_now
		)
		returning id into v_import_run_row_id;

		v_issue_type := public.classify_call_log_correlation_issue(
			v_effective_status,
			v_effective_correlation_status,
			v_effective_beneficiary_id,
			v_effective_assignment_id,
			v_effective_responsible_user_id,
			v_effective_message
		);

		if v_effective_status in ('warning', 'error') then
			insert into public.import_job_errors (
				import_job_id,
				import_run_row_id,
				row_number,
				severity,
				error_code,
				message,
				details,
				created_at
			)
			values (
				v_run_id,
				v_import_run_row_id,
				v_eval.row_number,
				case when v_effective_status = 'error' then 'error' else 'warning' end,
				coalesce(v_issue_type::text, case when v_effective_status = 'error' then 'invalid_call_data' else 'unknown' end),
				v_effective_message,
				jsonb_build_object(
					'externalCallId', v_eval.external_call_id,
					'correlationStatus', v_effective_correlation_status,
					'rawCallLogId', v_effective_raw_call_log_id,
					'correlationId', v_effective_correlation_id,
					'phoneNormalized', v_effective_phone_normalized
				),
				v_now
			);
		end if;

		if v_issue_type is not null then
			insert into public.call_log_correlation_issues (
				import_job_id,
				import_run_row_id,
				row_number,
				raw_call_log_id,
				correlation_id,
				issue_type,
				external_call_id,
				phone_normalized,
				beneficiary_id,
				beneficiary_contact_id,
				assignment_id_at_call_time,
				responsible_user_id_at_call_time,
				issue_message,
				details,
				created_at
			)
			values (
				v_run_id,
				v_import_run_row_id,
				v_eval.row_number,
				v_effective_raw_call_log_id,
				v_effective_correlation_id,
				v_issue_type,
				v_eval.external_call_id,
				v_effective_phone_normalized,
				v_effective_beneficiary_id,
				v_effective_beneficiary_contact_id,
				v_effective_assignment_id,
				v_effective_responsible_user_id,
				v_effective_message,
				jsonb_build_object(
					'resultStatus', v_effective_status,
					'correlationStatus', v_effective_correlation_status,
					'normalizedPayload', v_effective_normalized_payload
				),
				v_now
			);
		end if;
	end loop;

	update public.import_runs
	set
		status = case when v_error_rows > 0 then 'processed_with_errors'::public.import_run_status else 'processed'::public.import_run_status end,
		created_rows = v_created_rows,
		updated_rows = 0,
		skipped_rows = v_skipped_rows,
		warning_rows = v_warning_rows,
		error_rows = v_error_rows,
		processed_rows = v_processed_rows,
		valid_rows = v_valid_rows,
		invalid_rows = v_invalid_rows,
		correlated_rows = v_correlated_rows,
		uncorrelated_rows = v_uncorrelated_rows,
		finished_at = now(),
		metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
			'executedAt', now(),
			'importType', 'call_logs_import',
			'source', 'amaia_net2phone_excel',
			'matchedSingleRows', v_matched_single_rows,
			'matchedMultipleRows', v_matched_multiple_rows,
			'unmatchedRows', v_unmatched_rows,
			'invalidPhoneRows', v_invalid_phone_rows,
			'processedRows', v_processed_rows,
			'validRows', v_valid_rows,
			'invalidRows', v_invalid_rows,
			'correlatedRows', v_correlated_rows,
			'uncorrelatedRows', v_uncorrelated_rows
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
						'status', irr.result_status,
						'message', irr.message,
						'externalCallId', irr.external_call_id,
						'calledAt', nullif(irr.normalized_payload->>'calledAt', ''),
						'rawPhone', nullif(btrim(coalesce(irr.raw_payload->>'telefono', '')), ''),
						'durationSeconds', case
							when jsonb_typeof(irr.normalized_payload->'durationSeconds') = 'number'
								then irr.normalized_payload->'durationSeconds'
							else 'null'::jsonb
						end,
						'rawStatus', nullif(btrim(coalesce(irr.raw_payload->>'estado', '')), ''),
						'rawCallLogId', irr.raw_call_log_id,
						'correlationId', irr.correlation_id,
						'phoneNormalized', irr.phone_normalized,
						'correlationStatus', irr.correlation_status,
						'beneficiaryId', irr.beneficiary_id,
						'beneficiaryName', b.full_name,
						'beneficiaryContactId', irr.beneficiary_contact_id,
						'assignmentIdAtCallTime', nullif(irr.normalized_payload->>'assignmentIdAtCallTime', ''),
						'responsibleUserIdAtCallTime', nullif(irr.normalized_payload->>'responsibleUserIdAtCallTime', ''),
						'operation', nullif(irr.normalized_payload->>'operation', ''),
						'shouldApply', case
							when nullif(irr.normalized_payload->>'shouldApply', '') is null then false
							else (irr.normalized_payload->>'shouldApply')::boolean
						end
					)
					order by irr.row_number
				),
				'[]'::jsonb
			) as payload
			from public.import_run_rows as irr
			left join public.beneficiaries as b on b.id = irr.beneficiary_id
			where irr.import_run_id = v_run_id
		),
		summary as (
			select jsonb_build_object(
				'totalRows', jsonb_array_length(coalesce(p_rows, '[]'::jsonb)),
				'createdRows', v_created_rows,
				'skippedRows', v_skipped_rows,
				'warningRows', v_warning_rows,
				'errorRows', v_error_rows,
				'processedRows', v_processed_rows,
				'validRows', v_valid_rows,
				'invalidRows', v_invalid_rows,
				'correlatedRows', v_correlated_rows,
				'uncorrelatedRows', v_uncorrelated_rows,
				'matchedSingleRows', v_matched_single_rows,
				'matchedMultipleRows', v_matched_multiple_rows,
				'unmatchedRows', v_unmatched_rows,
				'invalidPhoneRows', v_invalid_phone_rows
			) as payload
		)
		select jsonb_build_object(
			'runId', v_run_id,
			'sourceFilename', v_source_filename,
			'sourceType', 'amaia_net2phone_excel',
			'startedAt', v_now,
			'status', case when v_error_rows > 0 then 'processed_with_errors' else 'processed' end,
			'summary', summary.payload,
			'rows', rows.payload
		)
		from rows, summary
	);
end;
$$;

create or replace function public.get_call_import_monitoring_summary(
	p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para consultar monitoreo de imports';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if v_requester_role not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden consultar monitoreo de imports';
	end if;

	return (
		with scoped_runs as (
			select ir.*,
				p.full_name as imported_by_name,
				p.email as imported_by_email
			from public.import_runs as ir
			left join public.profiles as p
				on p.id = ir.created_by
			where ir.import_type = 'call_logs_import'
		),
		summary as (
			select jsonb_build_object(
				'totalImports', count(*)::integer,
				'successfulImports', count(*) filter (where status = 'processed' and error_rows = 0)::integer,
				'importsWithErrors', count(*) filter (where status in ('processed_with_errors', 'failed') or error_rows > 0)::integer,
				'correlationRate', round(
					coalesce((sum(correlated_rows)::numeric / nullif(sum(valid_rows), 0)) * 100, 0),
					2
				)
			) as payload
			from scoped_runs
		),
		runs as (
			select coalesce(
				jsonb_agg(
					jsonb_build_object(
						'id', id,
						'sourceType', source_type,
						'filename', source_filename,
						'importedBy', created_by,
						'importedByName', imported_by_name,
						'importedByEmail', imported_by_email,
						'status', status,
						'startedAt', started_at,
						'finishedAt', finished_at,
						'totalRows', total_rows,
						'processedRows', processed_rows,
						'validRows', valid_rows,
						'invalidRows', invalid_rows,
						'correlatedRows', correlated_rows,
						'uncorrelatedRows', uncorrelated_rows,
						'warningCount', warning_rows,
						'errorCount', error_rows,
						'metadata', metadata,
						'createdAt', created_at
					)
					order by created_at desc
				),
				'[]'::jsonb
			) as payload
			from (
				select *
				from scoped_runs
				order by created_at desc
				limit greatest(coalesce(p_limit, 20), 1)
			) as limited_runs
		)
		select jsonb_build_object(
			'summary', summary.payload,
			'imports', runs.payload
		)
		from summary, runs
	);
end;
$$;

create or replace function public.get_call_import_detail(
	p_import_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para consultar detalle de imports';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if v_requester_role not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden consultar detalle de imports';
	end if;

	return (
		with selected_run as (
			select ir.*,
				p.full_name as imported_by_name,
				p.email as imported_by_email
			from public.import_runs as ir
			left join public.profiles as p
				on p.id = ir.created_by
			where ir.id = p_import_run_id
				and ir.import_type = 'call_logs_import'
		),
		job as (
			select jsonb_build_object(
				'id', id,
				'sourceType', source_type,
				'filename', source_filename,
				'importedBy', created_by,
				'importedByName', imported_by_name,
				'importedByEmail', imported_by_email,
				'status', status,
				'startedAt', started_at,
				'finishedAt', finished_at,
				'totalRows', total_rows,
				'processedRows', processed_rows,
				'validRows', valid_rows,
				'invalidRows', invalid_rows,
				'correlatedRows', correlated_rows,
				'uncorrelatedRows', uncorrelated_rows,
				'warningCount', warning_rows,
				'errorCount', error_rows,
				'metadata', metadata,
				'createdAt', created_at
			) as payload
			from selected_run
		),
		errors as (
			select coalesce(
				jsonb_agg(
					jsonb_build_object(
						'id', e.id,
						'rowNumber', e.row_number,
						'severity', e.severity,
						'errorCode', e.error_code,
						'message', e.message,
						'details', e.details,
						'createdAt', e.created_at
					)
					order by e.row_number nulls last, e.created_at asc
				),
				'[]'::jsonb
			) as payload
			from public.import_job_errors as e
			where e.import_job_id = p_import_run_id
				and e.severity = 'error'
		),
		warnings as (
			select coalesce(
				jsonb_agg(
					jsonb_build_object(
						'id', e.id,
						'rowNumber', e.row_number,
						'severity', e.severity,
						'errorCode', e.error_code,
						'message', e.message,
						'details', e.details,
						'createdAt', e.created_at
					)
					order by e.row_number nulls last, e.created_at asc
				),
				'[]'::jsonb
			) as payload
			from public.import_job_errors as e
			where e.import_job_id = p_import_run_id
				and e.severity = 'warning'
		)
		select jsonb_build_object(
			'job', coalesce(job.payload, '{}'::jsonb),
			'errors', errors.payload,
			'warnings', warnings.payload
		)
		from job, errors, warnings
	);
end;
$$;

create or replace function public.get_call_import_correlation_issues(
	p_import_run_id uuid
)
returns table (
	id uuid,
	row_number integer,
	issue_type public.call_log_correlation_issue_type,
	issue_message text,
	external_call_id text,
	phone_normalized text,
	beneficiary_id uuid,
	beneficiary_name text,
	assignment_id_at_call_time uuid,
	responsible_user_id_at_call_time uuid,
	created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para consultar diagnostico de correlacion';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if v_requester_role not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden consultar diagnostico de correlacion';
	end if;

	return query
	select
		issue.id,
		issue.row_number,
		issue.issue_type,
		issue.issue_message,
		issue.external_call_id,
		issue.phone_normalized,
		issue.beneficiary_id,
		b.full_name,
		issue.assignment_id_at_call_time,
		issue.responsible_user_id_at_call_time,
		issue.created_at
	from public.call_log_correlation_issues as issue
	left join public.beneficiaries as b
		on b.id = issue.beneficiary_id
	where issue.import_job_id = p_import_run_id
	order by issue.row_number nulls last, issue.created_at asc;
end;
$$;

revoke all on function public.get_call_import_monitoring_summary(integer) from public;
revoke all on function public.get_call_import_detail(uuid) from public;
revoke all on function public.get_call_import_correlation_issues(uuid) from public;

grant execute on function public.get_call_import_monitoring_summary(integer) to authenticated;
grant execute on function public.get_call_import_detail(uuid) to authenticated;
grant execute on function public.get_call_import_correlation_issues(uuid) to authenticated;