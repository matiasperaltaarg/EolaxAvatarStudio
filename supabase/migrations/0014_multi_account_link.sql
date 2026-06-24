-- 0014_multi_account_link.sql
-- Forma simple de multi-cuenta: vincula cada usuario a una cuenta vía
-- profiles.account_id. Aditivo, sin romper la cuenta única existente.
-- Correr en Supabase SQL Editor.

-- 1. Columna account_id en profiles (nullable: usuarios sin asignar caen al
--    fallback de la cuenta más antigua en getAccountId()).
alter table public.profiles
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

create index if not exists profiles_account_id_idx on public.profiles (account_id);

-- 2. Asignar la cuenta EXISTENTE (la de pruebas, la más antigua) a TODOS los
--    usuarios actuales — es decir, a vos (admin). Así tu usuario sigue viendo
--    exactamente lo que ve hoy.
update public.profiles p
set account_id = (
  select id from public.accounts order by created_at asc limit 1
)
where p.account_id is null;

-- 3. Crear la cuenta NUEVA y limpia para Eolax.
insert into public.accounts (name)
values ('Eolax')
returning id;
-- 👆 Copiá el id devuelto: lo vas a necesitar en los pasos 4 y 5.

-- =============================================================================
-- LOS PASOS 4 y 5 se corren DESPUÉS de crear el usuario de Eolax en
-- Authentication → Users (Add user, con Auto Confirm). Reemplazá los
-- placeholders por los valores reales.
-- =============================================================================

-- 4. Vincular el usuario de Eolax a la cuenta nueva (NO admin).
--    Reemplazá 'EMAIL_DE_EOLAX' y 'ID_CUENTA_EOLAX' (el id del paso 3).
--
-- update public.profiles
-- set account_id = 'ID_CUENTA_EOLAX',
--     is_admin   = false
-- where id = (select id from auth.users where email = 'EMAIL_DE_EOLAX');

-- 5. Cargar el pack inicial de 30 min (1800s) a la cuenta de Eolax.
--    Vigencia 6 meses (regla de la propuesta). Reemplazá 'ID_CUENTA_EOLAX'.
--
-- insert into public.credit_packs
--   (account_id, pack_type, seconds_total, seconds_used, purchased_at, expires_at)
-- values
--   ('ID_CUENTA_EOLAX', 'pro', 1800, 0, now(), now() + interval '6 months');
