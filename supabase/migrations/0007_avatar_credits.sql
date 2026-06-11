-- =============================================================================
-- Eolax Avatar Studio — BLOQUE 1: Avatar credits (two-currency wallet)
-- Paste this whole block into the Supabase SQL Editor and run it.
-- Idempotent; safe to run on top of Phases 0–6.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Avatar credit packs — mirrors credit_packs but counts avatar units.
-- -----------------------------------------------------------------------------
create table if not exists public.avatar_credit_packs (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  credits_total   int not null check (credits_total > 0),
  credits_used    int not null default 0 check (credits_used >= 0),
  purchased_at    timestamptz not null default now(),
  expires_at      timestamptz not null
);

alter table public.avatar_credit_packs enable row level security;

create policy "Accounts read own avatar credit packs"
  on public.avatar_credit_packs for select
  using (account_id = (select id from public.accounts limit 1));

-- Service-role inserts (admin panel, future). Grant INSERT so the admin client
-- can add packs without RLS issues.
grant insert on public.avatar_credit_packs to service_role;

create index if not exists avatar_credit_packs_account_purchased_idx
  on public.avatar_credit_packs (account_id, purchased_at);

-- -----------------------------------------------------------------------------
-- 2. Avatar creation log — one row per avatar, prevents double-debit.
--    avatar_id is unique so a re-run of createAvatar for the same avatar
--    cannot charge twice.
-- -----------------------------------------------------------------------------
create table if not exists public.avatar_creation_log (
  id          uuid primary key default gen_random_uuid(),
  avatar_id   uuid not null unique references public.avatars(id) on delete cascade,
  credits_charged int not null default 1,
  created_at  timestamptz not null default now()
);

alter table public.avatar_creation_log enable row level security;

create policy "Accounts read own avatar creation log"
  on public.avatar_creation_log for select
  using (
    avatar_id in (
      select a.id from public.avatars a
      where a.account_id = (select id from public.accounts limit 1)
    )
  );

-- Service-role does the inserts (debit logic).
grant insert on public.avatar_creation_log to service_role;

-- =============================================================================
-- GRANT AN INITIAL AVATAR CREDIT PACK TO THE EOLAX ACCOUNT.
-- 10 avatar credits, 6-month expiry.
-- =============================================================================
insert into public.avatar_credit_packs
  (account_id, credits_total, credits_used, purchased_at, expires_at)
select id, 10, 0, now(), now() + interval '6 months'
from public.accounts
order by created_at asc
limit 1;
