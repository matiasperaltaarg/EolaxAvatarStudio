-- =============================================================================
-- Eolax Avatar Studio — 0015: Endurecimiento de RLS (multi-tenant real)
-- Correr a mano en el SQL Editor de Supabase. Idempotente; se puede re-correr.
-- =============================================================================
--
-- QUÉ CAMBIA Y POR QUÉ:
-- Hasta ahora las RLS eran placeholders de Phase 0:
--   * La mayoría de las tablas tenían `using (true) with check (true)` para
--     cualquier usuario autenticado → acceso total, sin aislar cuentas.
--   * Las tablas de créditos de avatar (0007) usaban el hack single-account
--     `account_id = (select id from accounts limit 1)`, que con MÁS DE UNA
--     cuenta filtra datos entre cuentas (devuelve una cuenta arbitraria).
--   * `rate_events` y `api_usage_log` NO tenían RLS habilitado, por lo que el
--     rol `authenticated` podía leerlas/escribirlas vía la anon key.
--
-- Este bloque reemplaza todo eso por scoping real por cuenta del usuario, con
-- bypass para admin. Regla clave de seguridad:
--   * Tablas de datos del usuario (avatars, presets, videos): CRUD completo
--     acotado a la cuenta propia.
--   * Tablas de dinero/auditoría (credit_packs, avatar_credit_packs,
--     generations_log, avatar_creation_log, avatar_look_cache): SELECT-only
--     para el usuario; las ESCRITURAS van SIEMPRE por el cliente service-role
--     (que bypassa RLS). Así un usuario NO puede auto-generarse créditos ni
--     borrar cargos con la anon key.
--   * Tablas solo-servidor (rate_events, api_usage_log): sin acceso para
--     `authenticated`; solo service-role.
--
-- El cliente service-role SIEMPRE bypassa RLS, así que los débitos, finalize,
-- cache de looks, rate limiting y cost logging server-side siguen funcionando.
--
-- NOTA: las políticas de Storage (buckets) son un sistema aparte y no se tocan
-- acá. Endurecerlas queda pendiente como trabajo futuro.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Helpers. SECURITY DEFINER → corren como owner y bypassan RLS al leer
--    profiles/accounts, lo que evita recursión en las policies de esas mismas
--    tablas y hace que un usuario no pueda "ver" filas de otro vía el helper.
-- ---------------------------------------------------------------------------

-- Cuenta del usuario actual. Réplica exacta de getAccountId() en TS:
-- profiles.account_id, con fallback a la cuenta más antigua.
create or replace function public.current_account_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.account_id from public.profiles p where p.id = auth.uid()),
    (select a.id from public.accounts a order by a.created_at asc limit 1)
  );
$$;

-- true si el usuario actual es admin de plataforma (profiles.is_admin).
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

grant execute on function public.current_account_id() to authenticated;
grant execute on function public.is_platform_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Asegurar RLS habilitado en todas las tablas (idempotente).
-- ---------------------------------------------------------------------------
alter table public.accounts             enable row level security;
alter table public.avatars              enable row level security;
alter table public.wardrobe_presets     enable row level security;
alter table public.background_presets   enable row level security;
alter table public.videos               enable row level security;
alter table public.credit_packs         enable row level security;
alter table public.generations_log      enable row level security;
alter table public.avatar_look_cache    enable row level security;
alter table public.avatar_credit_packs  enable row level security;
alter table public.avatar_creation_log  enable row level security;
alter table public.profiles             enable row level security;
alter table public.rate_events          enable row level security;
alter table public.api_usage_log        enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Borrar las policies viejas (permisivas y single-account) y las nuevas
--    (para poder re-correr este bloque sin error).
-- ---------------------------------------------------------------------------
drop policy if exists accounts_authenticated_all           on public.accounts;
drop policy if exists avatars_authenticated_all            on public.avatars;
drop policy if exists wardrobe_presets_authenticated_all   on public.wardrobe_presets;
drop policy if exists background_presets_authenticated_all on public.background_presets;
drop policy if exists videos_authenticated_all             on public.videos;
drop policy if exists credit_packs_authenticated_all       on public.credit_packs;
drop policy if exists generations_log_authenticated_all    on public.generations_log;
drop policy if exists avatar_look_cache_authenticated_all  on public.avatar_look_cache;
drop policy if exists "Accounts read own avatar credit packs" on public.avatar_credit_packs;
drop policy if exists "Accounts read own avatar creation log" on public.avatar_creation_log;
drop policy if exists "Users read own profile"             on public.profiles;

drop policy if exists accounts_select            on public.accounts;
drop policy if exists avatars_rw                 on public.avatars;
drop policy if exists wardrobe_presets_rw        on public.wardrobe_presets;
drop policy if exists background_presets_rw      on public.background_presets;
drop policy if exists videos_rw                  on public.videos;
drop policy if exists credit_packs_select        on public.credit_packs;
drop policy if exists generations_log_select     on public.generations_log;
drop policy if exists avatar_look_cache_select   on public.avatar_look_cache;
drop policy if exists avatar_credit_packs_select on public.avatar_credit_packs;
drop policy if exists avatar_creation_log_select on public.avatar_creation_log;
drop policy if exists profiles_select            on public.profiles;

-- ---------------------------------------------------------------------------
-- 4. Policies nuevas.
-- ---------------------------------------------------------------------------

-- accounts: cada quien ve su cuenta; admin ve todas. Sin escritura de cliente.
create policy accounts_select on public.accounts
  for select to authenticated
  using (id = public.current_account_id() or public.is_platform_admin());

-- avatars: CRUD completo acotado a la cuenta propia (el CRUD de /avatars usa el
-- cliente autenticado). Admin bypass.
create policy avatars_rw on public.avatars
  for all to authenticated
  using (account_id = public.current_account_id() or public.is_platform_admin())
  with check (account_id = public.current_account_id() or public.is_platform_admin());

-- wardrobe_presets / background_presets: acotados vía el avatar dueño.
create policy wardrobe_presets_rw on public.wardrobe_presets
  for all to authenticated
  using (exists (
    select 1 from public.avatars a
    where a.id = wardrobe_presets.avatar_id
      and (a.account_id = public.current_account_id() or public.is_platform_admin())
  ))
  with check (exists (
    select 1 from public.avatars a
    where a.id = wardrobe_presets.avatar_id
      and (a.account_id = public.current_account_id() or public.is_platform_admin())
  ));

create policy background_presets_rw on public.background_presets
  for all to authenticated
  using (exists (
    select 1 from public.avatars a
    where a.id = background_presets.avatar_id
      and (a.account_id = public.current_account_id() or public.is_platform_admin())
  ))
  with check (exists (
    select 1 from public.avatars a
    where a.id = background_presets.avatar_id
      and (a.account_id = public.current_account_id() or public.is_platform_admin())
  ));

-- videos: acotados vía el avatar dueño. (finalize inserta por service-role;
-- gallery/studio leen por el cliente autenticado.)
create policy videos_rw on public.videos
  for all to authenticated
  using (exists (
    select 1 from public.avatars a
    where a.id = videos.avatar_id
      and (a.account_id = public.current_account_id() or public.is_platform_admin())
  ))
  with check (exists (
    select 1 from public.avatars a
    where a.id = videos.avatar_id
      and (a.account_id = public.current_account_id() or public.is_platform_admin())
  ));

-- credit_packs: SELECT-only para el usuario (ver saldo). Las altas de packs las
-- hace el admin por service-role. NADA de INSERT/UPDATE/DELETE por anon key.
create policy credit_packs_select on public.credit_packs
  for select to authenticated
  using (account_id = public.current_account_id() or public.is_platform_admin());

-- generations_log: SELECT-only, acotado vía video → avatar. Escrituras (cargos)
-- solo por service-role.
create policy generations_log_select on public.generations_log
  for select to authenticated
  using (exists (
    select 1 from public.videos v
    join public.avatars a on a.id = v.avatar_id
    where v.id = generations_log.video_id
      and (a.account_id = public.current_account_id() or public.is_platform_admin())
  ));

-- avatar_look_cache: SELECT-only, acotado vía avatar. Escrituras por service-role
-- (rutas /look y /tryon).
create policy avatar_look_cache_select on public.avatar_look_cache
  for select to authenticated
  using (exists (
    select 1 from public.avatars a
    where a.id = avatar_look_cache.avatar_id
      and (a.account_id = public.current_account_id() or public.is_platform_admin())
  ));

-- avatar_credit_packs: SELECT-only (ver saldo de créditos de avatar).
create policy avatar_credit_packs_select on public.avatar_credit_packs
  for select to authenticated
  using (account_id = public.current_account_id() or public.is_platform_admin());

-- avatar_creation_log: SELECT-only, acotado vía avatar. Escrituras por service-role.
create policy avatar_creation_log_select on public.avatar_creation_log
  for select to authenticated
  using (exists (
    select 1 from public.avatars a
    where a.id = avatar_creation_log.avatar_id
      and (a.account_id = public.current_account_id() or public.is_platform_admin())
  ));

-- profiles: el usuario lee su propio perfil; admin lee todos. Escrituras por el
-- trigger (security definer) / service-role.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_platform_admin());

-- rate_events / api_usage_log: tablas SOLO server-side. RLS habilitado + SIN
-- policies para `authenticated` → el rol authenticated no puede leerlas ni
-- escribirlas; el service-role las usa y bypassa RLS.
-- (No se crea ninguna policy a propósito.)
