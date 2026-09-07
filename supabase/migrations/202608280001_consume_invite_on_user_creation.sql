create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.blueprints (owner_id) values (new.id) on conflict (owner_id) do nothing;
  update private.invite_allowlist
  set status = 'used', used_by = new.id, used_at = now()
  where email = new.email::extensions.citext and status = 'active';
  return new;
end;
$$;
