-- =============================================================================
-- Eolax Avatar Studio — Phase 4: autonomous editing
-- (wardrobe/background presets + edited-look cache)
-- Paste this whole block into the Supabase SQL Editor and run it.
-- Idempotent; safe to run on top of Phase 0–3.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Cache of edited avatar images per (avatar, wardrobe, background) combo,
--    so repeat looks don't pay for the kontext edit again.
-- -----------------------------------------------------------------------------
create table if not exists public.avatar_look_cache (
  id                   uuid primary key default gen_random_uuid(),
  avatar_id            uuid not null references public.avatars (id) on delete cascade,
  wardrobe_preset_id   uuid not null references public.wardrobe_presets (id) on delete cascade,
  background_preset_id uuid not null references public.background_presets (id) on delete cascade,
  image_path           text not null,
  created_at           timestamptz not null default now(),
  unique (avatar_id, wardrobe_preset_id, background_preset_id)
);

alter table public.avatar_look_cache enable row level security;

drop policy if exists "avatar_look_cache_authenticated_all" on public.avatar_look_cache;
create policy "avatar_look_cache_authenticated_all"
  on public.avatar_look_cache
  for all to authenticated
  using (true) with check (true);

-- -----------------------------------------------------------------------------
-- 2. Seed wardrobe presets for every avatar that has none yet.
--    params.instruction is the kontext edit instruction (identity preserved
--    by the route). MTS-defined; predefined sets only (no free prompt).
-- -----------------------------------------------------------------------------
insert into public.wardrobe_presets (avatar_id, label, params)
select a.id, x.label, x.params
from public.avatars a
cross join (values
  ('Casual',      '{"instruction":"Change the person''s outfit to smart casual clothing (a plain t-shirt and a light jacket)."}'::jsonb),
  ('Formal',      '{"instruction":"Change the person''s outfit to a formal business suit."}'::jsonb),
  ('Sport',       '{"instruction":"Change the person''s outfit to modern athletic sportswear."}'::jsonb),
  ('Eolax Brand', '{"instruction":"Change the person''s outfit to a clean branded polo shirt in Eolax brand colors."}'::jsonb)
) as x(label, params)
where not exists (
  select 1 from public.wardrobe_presets w where w.avatar_id = a.id
);

-- -----------------------------------------------------------------------------
-- 3. Seed background presets for every avatar that has none yet.
-- -----------------------------------------------------------------------------
insert into public.background_presets (avatar_id, label, params)
select a.id, x.label, x.params
from public.avatars a
cross join (values
  ('Studio',  '{"instruction":"Change the background to a clean professional photo studio backdrop."}'::jsonb),
  ('Nature',  '{"instruction":"Change the background to a natural outdoor scene with soft greenery."}'::jsonb),
  ('Premios', '{"instruction":"Change the background to an awards ceremony stage with warm lights."}'::jsonb),
  ('Neon',    '{"instruction":"Change the background to a vibrant neon-lit urban night scene."}'::jsonb)
) as x(label, params)
where not exists (
  select 1 from public.background_presets b where b.avatar_id = a.id
);
