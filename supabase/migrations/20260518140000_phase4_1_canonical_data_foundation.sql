-- =============================================
-- phase4_1_canonical_data_foundation
-- Helpers canonicos reutilizables para identidad,
-- telefono, contacto efectivo y estado de seguimiento.
-- =============================================

create or replace function public.normalize_rut(input text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
	v_cleaned text;
begin
	if input is null or btrim(input) = '' then
		return null;
	end if;

	v_cleaned := upper(regexp_replace(btrim(input), '[\.\-\s]+', '', 'g'));

	if v_cleaned = '' then
		return null;
	end if;

	if v_cleaned !~ '^[0-9]+K?$' then
		return null;
	end if;

	if position('K' in left(v_cleaned, greatest(length(v_cleaned) - 1, 0))) > 0 then
		return null;
	end if;

	return v_cleaned;
end;
$$;

comment on function public.normalize_rut(text)
	is 'Normaliza RUT removiendo puntos, guiones y espacios, preservando el DV y retornando NULL para valores vacios.';

create or replace function public.normalize_chilean_phone(input text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
	v_trimmed text;
	v_digits text;
	v_candidate text;
begin
	if input is null or btrim(input) = '' then
		return null;
	end if;

	v_trimmed := btrim(input);

	if v_trimmed !~ '^[0-9\+\s\-\(\)\.]+$' then
		return null;
	end if;

	v_digits := regexp_replace(v_trimmed, '[\s\-\(\)\.]', '', 'g');

	if v_digits = '' then
		return null;
	end if;

	if length(v_digits) - length(replace(v_digits, '+', '')) > 1 then
		return null;
	end if;

	if position('+' in v_digits) > 1 then
		return null;
	end if;

	if v_digits like '+56%' then
		v_digits := substring(v_digits from 4);
	elseif v_digits like '56%' then
		v_candidate := substring(v_digits from 3);
	elseif position('+' in v_digits) > 0 then
		return null;
	else
		v_candidate := v_digits;
	end if;

	if v_candidate is null then
		v_candidate := v_digits;
	end if;

	if v_candidate ~ '^9[0-9]{8}$' then
		return v_candidate;
	end if;

	return null;
end;
$$;

comment on function public.normalize_chilean_phone(text)
	is 'Normaliza telefonos moviles chilenos al formato de 9 digitos y retorna NULL cuando no se puede resolver validamente.';

create or replace function public.calculate_followup_status(
	last_effective_contact_at timestamptz,
	reference_date timestamptz default now()
)
returns public.followup_status
language plpgsql
stable
set search_path = public
as $$
declare
	v_reference_date timestamptz := coalesce(reference_date, now());
	v_days_since_contact integer;
begin
	if last_effective_contact_at is null then
		return 'no_data';
	end if;

	v_days_since_contact := greatest(
		0,
		(v_reference_date at time zone 'UTC')::date - (last_effective_contact_at at time zone 'UTC')::date
	);

	if v_days_since_contact <= 15 then
		return 'up_to_date';
	elseif v_days_since_contact <= 30 then
		return 'pending';
	end if;

	return 'urgent';
end;
$$;

comment on function public.calculate_followup_status(timestamptz, timestamptz)
	is 'Calcula el estado canonico de seguimiento reutilizando public.followup_status y comparando dias calendario en UTC.';

create or replace function public.is_effective_contact(normalized_outcome text)
returns boolean
language sql
immutable
set search_path = public
as $$
	select coalesce(lower(btrim(normalized_outcome)) = 'contacto_efectivo', false)
$$;

comment on function public.is_effective_contact(text)
	is 'Define centralmente si un outcome normalizado representa contacto efectivo.';

create or replace function public.recalculate_beneficiary_followup_status_internal(p_beneficiary_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_last_valid_followup_at timestamptz;
	v_last_valid_followup_event_id uuid;
	v_days_since_last_valid_followup integer;
	v_status public.followup_status;
	v_reference_date timestamptz := now();
begin
	if p_beneficiary_id is null then
		raise exception 'p_beneficiary_id no puede ser null';
	end if;

	with valid_followup_events as (
		select
			fe.occurred_at as contact_at,
			fe.id as followup_event_id,
			0 as source_priority
		from public.followup_events as fe
		where fe.beneficiary_id = p_beneficiary_id
			and (
				fe.is_valid_followup = true
				or fe.event_type in ('contact_beneficiary', 'contact_support_network')
			)
	),
	valid_call_interactions as (
		select
			coalesce(ci.started_at, ci.ended_at, ci.call_date::timestamptz) as contact_at,
			null::uuid as followup_event_id,
			1 as source_priority
		from public.call_interactions as ci
		where ci.beneficiary_id = p_beneficiary_id
			and ci.duration_seconds >= 10
			and ci.counts_as_valid_followup = true
			and ci.matched_status = 'matched'
	),
	valid_contacts as (
		select *
		from valid_followup_events
		union all
		select *
		from valid_call_interactions
	)
	select
		vc.contact_at,
		vc.followup_event_id
	into
		v_last_valid_followup_at,
		v_last_valid_followup_event_id
	from valid_contacts as vc
	where vc.contact_at is not null
	order by vc.contact_at desc, vc.source_priority asc
	limit 1;

	if v_last_valid_followup_at is null then
		v_days_since_last_valid_followup := null;
	else
		v_days_since_last_valid_followup := greatest(
			0,
			(v_reference_date at time zone 'UTC')::date - (v_last_valid_followup_at at time zone 'UTC')::date
		);
	end if;

	v_status := public.calculate_followup_status(v_last_valid_followup_at, v_reference_date);

	insert into public.beneficiary_followup_status (
		beneficiary_id,
		status,
		last_valid_followup_at,
		last_valid_followup_event_id,
		days_since_last_valid_followup,
		calculated_at,
		updated_at
	)
	values (
		p_beneficiary_id,
		v_status,
		v_last_valid_followup_at,
		v_last_valid_followup_event_id,
		v_days_since_last_valid_followup,
		v_reference_date,
		v_reference_date
	)
	on conflict (beneficiary_id) do update
	set
		status = excluded.status,
		last_valid_followup_at = excluded.last_valid_followup_at,
		last_valid_followup_event_id = excluded.last_valid_followup_event_id,
		days_since_last_valid_followup = excluded.days_since_last_valid_followup,
		calculated_at = excluded.calculated_at,
		updated_at = excluded.updated_at;
end;
$$;

comment on function public.recalculate_beneficiary_followup_status_internal(uuid)
	is 'Recalcula beneficiary_followup_status reutilizando la funcion canonica public.calculate_followup_status.';
