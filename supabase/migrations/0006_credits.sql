-- =============================================================================
-- Eolax Avatar Studio — Phase 5: credits
-- Paste this whole block into the Supabase SQL Editor and run it.
-- Idempotent; safe to run on top of Phase 0–4.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. One debit per video: a unique video_id in generations_log guards against
--    double-charging on re-polling / duplicate finalize calls.
-- -----------------------------------------------------------------------------
-- Remove any pre-existing duplicates first (keep the earliest per video).
delete from public.generations_log g
using public.generations_log g2
where g.video_id = g2.video_id
  and g.ctid > g2.ctid;

create unique index if not exists generations_log_video_id_key
  on public.generations_log (video_id);

-- -----------------------------------------------------------------------------
-- 2. Helpful index for "oldest non-expired pack first" debit ordering.
-- -----------------------------------------------------------------------------
create index if not exists credit_packs_account_purchased_idx
  on public.credit_packs (account_id, purchased_at);

-- =============================================================================
-- GRANT A PACK TO THE EOLAX ACCOUNT (manual, MVP — no payment gateway yet).
-- Run ONE of these. Pack sizes: starter=600s, pro=1800s, scale=3600s.
-- Expiry is 6 months from now.
-- =============================================================================

-- Grant a PRO pack (1800 seconds / 30 min) to the single Eolax account:
insert into public.credit_packs
  (account_id, pack_type, seconds_total, seconds_used, purchased_at, expires_at)
select id, 'pro', 1800, 0, now(), now() + interval '6 months'
from public.accounts
order by created_at asc
limit 1;

-- Starter (600s):  ... select id, 'starter', 600, 0, now(), now() + interval '6 months' ...
-- Scale (3600s):   ... select id, 'scale', 3600, 0, now(), now() + interval '6 months' ...
