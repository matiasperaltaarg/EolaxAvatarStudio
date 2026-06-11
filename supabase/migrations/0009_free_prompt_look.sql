-- =============================================================================
-- Eolax Avatar Studio — BLOQUE 4: Free-prompt kontext (look by free text)
-- Paste this whole block into the Supabase SQL Editor and run it.
-- Idempotent; safe to run on top of Phases 0–6 and BLOQUES 1–2.
-- =============================================================================
--
-- WHY:
-- avatar_look_cache currently keys edited images by (avatar, wardrobe_preset,
-- background_preset). Free-prompt looks have no preset IDs, so we add a
-- prompt_hash column and cache free-prompt edits by (avatar, prompt_hash).
-- Presets keep working exactly as before (they still cache by IDs).
--
-- DESIGN:
-- - The two preset_id columns become NULLABLE so a free-prompt row can omit them.
--   (Existing preset rows are unaffected; they keep both IDs.)
-- - prompt_hash is NULL for preset rows, set for free-prompt rows.
-- - Two PARTIAL unique indexes keep each path's cache key clean and prevent
--   the two paths from ever colliding.
-- -----------------------------------------------------------------------------

-- 1. Make the preset columns nullable (free-prompt rows won't have them).
alter table public.avatar_look_cache
  alter column wardrobe_preset_id drop not null;
alter table public.avatar_look_cache
  alter column background_preset_id drop not null;

-- 2. Add the free-prompt hash column.
alter table public.avatar_look_cache
  add column if not exists prompt_hash text;

-- 3. Drop the old 3-column unique constraint (it assumed both presets present).
--    The constraint name is the table's auto-generated one; drop defensively.
alter table public.avatar_look_cache
  drop constraint if exists avatar_look_cache_avatar_id_wardrobe_preset_id_background_p_key;

-- 4. Partial unique index for the PRESET path (both preset ids present).
create unique index if not exists avatar_look_cache_preset_key
  on public.avatar_look_cache (avatar_id, wardrobe_preset_id, background_preset_id)
  where wardrobe_preset_id is not null and background_preset_id is not null;

-- 5. Partial unique index for the FREE-PROMPT path (prompt_hash present).
create unique index if not exists avatar_look_cache_free_prompt_key
  on public.avatar_look_cache (avatar_id, prompt_hash)
  where prompt_hash is not null;
