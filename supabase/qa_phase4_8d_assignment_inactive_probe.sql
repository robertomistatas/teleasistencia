begin;

set local role authenticated;
select set_config('request.jwt.claim.sub', '4600f0f9-d2cb-4bc0-9a54-6ab1253bad1a', true);

with unique_contact_phones as (
  select
    bc.phone_normalized,
    bc.phone_raw,
    bc.beneficiary_id,
    b.full_name as beneficiary_name
  from public.beneficiary_contacts as bc
  join public.beneficiaries as b
    on b.id = bc.beneficiary_id
  where bc.phone_normalized is not null
    and bc.is_active = true
    and bc.phone_normalized in (
      select inner_bc.phone_normalized
      from public.beneficiary_contacts as inner_bc
      where inner_bc.phone_normalized is not null
      group by inner_bc.phone_normalized
      having count(distinct inner_bc.beneficiary_id) = 1
    )
),
previewed as (
  select
    candidate.phone_normalized,
    candidate.phone_raw,
    candidate.beneficiary_id,
    candidate.beneficiary_name,
    preview.correlation_status,
    preview.assignment_id_at_call_time,
    preview.responsible_user_id_at_call_time,
    preview.reason,
    public.classify_call_log_correlation_issue(
      'warning'::public.import_row_result_status,
      preview.correlation_status,
      preview.beneficiary_id,
      preview.assignment_id_at_call_time,
      preview.responsible_user_id_at_call_time,
      preview.reason
    ) as issue_type
  from unique_contact_phones as candidate
  cross join lateral public.preview_call_log_correlation(now(), candidate.phone_raw) as preview
)
select *
from previewed
order by issue_type nulls last, beneficiary_name, phone_normalized
limit 20;

rollback;