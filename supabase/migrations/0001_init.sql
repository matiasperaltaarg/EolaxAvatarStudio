-- =============================================================================
-- Eolax Avatar Studio — Phase 0 schema
-- Mirrors CLAUDE.md section 8. Single-account MVP, but modelled for multi-user.
-- Paste this whole block into the Supabase SQL Editor and run it.
-- RLS is enabled on every table with permissive policies for now (Phase 0).
-- Tighten these in a later phase (per-account / per-user policies).
-- =============================================================================

-- Required for gen_random_uuid().
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- accounts — single row in MVP, ready for multi-user later.
-- -----------------------------------------------------------------------------
create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- avatars — brand-exclusive characters based on real people.
-- -----------------------------------------------------------------------------
create table if not exists public.avatars (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts (id) on delete cascade,
  name                text not null,
  status              text not null default 'draft'
                        check (status in ('draft', 'active')),
  reference_photos    text[] not null default '{}',
  elevenlabs_voice_id text,
  rights_confirmed    boolean not null default false,
  default_language    text not null default 'es',
  personality_editable text,
  created_at          timestamptz not null default now()
);

create index if not exists avatars_account_id_idx on public.avatars (account_id);

-- -----------------------------------------------------------------------------
-- wardrobe_presets — MTS-defined wardrobe sets per avatar.
-- -----------------------------------------------------------------------------
create table if not exists public.wardrobe_presets (
  id          uuid primary key default gen_random_uuid(),
  avatar_id   uuid not null references public.avatars (id) on delete cascade,
  label       text not null,
  params      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists wardrobe_presets_avatar_id_idx
  on public.wardrobe_presets (avatar_id);

-- -----------------------------------------------------------------------------
-- background_presets — MTS-defined background/scene sets per avatar.
-- -----------------------------------------------------------------------------
create table if not exists public.background_presets (
  id          uuid primary key default gen_random_uuid(),
  avatar_id   uuid not null references public.avatars (id) on delete cascade,
  label       text not null,
  params      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists background_presets_avatar_id_idx
  on public.background_presets (avatar_id);

-- -----------------------------------------------------------------------------
-- videos — one row per generation (one format = one generation).
-- -----------------------------------------------------------------------------
create table if not exists public.videos (
  id                   uuid primary key default gen_random_uuid(),
  avatar_id            uuid not null references public.avatars (id) on delete cascade,
  script               text,
  language             text,
  aspect_ratio         text check (aspect_ratio in ('9:16', '1:1', '16:9')),
  wardrobe_preset_id   uuid references public.wardrobe_presets (id) on delete set null,
  background_preset_id uuid references public.background_presets (id) on delete set null,
  overlay_text         text,
  status               text not null default 'queued'
                         check (status in ('queued', 'rendering', 'ready', 'failed')),
  duration_seconds     numeric,
  output_url           text,
  created_at           timestamptz not null default now()
);

create index if not exists videos_avatar_id_idx on public.videos (avatar_id);

-- -----------------------------------------------------------------------------
-- credit_packs — purchased seconds of video, 6-month expiry.
-- -----------------------------------------------------------------------------
create table if not exists public.credit_packs (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts (id) on delete cascade,
  pack_type     text not null check (pack_type in ('starter', 'pro', 'scale')),
  seconds_total integer not null,
  seconds_used  integer not null default 0,
  purchased_at  timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '6 months')
);

create index if not exists credit_packs_account_id_idx
  on public.credit_packs (account_id);

-- -----------------------------------------------------------------------------
-- generations_log — audit of seconds charged, incl. regenerations.
-- -----------------------------------------------------------------------------
create table if not exists public.generations_log (
  id               uuid primary key default gen_random_uuid(),
  video_id         uuid not null references public.videos (id) on delete cascade,
  seconds_charged  numeric not null,
  created_at       timestamptz not null default now()
);

create index if not exists generations_log_video_id_idx
  on public.generations_log (video_id);

-- =============================================================================
-- Row Level Security — enabled on every table.
-- Phase 0 policies are permissive (any authenticated user, full access).
-- Replace with per-account scoping in a later phase.
-- =============================================================================

alter table public.accounts          enable row level security;
alter table public.avatars           enable row level security;
alter table public.wardrobe_presets  enable row level security;
alter table public.background_presets enable row level security;
alter table public.videos            enable row level security;
alter table public.credit_packs      enable row level security;
alter table public.generations_log   enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts', 'avatars', 'wardrobe_presets', 'background_presets',
    'videos', 'credit_packs', 'generations_log'
  ]
  loop
    execute format(
      'drop policy if exists %I on public.%I;',
      t || '_authenticated_all', t
    );
    execute format(
      'create policy %I on public.%I
         for all to authenticated
         using (true) with check (true);',
      t || '_authenticated_all', t
    );
  end loop;
end $$;

-- =============================================================================
-- Seed the single Eolax account (idempotent).
-- =============================================================================
insert into public.accounts (name)
select 'Eolax'
where not exists (select 1 from public.accounts);
