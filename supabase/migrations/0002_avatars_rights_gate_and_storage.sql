-- =============================================================================
-- Eolax Avatar Studio — Phase 1: rights gate + reference-photo storage
-- Paste this whole block into the Supabase SQL Editor and run it.
-- Safe to run on top of the Phase 0 schema; idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. RIGHTS GATE — data-layer enforcement.
--    An avatar can never be 'active' while rights_confirmed is false.
--    This is the hard backstop behind the server-side check in the app.
-- -----------------------------------------------------------------------------
alter table public.avatars
  drop constraint if exists avatars_active_requires_rights;

alter table public.avatars
  add constraint avatars_active_requires_rights
  check (status <> 'active' or rights_confirmed = true);

-- -----------------------------------------------------------------------------
-- 2. PRIVATE STORAGE BUCKET for reference photos.
--    public = false → objects are only reachable via signed URLs.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatar-reference-photos', 'avatar-reference-photos', false)
on conflict (id) do update set public = false;

-- -----------------------------------------------------------------------------
-- 3. STORAGE RLS POLICIES — authenticated users get full access to this
--    bucket (Phase 1 permissive policy, mirrors the table policies).
--    Tighten to per-account path scoping in a later phase.
-- -----------------------------------------------------------------------------
drop policy if exists "avatar_ref_photos_authenticated_all" on storage.objects;

create policy "avatar_ref_photos_authenticated_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'avatar-reference-photos')
  with check (bucket_id = 'avatar-reference-photos');
