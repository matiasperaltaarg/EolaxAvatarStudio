-- =============================================================================
-- Eolax Avatar Studio — BLOQUE 2: Admin panel
-- Paste this whole block into the Supabase SQL Editor and run it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. profiles table — links Supabase Auth users to app-level flags.
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users read own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

-- Service-role can do anything (admin writes).
grant all on public.profiles to service_role;

-- -----------------------------------------------------------------------------
-- 2. Auto-create a profile row when a new user signs up.
--    For existing users, we insert manually below.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for any existing auth users that don't have one yet.
insert into public.profiles (id)
select id from auth.users
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 3. Remove the pack_type CHECK constraint so admin can grant custom packs.
--    The existing constraint only allows 'starter', 'pro', 'scale'.
-- -----------------------------------------------------------------------------
alter table public.credit_packs drop constraint if exists credit_packs_pack_type_check;

-- =============================================================================
-- MANUAL STEP: Set your account as admin.
-- Replace the email below with your actual email, then run:
--
--   UPDATE public.profiles
--   SET is_admin = true
--   WHERE id = (SELECT id FROM auth.users WHERE email = 'matiasperalta@mtsclub.org');
--
-- =============================================================================
-- Auto-set admin for the known MTS email:
update public.profiles
set is_admin = true
where id = (select id from auth.users where email = 'matiasperalta@mtsclub.org');
