-- =============================================================================
-- Eolax Avatar Studio — Phase 2: voice cloning (ElevenLabs)
-- Paste this whole block into the Supabase SQL Editor and run it.
-- Idempotent; safe to run on top of Phase 0/1.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Track which reference-audio files belong to each avatar's cloned voice.
--    (elevenlabs_voice_id already exists from the Phase 0 schema.)
-- -----------------------------------------------------------------------------
alter table public.avatars
  add column if not exists voice_reference_paths text[] not null default '{}';

-- -----------------------------------------------------------------------------
-- 2. PRIVATE STORAGE BUCKET for voice reference audio.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatar-voice-references', 'avatar-voice-references', false)
on conflict (id) do update set public = false;

-- -----------------------------------------------------------------------------
-- 3. STORAGE RLS POLICY — authenticated users get full access to this bucket
--    (Phase 2 permissive policy, mirrors the other buckets/tables).
-- -----------------------------------------------------------------------------
drop policy if exists "avatar_voice_refs_authenticated_all" on storage.objects;

create policy "avatar_voice_refs_authenticated_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'avatar-voice-references')
  with check (bucket_id = 'avatar-voice-references');
