alter table public.beneficiaries
	add column full_name text;

alter type public.contact_type
	add value if not exists 'support_network';

alter table public.beneficiary_contacts
	add column counts_as_valid_followup boolean not null default true;

create unique index idx_beneficiary_contacts_unique_phone_per_beneficiary
	on public.beneficiary_contacts (beneficiary_id, phone_normalized)
	where phone_normalized is not null and phone_normalized <> '';
