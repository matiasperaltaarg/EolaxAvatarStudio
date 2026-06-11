# Eolax Avatar Studio — Session Handoff

> **Date:** 2026-06-11
> **Branch:** `main` (all work goes directly to main — no feature branches, no PRs)
> **Last commit on GitHub main:** `72864c2` — "feat: admin panel for MTS to manage credits (BLOQUE 2)"
> **Vercel deploy status:** Pending — pushes reached GitHub but Vercel may need a manual redeploy or webhook reconnect (check Settings → Git in Vercel dashboard).

---

## 1. What this project is

A web app that lets the Eolax team produce AI talking-head videos for social media using brand-exclusive avatars. Built by MTS Studios (the developer/operator). Stack: **Next.js 16 (App Router, TypeScript), Supabase (Postgres + Auth + Storage), Vercel serverless**.

External APIs: ElevenLabs (voice cloning + TTS), WaveSpeedAI InfiniteTalk (lip-sync video, 720p), Replicate flux-kontext-pro (image editing), OpenRouter/Claude Haiku (script improvement).

---

## 2. What's been built (Phases 0–6 + Bloques 1–2)

| Phase/Block | What | Status |
|---|---|---|
| Phase 0 | Scaffold, Supabase auth, SQL seed | ✅ Verified on Vercel |
| Phase 1 | Avatar CRUD + rights gate | ✅ |
| Phase 2 | Voice cloning (ElevenLabs) | ✅ |
| Phase 3 | Video generation pipeline (WaveSpeed) | ✅ |
| Phase 4 | Autonomous editing (presets, personality) | ✅ |
| Phase 5 | Credits system (video-time packs) + gallery | ✅ |
| Phase 6 | Branding, Spanish copy, UX polish | ✅ |
| BLOQUE 1 | Two-currency wallet (video-time + avatar credits) | ✅ Pushed, needs migration 0007 |
| BLOQUE 2 | Admin panel for MTS | ✅ Pushed, needs migration 0008 |
| **BLOQUE 3** | **Video/audio quality improvements** | **NOT STARTED** |
| **BLOQUE 4** | **Free-prompt kontext (replace presets with free text)** | **NOT STARTED** |
| **BLOQUE 5** | **Dashboard with real stats** | **NOT STARTED** |

---

## 3. Pending SQL migrations to run

Run these in the **Supabase SQL Editor** (paste-ready, run in order):

1. **`supabase/migrations/0007_avatar_credits.sql`** — Creates `avatar_credit_packs` and `avatar_creation_log` tables. Seeds 10 avatar credits for the Eolax account.
2. **`supabase/migrations/0008_admin_panel.sql`** — Creates `profiles` table with `is_admin`, backfills existing users, auto-sets `matiasperalta@mtsclub.org` as admin, drops pack_type CHECK constraint.

After running, verify on the Vercel URL:
- `/admin` loads for the admin user, is blocked for non-admins
- Granting credits from `/admin` updates balances visible to Eolax user
- Avatar creation debits 1 avatar credit

---

## 4. Key files and architecture

### Data layer
| File | Purpose |
|---|---|
| `src/lib/supabase/server.ts` | Server-side Supabase client (cookies/auth) |
| `src/lib/supabase/admin.ts` | Service-role client (bypasses RLS for debits) |
| `src/lib/account.ts` | `getAccountId()` — single-account MVP lookup |
| `src/lib/admin.ts` | `isAdmin()` — checks `profiles.is_admin` for current user |
| `src/lib/credits.ts` | Two-currency wallet: `getBalanceSeconds()`, `getAvatarCreditBalance()`, `debitForVideo()`, `debitForAvatarCreation()` |
| `src/lib/avatars.ts` | Avatar types, constants, bucket names |
| `src/lib/elevenlabs.ts` | Voice cloning + TTS (voice_settings tuned) |
| `src/lib/wavespeed.ts` | Lip-sync video (720p, auto-resubmit on transient errors) |
| `src/lib/replicate.ts` | Image editing (flux-kontext-pro) |

### Pages
| Route | File | Notes |
|---|---|---|
| `/login` | `src/app/login/page.tsx` | Email/password auth |
| `/studio` | `src/app/studio/page.tsx` + `Studio.tsx` | Video generation pipeline (~700 lines client component) |
| `/gallery` | `src/app/gallery/page.tsx` | Generated videos |
| `/credits` | `src/app/credits/page.tsx` | Two-currency balance, packs, consumption logs |
| `/avatars` | `src/app/avatars/page.tsx` | Avatar list with credit balance |
| `/avatars/new` | `src/app/avatars/new/page.tsx` | Create avatar (pre-checks avatar credits) |
| `/avatars/[id]` | `src/app/avatars/[id]/page.tsx` | Avatar detail (photos, rights, voice, edit, delete) |
| `/admin` | `src/app/admin/page.tsx` | **Admin only.** Grant credits, view balances/logs |

### Layout
| File | Purpose |
|---|---|
| `src/app/AppShell.tsx` | Server component shell — computes balances + isAdmin, wraps pages |
| `src/app/Sidebar.tsx` | Client component — nav, credits card, admin link (admin only) |
| `src/app/BrandMark.tsx` | EOLAX gradient logo |

### API routes (all under `src/app/api/`)
| Route | Purpose |
|---|---|
| `studio/voice` | TTS via ElevenLabs |
| `studio/video/start` | Submit WaveSpeed InfiniteTalk job |
| `studio/video/status` | Poll WaveSpeed job status |
| `studio/finalize` | Download video → store → insert row → debit credits |
| `studio/improve` | LLM script improvement (OpenRouter) |
| `studio/translate` | LLM translation (OpenRouter) |
| `studio/look` | Image editing via Replicate kontext |
| `avatars/[id]/voice/clone` | Clone voice via ElevenLabs |
| `avatars/[id]/voice/preview` | Test cloned voice |

### SQL migrations (run in Supabase SQL Editor)
```
supabase/migrations/
├── 0001_init.sql                              # accounts, avatars, presets, videos, credit_packs, generations_log, RLS, seed
├── 0002_avatars_rights_gate_and_storage.sql   # rights CHECK constraint, photo bucket
├── 0003_voice_cloning.sql                     # voice_reference_paths, voice bucket
├── 0004_generated_content.sql                 # generated-content bucket
├── 0005_autonomous_editing.sql                # avatar_look_cache, seed presets
├── 0006_credits.sql                           # unique index on generations_log.video_id, debit-order index, grant Pro pack
├── 0007_avatar_credits.sql                    # avatar_credit_packs, avatar_creation_log, seed 10 credits
└── 0008_admin_panel.sql                       # profiles table, is_admin, trigger, drop pack_type CHECK
```

---

## 5. Environment variables

All in Vercel project settings (never committed). Reference: `.env.example`

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # SERVER-SIDE ONLY — bypasses RLS
ELEVENLABS_API_KEY=
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_STABILITY=0.45
ELEVENLABS_SIMILARITY=0.75
ELEVENLABS_STYLE=0.35
ELEVENLABS_SPEAKER_BOOST=true
OPENROUTER_API_KEY=
OPENROUTER_MODEL=anthropic/claude-3.5-haiku
REPLICATE_API_TOKEN=
REPLICATE_KONTEXT_MODEL=black-forest-labs/flux-kontext-pro
WAVESPEED_API_KEY=
WAVESPEED_RESOLUTION=720p
```

---

## 6. Workflow rules (critical — follow exactly)

1. **Push directly to `main`.** No feature branches, no PRs. Vercel auto-deploys from main.
2. **Build before pushing.** Run `npx next build` — must compile cleanly.
3. **SQL is paste-ready.** Migrations go to `supabase/migrations/` as reference, but the user runs them manually in the Supabase SQL Editor.
4. **Never commit secrets.** All API keys server-side only (never `NEXT_PUBLIC_`).
5. **Deploy-first validation.** No localhost testing. The Vercel URL is the source of truth.
6. **One block at a time.** Finish and verify one block before starting the next.
7. **Don't touch unrelated code.** A business-logic block doesn't change styling and vice versa.
8. **Debit must be server-side.** Never trust the client for credit checks or debits. Use service-role client.
9. **Data shown must be real.** No fake metrics, no placeholder stats. Real data or nothing.

---

## 7. What to do next

### Immediate: fix Vercel deploy
The last push reached GitHub (`72864c2` on main) but Vercel may not have picked it up. Check:
- Vercel dashboard → project → Settings → Git → verify webhook is active
- Or do a manual Redeploy from the Deployments tab

### Then: run migrations 0007 + 0008
In the Supabase SQL Editor, paste and run `0007_avatar_credits.sql` then `0008_admin_panel.sql`.

### Then: verify on Vercel URL
1. Log in as admin (`matiasperalta@mtsclub.org`) → `/admin` loads, sidebar shows Admin link
2. Non-admin user or logged-out → `/admin` redirects to `/`
3. Grant 5 avatar credits via admin panel → balance shows 5 on `/avatars` and sidebar
4. Grant 30 min video time → balance updates on `/credits` and sidebar
5. Create an avatar → debits 1 avatar credit
6. Grant history visible on admin panel

### After verification: BLOQUE 3 (quality improvements)
From `Plan_Ajustes_Eolax.md`:
- Video quality: good frontal reference photo + 720p (720p already done)
- Audio quality: adjust voice_settings (already tuned) + guided in-app recording (already built)
- This block may be partially complete — audit before starting

### Remaining blocks
- **BLOQUE 4:** Free-prompt kontext (replace presets with free text for wardrobe/background)
- **BLOQUE 5:** Dashboard with real stats (saldo, nº avatares, nº videos — no fake metrics)

---

## 8. Known issues / tech debt

- **Vercel deploy webhook** may need reconnection (current session's pushes didn't trigger deploys)
- **RLS policies are permissive** (Phase 0 placeholder: any authenticated user, full access). Fine for single-account MVP but needs tightening for multi-tenant.
- **ffmpeg removed** — no video post-processing. WaveSpeed output saved directly. AI disclosure watermark was intentionally removed (not acceptable for brand content).
- **Single-account MVP** — `getAccountId()` returns the first account. Multi-user requires swapping this for a per-user lookup.
- **credit_packs.pack_type** CHECK constraint was dropped in migration 0008 to allow admin-granted custom packs. The `PACKS` constant in `credits.ts` still defines starter/pro/scale for display labels.

---

## 9. User identity

- **Admin/owner:** matiasperalta@mtsclub.org (MTS Studios)
- **Client account:** Eolax (seeded in migration 0001)
- **Admin flag:** `profiles.is_admin = true` (set in migration 0008)
