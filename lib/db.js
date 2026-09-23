import { Pool } from "pg";

/* THE CERTIFICATE IS CHECKED. This read `rejectUnauthorized: false`, which
   tells pg to accept whatever certificate answers — encrypted, but with no
   proof the thing on the other end is your database. Everything on this wire
   is customer names, money figures and drafted replies, in both directions.

   Neon, Supabase and Vercel Postgres all present certificates from public
   authorities that Node already trusts, so verification simply works; the
   flag was insurance against a problem these providers do not have. If a
   provider ever does need its own root, give it the root
   (`ssl: { ca: process.env.DATABASE_CA }`) rather than switching the check
   off — DATABASE_SSL_NO_VERIFY exists below as a last resort, and a named
   escape hatch someone has to set on purpose is a different thing from a
   default nobody reads. */
const url = process.env.DATABASE_URL || "";
const local = url.includes("localhost") || url.includes("127.0.0.1");

let pool = globalThis.__squatchPool;
if (!pool) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: local
      ? false
      : process.env.DATABASE_SSL_NO_VERIFY === "1"
        ? { rejectUnauthorized: false }
        : process.env.DATABASE_CA
          ? { ca: process.env.DATABASE_CA }
          : true,
    max: 3,
  });
  globalThis.__squatchPool = pool;
}

export function query(text, params) {
  return pool.query(text, params);
}

export function rowToItem(r) {
  return {
    id: r.id,
    bot: r.bot,
    botName: r.bot_name,
    kind: r.kind,
    priority: r.priority,
    title: r.title,
    detail: r.detail,
    draft: r.draft,
    draftChannel: r.draft_channel,
    status: r.status,
    verdict: r.verdict,
    verdictBy: r.verdict_by,
    verdictAt: r.verdict_at,
    assignee: r.assignee,
    acked: r.acked,
    ackedBy: r.acked_by,
    snoozeUntil: r.snooze_until,
    closedAt: r.closed_at,
    createdAt: r.created_at,
    comments: r.comments || [],
  };
}

export function rowToRun(r) {
  return {
    bot: r.bot,
    botName: r.bot_name,
    lastRunAt: r.last_run_at,
    status: r.status,
    summary: r.summary,
  };
}
