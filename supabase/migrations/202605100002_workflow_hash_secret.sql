create or replace function public.workflow_hash_secret(p_secret text)
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select extensions.crypt(p_secret, extensions.gen_salt('bf'));
$$;

grant execute on function public.workflow_hash_secret(text) to service_role;
