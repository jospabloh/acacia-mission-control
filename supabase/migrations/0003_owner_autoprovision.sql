-- ============================================================================
-- Auto-provision the platform owner on first authentication.
-- When an allowlisted email first lands in auth.users (e.g. via Google OAuth),
-- give it an `owner` members row so it can operate Mission Control without a
-- manual insert. Idempotent; extend the allowlist as more operators are added.
-- ============================================================================
create or replace function public.handle_new_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email in ('h.josepablo@gmail.com') then
    insert into public.members (user_id, email, role)
    values (new.id, new.email, 'owner')
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_member();
