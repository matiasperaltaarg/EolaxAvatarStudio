-- =============================================================================
-- Eolax Avatar Studio — Phase 3: generated content storage (audio + video)
-- Paste this whole block into the Supabase SQL Editor and run it.
-- Idempotent; safe to run on top of Phase 0/1/2.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PRIVATE STORAGE BUCKET for generated audio + video.
-- (The `videos` table already exists from the Phase 0 schema. output_url
--  stores the storage path; signed URLs are generated on demand for
--  playback/download since they expire.)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('generated-content', 'generated-content', false)
on conflict (id) do update set public = false;

-- -----------------------------------------------------------------------------
-- STORAGE RLS POLICY — authenticated users get full access to this bucket
-- (Phase 3 permissive policy, mirrors the other buckets/tables).
-- -----------------------------------------------------------------------------
drop policy if exists "generated_content_authenticated_all" on storage.objects;

create policy "generated_content_authenticated_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'generated-content')
  with check (bucket_id = 'generated-content');
