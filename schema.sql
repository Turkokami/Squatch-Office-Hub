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
