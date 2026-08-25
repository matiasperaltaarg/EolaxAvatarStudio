-- =============================================================================
-- Eolax Avatar Studio — 0016: Borrado de contenido sin perder la auditoría
-- Correr a mano en el SQL Editor de Supabase, DESPUÉS de la 0015.
-- Idempotente; se puede re-correr.
-- =============================================================================
--
-- QUÉ CAMBIA Y POR QUÉ:
-- La app ahora deja eliminar vídeos y avatares desde la UI. Con el schema
-- anterior eso rompía la auditoría de dinero:
--
--   videos.avatar_id        → on delete cascade  (borrar avatar borra sus vídeos)
--   generations_log.video_id→ on delete cascade  (borrar vídeo borra el CARGO)
--
-- Es decir: borrar un vídeo borraba también la fila que registra los segundos
-- cobrados, mientras `credit_packs.seconds_used` seguía descontado. El saldo no
-- cambiaba (bien: borrar NO devuelve créditos) pero el "Consumo reciente"
-- perdía la línea → la auditoría dejaba de cuadrar con el saldo.
--
-- Solución: desacoplar el log del vídeo.
--   * `generations_log.video_id` pasa a ser NULLABLE con `on delete set null`.
--     El índice único sigue vigente (Postgres permite múltiples NULL), así que
--     la idempotencia por vídeo NO cambia: un re-finalize sigue sin recobrar.
--   * Se agregan `account_id`, `avatar_name` y `language` desnormalizados para
--     que la línea de consumo siga siendo legible cuando el vídeo (o el avatar)
--     ya no existe.
--   * La policy de SELECT y la RPC `debit_video_seconds` se actualizan para
--     usar `account_id` en vez del join vía vídeo.
--
-- NOTA sobre `avatar_creation_log`: se deja como está. Es un guard de
-- idempotencia interno (no se muestra en ninguna pantalla) y borrar un avatar
-- borra su fila; el crédito de avatar YA consumido queda igualmente descontado
-- en `avatar_credit_packs.credits_used`, así que el saldo no se ve afectado.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 0. Helpers de la 0015 (se re-declaran para que este bloque corra solo).
-- ---------------------------------------------------------------------------
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
-- 1. generations_log: columnas desnormalizadas + FK que sobrevive al borrado.
-- ---------------------------------------------------------------------------
alter table public.generations_log
  add column if not exists account_id  uuid references public.accounts (id) on delete cascade,
  add column if not exists avatar_name text,
  add column if not exists language    text;

alter table public.generations_log alter column video_id drop not null;

alter table public.generations_log
  drop constraint if exists generations_log_video_id_fkey;

alter table public.generations_log
  add constraint generations_log_video_id_fkey
  foreign key (video_id) references public.videos (id) on delete set null;

-- Backfill de las filas históricas antes de que la app dependa de account_id.
update public.generations_log gl
   set account_id  = coalesce(gl.account_id, a.account_id),
       avatar_name = coalesce(gl.avatar_name, a.name),
       language    = coalesce(gl.language, v.language)
  from public.videos v
  join public.avatars a on a.id = v.avatar_id
 where v.id = gl.video_id
   and (gl.account_id is null or gl.avatar_name is null or gl.language is null);

create index if not exists generations_log_account_id_idx
  on public.generations_log (account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Policy de SELECT: por account_id (con fallback al join para filas viejas
--    que no se hayan podido backfillear).
-- ---------------------------------------------------------------------------
alter table public.generations_log enable row level security;

drop policy if exists generations_log_authenticated_all on public.generations_log;
drop policy if exists generations_log_select            on public.generations_log;

create policy generations_log_select on public.generations_log
  for select to authenticated
  using (
    account_id = public.current_account_id()
    or public.is_platform_admin()
    or exists (
      select 1
        from public.videos v
        join public.avatars a on a.id = v.avatar_id
       where v.id = generations_log.video_id
         and a.account_id = public.current_account_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. RPC de débito: guarda también cuenta + etiquetas del consumo.
--    Misma firma y mismo contrato que la 0010 (charged, seconds_charged).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION debit_video_seconds(
  p_account_id UUID,
  p_video_id UUID,
  p_seconds INT
) RETURNS TABLE(charged BOOLEAN, seconds_charged INT) AS $$
DECLARE
  v_balance INT;
  v_remaining INT;
  v_pack RECORD;
  v_take INT;
  v_available INT;
  v_avatar_name TEXT;
  v_language TEXT;
BEGIN
  -- Idempotencia: ya cobrado → false.
  IF EXISTS (SELECT 1 FROM generations_log WHERE video_id = p_video_id) THEN
    RETURN QUERY SELECT FALSE, 0;
    RETURN;
  END IF;

  -- Saldo disponible entre packs no vencidos (con lock).
  SELECT COALESCE(SUM(GREATEST(0, cp.seconds_total - cp.seconds_used)), 0)::INT
    INTO v_balance
    FROM credit_packs cp
   WHERE cp.account_id = p_account_id
     AND cp.expires_at > NOW()
     FOR UPDATE;

  IF v_balance < p_seconds THEN
    RETURN QUERY SELECT FALSE, 0;
    RETURN;
  END IF;

  -- Etiquetas del consumo, para que la línea siga siendo legible si el vídeo
  -- o el avatar se borran más adelante.
  SELECT a.name, v.language
    INTO v_avatar_name, v_language
    FROM videos v
    JOIN avatars a ON a.id = v.avatar_id
   WHERE v.id = p_video_id;

  -- Reclamar el cargo (video_id es único).
  INSERT INTO generations_log (video_id, seconds_charged, account_id, avatar_name, language)
  VALUES (p_video_id, p_seconds, p_account_id, v_avatar_name, v_language);

  -- Débito FIFO entre packs, el más viejo primero.
  v_remaining := p_seconds;
  FOR v_pack IN
    SELECT cp.id, cp.seconds_total, cp.seconds_used
      FROM credit_packs cp
     WHERE cp.account_id = p_account_id
       AND cp.expires_at > NOW()
     ORDER BY cp.purchased_at ASC
       FOR UPDATE
  LOOP
    IF v_remaining <= 0 THEN EXIT; END IF;
    v_available := GREATEST(0, v_pack.seconds_total - v_pack.seconds_used);
    IF v_available <= 0 THEN CONTINUE; END IF;
    v_take := LEAST(v_available, v_remaining);
    UPDATE credit_packs SET seconds_used = seconds_used + v_take WHERE id = v_pack.id;
    v_remaining := v_remaining - v_take;
  END LOOP;

  RETURN QUERY SELECT TRUE, p_seconds;
END;
$$ LANGUAGE plpgsql;
