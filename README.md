# Eolax Avatar Studio

AI talking-head video studio for brand-exclusive avatars. Orchestration layer
over existing AI APIs (Supabase + Next.js on Vercel). See `CLAUDE.md` for the
full product context and phased build plan.

**Current status: Phase 0 — skeleton & deploy.** Auth + DB schema only. No
avatar, voice, video, or credit logic yet.

## Stack

- Next.js (App Router, TypeScript) — deployed on Vercel
- Supabase (Postgres + Auth), wired via `@supabase/ssr`

## Project layout

```
src/
  app/
    layout.tsx          root layout
    page.tsx            protected home (redirects to /login if signed out)
    login/page.tsx      email/password login
    login/actions.ts    signIn / signOut server actions
  lib/supabase/
    client.ts           browser client (Client Components)
    server.ts           server client (Server Components / Actions)
    middleware.ts       session refresh + route protection
    env.ts              validated env var access
  middleware.ts         Next.js middleware entrypoint
supabase/migrations/
  0001_init.sql         full Phase 0 schema (paste into Supabase SQL Editor)
```

---

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the entire contents of
   `supabase/migrations/0001_init.sql`, and **Run**. This creates all tables
   with RLS enabled and seeds the single `Eolax` account.
3. Get your API keys: **Project Settings → API**. You need the
   **Project URL** and the **anon public** key.

### 2. Create the login user

This app uses email/password auth; there is no public sign-up UI (single Eolax
account in MVP). Create the user once:

- **Authentication → Users → Add user** → enter email + password.
- Either tick "Auto Confirm User", or disable "Confirm email" under
  **Authentication → Providers → Email** so the account can sign in immediately.

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

### 4. Deploy on Vercel (deploy-first — we validate on the Vercel URL)

1. Import the GitHub repo into Vercel. Framework preset: **Next.js** (auto).
2. **Project Settings → Environment Variables** — add both vars above
   (Production, Preview, and Development). The values are the same Supabase
   URL + anon key.
3. Deploy. Vercel auto-deploys on every push to `main`.

> Local `npm run dev` works too, but per the project workflow we validate on
> the Vercel deployment URL, not localhost.

---

## Phase 0 verification checklist (on the Vercel URL)

1. **App loads:** open the Vercel URL → you are redirected to `/login`.
2. **Auth blocks unauthenticated access:** visiting `/` while signed out
   redirects to `/login`.
3. **Login works:** sign in with the user created in step 2 → you land on the
   home page showing your email.
4. **Sign-out works:** click **Sign out** → back to `/login`, and `/` is
   protected again.
5. **Tables exist:** in Supabase **Table Editor**, confirm all 7 tables are
   present: `accounts`, `avatars`, `wardrobe_presets`, `background_presets`,
   `videos`, `credit_packs`, `generations_log` — and that `accounts` has one
   seeded `Eolax` row.
