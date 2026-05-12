alter table public.organizations
  add column if not exists logo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organization-logos',
  'organization-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Organization members can read logos" on storage.objects;
drop policy if exists "Organization operators can upload logos" on storage.objects;
drop policy if exists "Organization operators can update logos" on storage.objects;
drop policy if exists "Organization operators can delete logos" on storage.objects;

create policy "Organization members can read logos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'organization-logos'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);

create policy "Organization operators can upload logos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'organization-logos'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_org_operator(((storage.foldername(name))[1])::uuid)
);

create policy "Organization operators can update logos"
on storage.objects for update
to authenticated
using (
  bucket_id = 'organization-logos'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_org_operator(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'organization-logos'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_org_operator(((storage.foldername(name))[1])::uuid)
);

create policy "Organization operators can delete logos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'organization-logos'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_org_operator(((storage.foldername(name))[1])::uuid)
);
