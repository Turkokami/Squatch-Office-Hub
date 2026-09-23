-- Squatch-Bot Dispatch — database schema
-- Run once against your Postgres database (Neon, Supabase, or Vercel Postgres).

create table if not exists items (
  id            text primary key,
  bot           text not null,
  bot_name      text not null,
  kind          text not null default 'decision',   -- decision | draft | alert | info
  priority      text not null default 'normal',     -- high | normal
  title         text not null,
  detail        text,
  draft         text,
  draft_channel text,
  status        text not null default 'open',       -- open | snoozed | done
  verdict       text,                               -- approved | rejected | null
  verdict_by    text,
  verdict_at    timestamptz,
  assignee      text,
  acked         boolean not null default false,
  acked_by      text,
  snooze_until  timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  comments      jsonb not null default '[]'::jsonb
);

create index if not exists items_bot_status_idx on items (bot, status);
create index if not exists items_created_idx on items (created_at desc);

create table if not exists runs (
  bot         text primary key,
  bot_name    text not null,
  last_run_at timestamptz not null default now(),
  status      text not null default 'ok',           -- ok | failed
  summary     text
);

-- ---------------------------------------------------------------------------
-- SHUT THE SIDE DOOR. Read this before deciding to skip it.
--
-- Supabase publishes every table in the `public` schema through an automatic
-- REST API, reachable with the project's anon key — a key designed to sit in
-- browser code, so it is not a secret. Without row level security, that API
-- will hand over these two tables to anyone who has it, going around the app,
-- the login screen and the bot key entirely. It is the same hole that was in
-- the app's own GET routes, in a second place.
--
-- Enabling RLS with NO policies denies every request that arrives through
-- that API. It does not affect this app: it connects over DATABASE_URL as the
-- database owner, and the owner bypasses RLS. That is the whole trick —
-- closed to the public API, open to the thing holding the password.
--
-- ON NEON OR VERCEL POSTGRES there is no such REST API, so this is belt and
-- braces rather than a fix. It is still harmless, for the same reason.
--
-- THE ONE WAY THIS BITES: if you ever point the app at a NON-owner role, RLS
-- will apply to it and every query comes back empty rather than failing
-- loudly. If the board suddenly shows nothing and /api/health says the
-- database is fine, this is the first thing to check.
alter table items enable row level security;
alter table runs  enable row level security;
