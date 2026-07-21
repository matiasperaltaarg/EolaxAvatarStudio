# CLAUDE.md — Eolax Avatar Studio

> Archivo de contexto para Claude Code. **Leé esto primero** en cada sesión
> en vez de re-escanear todo el repo. Mantenelo actualizado: cuando cambie
> algo importante (arquitectura, migración, ruta, decisión), anotalo acá —
> especialmente en el **Registro de cambios** al final.
>
> Última actualización: 2026-07-20

---

## 1. Qué es el proyecto

App web para que el equipo de **Eolax** produzca **videos de avatares con IA**
(talking-head, lip-sync) para redes sociales, usando avatares exclusivos de la
marca. Desarrollada y operada por **MTS Studios**.

Es una **capa de orquestación** sobre APIs de IA existentes: no entrena
modelos, sino que encadena voz + imagen + video + LLM en un pipeline de estudio.

**Idioma del producto:** español (Rioplatense/Argentina). La UI y los mensajes
al usuario van en español. Los comentarios de código y prompts a los modelos
suelen ir en inglés.

---

## 2. Stack

- **Next.js 16** (App Router, TypeScript, React 19) — desplegado en **Vercel**.
- **Supabase** — Postgres + Auth + Storage, vía `@supabase/ssr`.
- Sin librería de tests todavía. Verificación = `npx next build` + prueba en la
  URL de Vercel.
- Alias de imports: `@/*` → `src/*` (ver `tsconfig.json`).

### APIs externas (todas server-side, keys nunca en el browser)
| Proveedor | Uso | Cliente |
|---|---|---|
| **ElevenLabs** | Clonado de voz + TTS | `src/lib/elevenlabs.ts` |
| **WaveSpeedAI (InfiniteTalk)** | Video lip-sync 720p | `src/lib/wavespeed.ts` |
| **Replicate (flux-kontext-pro + face-swap)** | Edición de imagen + fusión cara/cuerpo | `src/lib/replicate.ts` |
| **Google Gemini (Nano Banana 2)** | Try-on / composición de outfit completo | `src/lib/gemini-image.ts` |
| **OpenRouter (Claude Haiku/Sonnet)** | Mejora/traducción de guion, enrich de voz, face-guard | `src/lib/openrouter.ts`, `src/lib/face-guard.ts` |

---

## 3. Arquitectura y flujo principal

El corazón es **`/studio`** (`src/app/studio/Studio.tsx`, componente cliente
grande). Pipeline de generación de un video:

1. **Guion** → el usuario escribe; opcional mejorar (`/api/studio/improve`) y
   traducir (`/api/studio/translate`) vía LLM.
2. **Look / vestuario** (opcional):
   - `/api/studio/look` — edita la imagen del avatar por texto libre
     (flux-kontext-pro). El texto libre pasa por `enrichLookPrompt` (ES→EN).
   - `/api/studio/tryon` — compone un **outfit completo** con Gemini a partir de
     la foto del avatar + 0..N fotos de prendas + instrucción.
   - `/api/studio/fuse` — fusiona una cara sobre un cuerpo (face-swap Replicate).
3. **Voz** → `/api/studio/voice` genera TTS con la voz clonada del avatar.
   Antes del TTS, el guion pasa por `enrichForNaturalSpeech` (agrega tags v3 y
   puntuación **sin cambiar las palabras**; hay un safety-net que revierte al
   texto original si el LLM alteró palabras).
4. **Video** →
   - `/api/studio/video/start` — sube el job a InfiniteTalk. **Antes** corre el
     `face-guard` (`inspectFace`) sobre la imagen para rechazar collages / >1
     cara antes de pagar el render.
   - `/api/studio/video/status` — polling del estado.
   - `/api/studio/finalize` — descarga el video, lo guarda en Storage, inserta
     la fila y **debita créditos** (atómico, idempotente).

### Reglas de seguridad del pipeline
- **Débitos siempre server-side** con el cliente **service-role** (bypassa RLS).
  Nunca confiar en el cliente para chequear/descontar créditos.
- **Idempotencia:** `generations_log.video_id` es único → un re-finalize no
  vuelve a cobrar. Ídem `avatar_creation_log.avatar_id`.
- **Rate limiting** por cuenta/ruta (`src/lib/rateLimit.ts`, tabla
  `rate_events`).
- **Cost logging** de cada llamada a API paga (`src/lib/usageLog.ts`, tabla
  `api_usage_log`).

---

## 4. Modelo de datos (dos monedas de crédito)

Sistema de **dos monedas**, ambas en packs con vencimiento (6 meses):

1. **Segundos de video** (`credit_packs`) — se descuentan al finalizar un video.
   Balance = suma de `seconds_total - seconds_used` sobre packs no vencidos.
   Débito FIFO (pack más viejo primero), atómico vía RPC `debit_video_seconds`.
2. **Créditos de avatar** (`avatar_credit_packs`) — 1 crédito por avatar creado.

Lógica en `src/lib/credits.ts`.

### Cuentas y usuarios
- Cada usuario se vincula a una cuenta vía `profiles.account_id`
  (`getAccountId()` en `src/lib/account.ts`). Fallback: cuenta más antigua
  (compatibilidad con la etapa single-account).
- **Admin:** `profiles.is_admin = true` (`src/lib/admin.ts`). El panel `/admin`
  permite otorgar créditos y ver balances/logs. Owner: `matiasperalta@mtsclub.org`.

---

## 5. Mapa de archivos

### Librerías (`src/lib/`)
| Archivo | Qué hace |
|---|---|
| `supabase/server.ts` | Cliente Supabase server-side (cookies/auth) |
| `supabase/client.ts` | Cliente browser (Client Components) |
| `supabase/admin.ts` | Cliente **service-role** (bypassa RLS, para débitos) |
| `supabase/middleware.ts` / `env.ts` | Refresh de sesión + protección de rutas / env validado |
| `account.ts` | `getAccountId()` — resolución cuenta-por-usuario |
| `admin.ts` | `isAdmin()` |
| `credits.ts` | Wallet de dos monedas + débitos atómicos/idempotentes |
| `avatars.ts` | Tipos/constantes de avatar, buckets, idiomas, acentos, aspect ratios |
| `elevenlabs.ts` | Clonado de voz + TTS |
| `wavespeed.ts` | InfiniteTalk (video lip-sync) |
| `replicate.ts` | Edición de imagen (kontext) + fusión cara/cuerpo (face-swap) |
| `gemini-image.ts` | Composición de outfit completo (try-on) |
| `openrouter.ts` | LLM: mejora/traducción de guion, enrich de look y de voz |
| `face-guard.ts` | Verifica 1 sola cara / no-collage antes del video |
| `rateLimit.ts` | Rate limiting por cuenta/ruta |
| `usageLog.ts` | Log de costos de APIs |
| `studio-auth.ts` | `authedContext()` compartido por las rutas de studio |
| `brand.ts` | Config de marca (nombre, tagline, logo) |

### Rutas / páginas (`src/app/`)
| Ruta | Notas |
|---|---|
| `/login` | Email/password (sin sign-up público) |
| `/auth/set-password` | Set password para usuarios invitados |
| `/studio` | Pipeline completo de generación (`Studio.tsx`) |
| `/gallery` | Videos generados |
| `/credits` | Balances (2 monedas), packs, consumo |
| `/avatars`, `/avatars/new`, `/avatars/[id]` | CRUD de avatares, fotos, derechos, voz |
| `/admin` | Solo admin: otorgar créditos, ver balances/logs |

Layout: `AppShell.tsx` (server, computa balances + isAdmin) → `Sidebar.tsx`
(cliente, nav + créditos) → `BrandMark.tsx` (logo EOLAX).

### API routes (`src/app/api/studio/` salvo indicado)
`voice`, `improve`, `translate`, `look`, `tryon`, `fuse`, `finalize`,
`video/start`, `video/status`, y `avatars/[id]/voice/{clone,preview}`.

---

## 6. Migraciones Supabase (`supabase/migrations/`)

**Se corren a mano en el SQL Editor de Supabase** (son "paste-ready", en orden).
No hay runner automático. Todas idempotentes.

| # | Qué agrega |
|---|---|
| 0001 | Schema inicial: accounts, avatars, presets, videos, credit_packs, generations_log, RLS, seed Eolax |
| 0002 | Rights gate en avatars + bucket de fotos |
| 0003 | Voice cloning (voice_reference_paths + bucket) |
| 0004 | Bucket generated-content |
| 0005 | Autonomous editing: avatar_look_cache + seed de presets |
| 0006 | Índices de créditos + grant pack Pro |
| 0007 | avatar_credit_packs + avatar_creation_log (2ª moneda) |
| 0008 | profiles + is_admin + trigger; drop de CHECK en pack_type |
| 0009 | prompt_hash en look_cache (free-prompt looks) |
| 0010 | RPC `debit_video_seconds` (débito atómico) |
| 0011 | rate_events (rate limiting) |
| 0012 | api_usage_log (costos) |
| 0013 | Limpia looks "envenenados" (cache de collages viejos) |
| 0014 | `profiles.account_id` (multi-cuenta simple) |
| 0015 | **Endurecimiento de RLS**: scoping real por cuenta + bypass admin; helpers `current_account_id()` / `is_platform_admin()`; tablas de dinero/log en SELECT-only; RLS en rate_events/api_usage_log |

---

## 7. Variables de entorno

Todas en Vercel (Production/Preview/Development). Nunca commitear secrets;
nada de API keys con prefijo `NEXT_PUBLIC_`. Referencia completa en
`.env.example`. Claves:

```
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY   # únicas públicas
SUPABASE_SERVICE_ROLE_KEY        # server-only, bypassa RLS
ELEVENLABS_API_KEY (+ MODEL_ID, OUTPUT_FORMAT, STABILITY, SIMILARITY, STYLE, SPEAKER_BOOST)
OPENROUTER_API_KEY (+ OPENROUTER_MODEL, OPENROUTER_VISION_MODEL)
REPLICATE_API_TOKEN (+ REPLICATE_KONTEXT_MODEL, REPLICATE_FACESWAP_MODEL)
WAVESPEED_API_KEY (+ WAVESPEED_RESOLUTION)
GEMINI_API_KEY (+ GEMINI_IMAGE_MODEL)
# Opcional: FACE_GUARD_STRICT=1 para que el face-guard falle cerrado
```

---

## 8. Workflow y convenciones

- **Verificar antes de pushear:** `npx next build` debe compilar limpio.
- **Git:** el repo usa **branches + Pull Requests** (los PRs se mergean a
  `main`; Vercel auto-deploya desde `main`). *(Nota: el `SESSION_HANDOFF.md`
  viejo decía "push directo a main sin branches" — eso ya no aplica.)*
- **Validación deploy-first:** la fuente de verdad es la URL de Vercel, no
  localhost.
- **SQL a mano:** las migraciones son referencia; el usuario las corre en el
  SQL Editor de Supabase.
- **Datos reales:** no mostrar métricas/stats falsas ni placeholders. Dato real
  o nada.
- **No tocar código no relacionado:** un cambio de lógica no toca estilos y
  viceversa.

---

## 9. Deuda técnica / cosas a saber

- **RLS endurecido en la DB (migración 0015)** — scoping real por cuenta vía
  `current_account_id()` con bypass admin (`is_platform_admin()`). Las tablas de
  dinero/auditoría son SELECT-only para el usuario (las escrituras van por
  service-role). **Pendiente:** requiere correr la 0015 a mano en Supabase; y las
  **policies de Storage (buckets)** siguen sin endurecer (sistema aparte).
- **Sin ffmpeg / post-proceso de video** — el output de WaveSpeed se guarda tal
  cual. La marca de agua de "contenido IA" se removió a propósito.
- **`credit_packs.pack_type`** ya no tiene CHECK (dropeado en 0008) para permitir
  packs custom del admin. La constante `PACKS` en `credits.ts` sigue siendo solo
  para labels de display.
- **`SESSION_HANDOFF.md`** fue **retirado** (estaba desactualizado, describía hasta
  la migración 0008). Este `CLAUDE.md` es la única referencia vigente.

---

## 10. Registro de cambios (log de sesiones)

> Anotá acá cada sesión de trabajo relevante: qué se hizo, qué migración se
> agregó, qué decisión se tomó. Lo más nuevo arriba.

- **2026-07-20** (2ª tanda) — Tres cambios: (1) **RLS endurecido** (migración
  `0015_rls_hardening.sql`): scoping real por cuenta con bypass admin, tablas de
  dinero/log en SELECT-only, RLS habilitado en `rate_events`/`api_usage_log`
  (⚠️ correr a mano en Supabase). (2) **`improveScript`** (`openrouter.ts`)
  dejó de reescribir el guion como copywriter — ahora solo ajusta fluidez de
  lectura para TTS (mismas palabras; temperatura 0.7→0.2) + tooltip ⓘ en el
  botón "Mejorar con IA" del studio. (3) Se **retiró `SESSION_HANDOFF.md`**.
- **2026-07-20** — Se crea este `CLAUDE.md` como documentación viva del repo
  (antes solo existía la referencia en el README, pero el archivo no estaba).
  Estado del repo al momento: migraciones hasta 0014, multi-cuenta por
  `profiles.account_id`, try-on con Gemini, débito de créditos de video al
  finalizar, face-guard antes del render, página de set-password para invitados.
