import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { checkBotKey } from "../../../lib/auth";

/**
 * POST /api/import — one-time move of the Claude artifact board into this app.
 *
 * Unlike POST /api/items (which files a NEW item and always starts it open),
 * this keeps an item's full state: status, verdict, acked, assignee, snooze,
 * closed and created times. Bot key only. Upserts by id, so running it twice
 * is harmless.
 *
 * Body: { items: [ {id, bot, botName, kind, priority, title, detail, draft,
 *                   draftChannel, status, verdict, verdictBy, verdictAt,
 *                   assignee, acked, ackedBy, snoozeUntil, closedAt,
 *                   createdAt, comments} ],
 *         runs:  [ {bot, botName, lastRunAt, status, summary} ] }
 */
const KINDS = new Set(["decision", "draft", "alert", "info"]);
const STATUSES = new Set(["open", "snoozed", "done"]);
const VERDICTS = new Set(["approved", "rejected"]);

function ts(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return isNaN(t) ? null : new Date(t).toISOString();
}

export async function POST(req) {
  if (!checkBotKey(req)) {
    return NextResponse.json({ error: "bad bot key" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const items = Array.isArray(body?.items) ? body.items.slice(0, 1000) : [];
  const runs = Array.isArray(body?.runs) ? body.runs.slice(0, 50) : [];

  let itemCount = 0;
  const skipped = [];
  for (const it of items) {
    if (!it || !it.id || !it.bot || !it.title) {
      skipped.push(it?.id || null);
      continue;
    }
    await query(
      `insert into items
         (id, bot, bot_name, kind, priority, title, detail, draft, draft_channel,
          status, verdict, verdict_by, verdict_at, assignee, acked, acked_by,
          snooze_until, closed_at, created_at, updated_at, comments)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               coalesce($19::timestamptz, now()), now(), $20::jsonb)
       on conflict (id) do update set
         bot = excluded.bot, bot_name = excluded.bot_name, kind = excluded.kind,
         priority = excluded.priority, title = excluded.title,
         detail = excluded.detail, draft = excluded.draft,
         draft_channel = excluded.draft_channel, status = excluded.status,
         verdict = excluded.verdict, verdict_by = excluded.verdict_by,
         verdict_at = excluded.verdict_at, assignee = excluded.assignee,
         acked = excluded.acked, acked_by = excluded.acked_by,
         snooze_until = excluded.snooze_until, closed_at = excluded.closed_at,
         created_at = excluded.created_at, comments = excluded.comments,
         updated_at = now()`,
      [
        String(it.id),
        String(it.bot),
        it.botName || it.bot,
        KINDS.has(it.kind) ? it.kind : "decision",
        it.priority === "high" ? "high" : "normal",
        String(it.title),
        it.detail || null,
        it.draft || null,
        it.draftChannel || null,
        STATUSES.has(it.status) ? it.status : "open",
        VERDICTS.has(it.verdict) ? it.verdict : null,
        it.verdictBy || null,
        ts(it.verdictAt),
        it.assignee || null,
        Boolean(it.acked),
        it.ackedBy || null,
        ts(it.snoozeUntil),
        ts(it.closedAt),
        ts(it.createdAt),
        JSON.stringify(Array.isArray(it.comments) ? it.comments.slice(-40) : []),
      ]
    );
    itemCount++;
  }

  let runCount = 0;
  for (const r of runs) {
    if (!r || !r.bot) continue;
    await query(
      `insert into runs (bot, bot_name, last_run_at, status, summary)
       values ($1, $2, coalesce($3::timestamptz, now()), $4, $5)
       on conflict (bot) do update set
         bot_name = excluded.bot_name, last_run_at = excluded.last_run_at,
         status = excluded.status, summary = excluded.summary`,
      [
        String(r.bot),
        r.botName || r.bot,
        ts(r.lastRunAt),
        r.status === "failed" ? "failed" : "ok",
        r.summary || null,
      ]
    );
    runCount++;
  }

  return NextResponse.json({ items: itemCount, runs: runCount, skipped });
}
