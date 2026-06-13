-- 0013_clear_poisoned_looks.sql
-- Clears cached "look" images that may have been built on top of a collaged
-- fusion (the multi-image-kontext side-by-side bug). After this, the next time
-- a user applies a look it will be regenerated fresh; the new fusion guard
-- prevents collages from being saved again.
--
-- Run by hand in Supabase SQL Editor. Safe: it only deletes cache ROWS, forcing
-- regeneration. It does NOT delete the underlying avatars or reference photos.
--
-- NOTE: this clears the LOOK cache (cheap to rebuild). It does not attempt to
-- auto-detect which stored fused reference photos are collages — those are now
-- caught at video/start by the face guard, so a bad one can never reach a paid
-- render even if it lingers in storage. If you want to also purge fused photos,
-- do it manually per-avatar after visual review.

begin;

-- Wipe the look cache so every look is regenerated with the current pipeline.
delete from public.avatar_look_cache;

commit;

-- Optional: inspect which avatars have stored fused photos, to review by hand.
-- (Fused photos live under '<account>/<avatar>/fused/...'.)
--
--   select id, account_id,
--          (select count(*) from unnest(reference_photos) p where p like '%/fused/%') as fused_count,
--          reference_photos
--   from public.avatars
--   where exists (select 1 from unnest(reference_photos) p where p like '%/fused/%');
