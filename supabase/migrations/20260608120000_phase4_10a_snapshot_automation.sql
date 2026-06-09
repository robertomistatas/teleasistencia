create type public.snapshot_job_cadence as enum (
	'on_demand',
	'daily',
	'weekly',
	'monthly'
);

create type public.snapshot_job_run_type as enum (
	'manual',
	'scheduled',
	'backfill'
);

create type public.snapshot_job_run_status as enum (
	'running',
	'succeeded',
	'failed'
);

create table public.snapshot_jobs (
	id uuid primary key default gen_random_uuid(),
	job_key text not null unique,
	job_name text not null,
	cadence public.snapshot_job_cadence not null default 'daily',
	scope text not null default 'institutional',
	target_date_offset_days integer not null default 0,
	default_window_days integer not null default 30 check (default_window_days > 0),
	schedule_config jsonb not null default '{}'::jsonb,
	metadata jsonb not null default '{}'::jsonb,
	is_enabled boolean not null default true,
	created_by uuid references public.profiles (id) on delete set null,
	created_at timestamptz not null default now(),
	check (btrim(job_key) <> ''),
	check (btrim(job_name) <> ''),
	check (scope in ('institutional')),
	check (jsonb_typeof(schedule_config) = 'object'),
	check (jsonb_typeof(metadata) = 'object')
);

create index idx_snapshot_jobs_enabled_cadence
	on public.snapshot_jobs (is_enabled, cadence);

create table public.snapshot_job_runs (
	id uuid primary key default gen_random_uuid(),
	job_id uuid references public.snapshot_jobs (id) on delete set null,
	run_type public.snapshot_job_run_type not null,
	scope text not null default 'institutional',
	target_date date not null,
	window_days integer not null check (window_days >= 0),
	status public.snapshot_job_run_status not null,
	started_at timestamptz not null default now(),
	finished_at timestamptz,
	duration_ms integer check (duration_ms is null or duration_ms >= 0),
	snapshots_created integer not null default 0 check (snapshots_created >= 0),
	snapshots_updated integer not null default 0 check (snapshots_updated >= 0),
	error_message text,
	metadata jsonb not null default '{}'::jsonb,
	executed_by uuid references public.profiles (id) on delete set null,
	created_at timestamptz not null default now(),
	check (scope in ('institutional')),
	check (jsonb_typeof(metadata) = 'object'),
	check (
		(status = 'running' and finished_at is null)
		or (status in ('succeeded', 'failed') and finished_at is not null)
	)
);

create index idx_snapshot_job_runs_job_started
	on public.snapshot_job_runs (job_id, started_at desc);

create index idx_snapshot_job_runs_target_date
	on public.snapshot_job_runs (target_date desc, started_at desc);

create index idx_snapshot_job_runs_status_started
	on public.snapshot_job_runs (status, started_at desc);

create unique index idx_snapshot_job_runs_active_job_target
	on public.snapshot_job_runs (job_id, target_date)
	where job_id is not null and status = 'running';

alter table public.snapshot_jobs enable row level security;
alter table public.snapshot_job_runs enable row level security;

create policy "snapshot_jobs_select_admin_super_admin"
	on public.snapshot_jobs
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create policy "snapshot_job_runs_select_admin_super_admin"
	on public.snapshot_job_runs
	for select
	to authenticated
	using (
		public.get_user_role((select auth.uid())) in ('admin', 'super_admin')
	);

create or replace function public.create_snapshot_job(
	p_job_key text,
	p_job_name text,
	p_cadence public.snapshot_job_cadence default 'daily',
	p_default_window_days integer default 30,
	p_target_date_offset_days integer default 0,
	p_schedule_config jsonb default '{}'::jsonb,
	p_metadata jsonb default '{}'::jsonb,
	p_is_enabled boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_job_id uuid;
	v_schedule_config jsonb := coalesce(p_schedule_config, '{}'::jsonb);
	v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
	if v_requester_id is null then
		raise exception 'No autorizado para crear jobs de snapshots';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden crear jobs de snapshots';
	end if;

	if btrim(coalesce(p_job_key, '')) = '' then
		raise exception 'snapshot job key es obligatorio';
	end if;

	if btrim(coalesce(p_job_name, '')) = '' then
		raise exception 'snapshot job name es obligatorio';
	end if;

	if coalesce(p_default_window_days, 0) <= 0 then
		raise exception 'window_days debe ser mayor a 0';
	end if;

	if jsonb_typeof(v_schedule_config) <> 'object' then
		raise exception 'schedule_config debe ser un objeto jsonb';
	end if;

	if jsonb_typeof(v_metadata) <> 'object' then
		raise exception 'metadata debe ser un objeto jsonb';
	end if;

	insert into public.snapshot_jobs (
		job_key,
		job_name,
		cadence,
		scope,
		target_date_offset_days,
		default_window_days,
		schedule_config,
		metadata,
		is_enabled,
		created_by
	)
	values (
		btrim(p_job_key),
		btrim(p_job_name),
		p_cadence,
		'institutional',
		p_target_date_offset_days,
		p_default_window_days,
		v_schedule_config,
		v_metadata,
		coalesce(p_is_enabled, true),
		v_requester_id
	)
	returning id
	into v_job_id;

	return v_job_id;
end;
$$;

create or replace function public.run_snapshot_job(
	p_job_id uuid default null,
	p_target_date date default null,
	p_window_days integer default null,
	p_run_type public.snapshot_job_run_type default 'manual',
	p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_job public.snapshot_jobs%rowtype;
	v_run_id uuid;
	v_started_at timestamptz := clock_timestamp();
	v_finished_at timestamptz;
	v_effective_target_date date;
	v_effective_window_days integer;
	v_effective_scope text := 'institutional';
	v_before_snapshot_count integer := 0;
	v_after_snapshot_count integer := 0;
	v_rows_affected integer := 0;
	v_snapshots_created integer := 0;
	v_snapshots_updated integer := 0;
	v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
	v_run_metadata jsonb;
begin
	if v_requester_id is null then
		raise exception 'No autorizado para ejecutar jobs de snapshots';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden ejecutar jobs de snapshots';
	end if;

	if jsonb_typeof(v_metadata) <> 'object' then
		raise exception 'metadata debe ser un objeto jsonb';
	end if;

	if p_job_id is not null then
		select *
		into v_job
		from public.snapshot_jobs
		where id = p_job_id;

		if not found then
			raise exception 'Snapshot job no existe';
		end if;

		if coalesce(v_job.is_enabled, false) is distinct from true then
			raise exception 'Snapshot job esta deshabilitado';
		end if;

		v_effective_scope := v_job.scope;
	end if;

	v_effective_target_date := coalesce(
		p_target_date,
		case
			when p_job_id is not null then current_date + coalesce(v_job.target_date_offset_days, 0)
			else current_date
		end
	);

	v_effective_window_days := coalesce(
		p_window_days,
		case
			when p_job_id is not null then v_job.default_window_days
			else 30
		end
	);

	v_run_metadata := jsonb_build_object(
		'request', jsonb_build_object(
			'jobId', p_job_id,
			'runType', p_run_type,
			'targetDate', v_effective_target_date,
			'windowDays', v_effective_window_days,
			'scope', v_effective_scope
		),
		'job', case
			when p_job_id is null then null
			else jsonb_build_object(
				'jobKey', v_job.job_key,
				'jobName', v_job.job_name,
				'cadence', v_job.cadence,
				'targetDateOffsetDays', v_job.target_date_offset_days
			)
		end,
		'requestMetadata', v_metadata
	);

	insert into public.snapshot_job_runs (
		job_id,
		run_type,
		scope,
		target_date,
		window_days,
		status,
		started_at,
		metadata,
		executed_by
	)
	values (
		p_job_id,
		p_run_type,
		v_effective_scope,
		v_effective_target_date,
		greatest(coalesce(v_effective_window_days, 0), 0),
		'running',
		v_started_at,
		v_run_metadata,
		v_requester_id
	)
	returning id
	into v_run_id;

	select count(*)::integer
	into v_before_snapshot_count
	from public.kpi_daily_snapshots
	where snapshot_date = v_effective_target_date;

	begin
		if p_job_id is null and p_run_type = 'scheduled' then
			raise exception 'Un run scheduled requiere un job persistido';
		end if;

		if v_effective_scope <> 'institutional' then
			raise exception 'Snapshot job scope no soportado';
		end if;

		if coalesce(v_effective_window_days, 0) <= 0 then
			raise exception 'window_days debe ser mayor a 0';
		end if;

		v_rows_affected := public.capture_kpi_daily_snapshot(
			v_effective_target_date,
			v_effective_window_days
		);

		select count(*)::integer
		into v_after_snapshot_count
		from public.kpi_daily_snapshots
		where snapshot_date = v_effective_target_date;

		v_snapshots_created := greatest(v_after_snapshot_count - v_before_snapshot_count, 0);
		v_snapshots_updated := greatest(v_rows_affected - v_snapshots_created, 0);
		v_finished_at := clock_timestamp();

		update public.snapshot_job_runs
		set
			status = 'succeeded',
			finished_at = v_finished_at,
			duration_ms = greatest((extract(epoch from (v_finished_at - v_started_at)) * 1000)::integer, 0),
			snapshots_created = v_snapshots_created,
			snapshots_updated = v_snapshots_updated,
			metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
				'result', jsonb_build_object(
					'rowsAffected', v_rows_affected,
					'beforeSnapshotCount', v_before_snapshot_count,
					'afterSnapshotCount', v_after_snapshot_count,
					'sourceFunction', 'capture_kpi_daily_snapshot'
				)
			)
		where id = v_run_id;

		return jsonb_build_object(
			'runId', v_run_id,
			'jobId', p_job_id,
			'status', 'succeeded',
			'runType', p_run_type,
			'targetDate', v_effective_target_date,
			'windowDays', v_effective_window_days,
			'snapshotsCreated', v_snapshots_created,
			'snapshotsUpdated', v_snapshots_updated,
			'rowsAffected', v_rows_affected
		);
	exception when others then
		v_finished_at := clock_timestamp();

		update public.snapshot_job_runs
		set
			status = 'failed',
			finished_at = v_finished_at,
			duration_ms = greatest((extract(epoch from (v_finished_at - v_started_at)) * 1000)::integer, 0),
			error_message = sqlerrm,
			metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
				'result', jsonb_build_object(
					'errorMessage', sqlerrm,
					'errorState', sqlstate,
					'beforeSnapshotCount', v_before_snapshot_count
				)
			)
		where id = v_run_id;

		return jsonb_build_object(
			'runId', v_run_id,
			'jobId', p_job_id,
			'status', 'failed',
			'runType', p_run_type,
			'targetDate', v_effective_target_date,
			'windowDays', v_effective_window_days,
			'errorMessage', sqlerrm
		);
	end;
end;
$$;

create or replace function public.run_daily_snapshot_now(
	p_target_date date default current_date,
	p_window_days integer default 30,
	p_run_type public.snapshot_job_run_type default 'manual',
	p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
	select public.run_snapshot_job(
		null,
		p_target_date,
		p_window_days,
		p_run_type,
		p_metadata
	);
$$;

create or replace function public.get_snapshot_job_history(
	p_job_id uuid default null,
	p_limit integer default 50
)
returns table (
	run_id uuid,
	job_id uuid,
	job_key text,
	job_name text,
	run_type public.snapshot_job_run_type,
	target_date date,
	window_days integer,
	scope text,
	status public.snapshot_job_run_status,
	started_at timestamptz,
	finished_at timestamptz,
	duration_ms integer,
	snapshots_created integer,
	snapshots_updated integer,
	error_message text,
	executed_by uuid,
	metadata jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_requester_id uuid := (select auth.uid());
	v_requester_role public.user_role;
	v_limit integer := greatest(coalesce(p_limit, 50), 1);
begin
	if v_requester_id is null then
		raise exception 'No autorizado para consultar historial de jobs de snapshots';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden consultar historial de jobs de snapshots';
	end if;

	return query
	select
		run.id,
		run.job_id,
		job.job_key,
		job.job_name,
		run.run_type,
		run.target_date,
		run.window_days,
		run.scope,
		run.status,
		run.started_at,
		run.finished_at,
		run.duration_ms,
		run.snapshots_created,
		run.snapshots_updated,
		run.error_message,
		run.executed_by,
		run.metadata
	from public.snapshot_job_runs as run
	left join public.snapshot_jobs as job
		on job.id = run.job_id
	where p_job_id is null or run.job_id = p_job_id
	order by run.started_at desc, run.created_at desc
	limit v_limit;
end;
$$;

create or replace function public.get_snapshot_job_status(
	p_job_id uuid default null
)
returns table (
	job_id uuid,
	job_key text,
	job_name text,
	cadence public.snapshot_job_cadence,
	scope text,
	is_enabled boolean,
	default_window_days integer,
	target_date_offset_days integer,
	last_run_id uuid,
	last_run_type public.snapshot_job_run_type,
	last_status public.snapshot_job_run_status,
	last_target_date date,
	last_started_at timestamptz,
	last_finished_at timestamptz,
	last_duration_ms integer,
	last_snapshots_created integer,
	last_snapshots_updated integer,
	last_error_message text,
	job_metadata jsonb,
	last_run_metadata jsonb
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
		raise exception 'No autorizado para consultar estado de jobs de snapshots';
	end if;

	select public.get_user_role(v_requester_id)
	into v_requester_role;

	if coalesce(v_requester_role::text, '') not in ('admin', 'super_admin') then
		raise exception 'Solo admin y super_admin pueden consultar estado de jobs de snapshots';
	end if;

	return query
	with latest_runs as (
		select
			run.*,
			row_number() over (
				partition by run.job_id
				order by run.started_at desc, run.created_at desc
			) as row_number
		from public.snapshot_job_runs as run
		where run.job_id is not null
	)
	select
		job.id,
		job.job_key,
		job.job_name,
		job.cadence,
		job.scope,
		job.is_enabled,
		job.default_window_days,
		job.target_date_offset_days,
		latest_run.id,
		latest_run.run_type,
		latest_run.status,
		latest_run.target_date,
		latest_run.started_at,
		latest_run.finished_at,
		latest_run.duration_ms,
		latest_run.snapshots_created,
		latest_run.snapshots_updated,
		latest_run.error_message,
		job.metadata,
		latest_run.metadata
	from public.snapshot_jobs as job
	left join latest_runs as latest_run
		on latest_run.job_id = job.id
		and latest_run.row_number = 1
	where p_job_id is null or job.id = p_job_id
	order by job.created_at asc;
end;
$$;

comment on table public.snapshot_jobs
	is 'Persistent institutional registry for scheduled or on-demand KPI snapshot jobs. Establishes cadence foundation for future reporting jobs.';

comment on table public.snapshot_job_runs
	is 'Auditable execution log for institutional snapshot jobs and manual snapshot runs, including metadata, duration, counts and failure state.';

comment on function public.create_snapshot_job(text, text, public.snapshot_job_cadence, integer, integer, jsonb, jsonb, boolean)
	is 'Creates a persistent institutional snapshot job definition. Admin and super_admin only.';

comment on function public.run_snapshot_job(uuid, date, integer, public.snapshot_job_run_type, jsonb)
	is 'Runs a persistent or ad hoc institutional KPI snapshot capture with full auditable job-run logging and idempotent snapshot upsert semantics.';

comment on function public.run_daily_snapshot_now(date, integer, public.snapshot_job_run_type, jsonb)
	is 'Convenience wrapper for manual or backfill institutional snapshot execution without a persisted job definition.';

comment on function public.get_snapshot_job_history(uuid, integer)
	is 'Returns institutional snapshot job runs ordered by most recent first. Admin and super_admin only.';

comment on function public.get_snapshot_job_status(uuid)
	is 'Returns current status per persisted institutional snapshot job using the latest recorded run. Admin and super_admin only.';

revoke all on table public.snapshot_jobs from public;
revoke all on table public.snapshot_job_runs from public;
revoke all on function public.create_snapshot_job(text, text, public.snapshot_job_cadence, integer, integer, jsonb, jsonb, boolean) from public;
revoke all on function public.run_snapshot_job(uuid, date, integer, public.snapshot_job_run_type, jsonb) from public;
revoke all on function public.run_daily_snapshot_now(date, integer, public.snapshot_job_run_type, jsonb) from public;
revoke all on function public.get_snapshot_job_history(uuid, integer) from public;
revoke all on function public.get_snapshot_job_status(uuid) from public;

grant select on public.snapshot_jobs to authenticated;
grant select on public.snapshot_job_runs to authenticated;

grant execute on function public.create_snapshot_job(text, text, public.snapshot_job_cadence, integer, integer, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.run_snapshot_job(uuid, date, integer, public.snapshot_job_run_type, jsonb) to authenticated;
grant execute on function public.run_daily_snapshot_now(date, integer, public.snapshot_job_run_type, jsonb) to authenticated;
grant execute on function public.get_snapshot_job_history(uuid, integer) to authenticated;
grant execute on function public.get_snapshot_job_status(uuid) to authenticated;
