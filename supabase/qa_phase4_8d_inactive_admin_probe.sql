begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '63a214b3-b060-4916-8539-1ed0e896ebed', true);

select auth.uid() as simulated_uid, public.get_user_role(auth.uid()) as simulated_role;
select public.get_call_import_monitoring_summary(5) as monitoring_summary;

rollback;