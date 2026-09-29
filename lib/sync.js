import { query, rowToItem } from "./db";

/**
 * TWO BOARDS, ONE SET OF DECISIONS.
 *
 * The bots file into the Claude artifact board (its database is the only thing
 * a cloud-scheduled bot can reach). The office works here. An hourly task on
 * the office PC carries changes both ways through /api/sync:
 *
 *   artifact → here   new items, the bots' text, bot comments, bots closing
 *                     items, and the "last run" rail
 *   here → artifact   everything the office does: approve / reject, ack,
 *                     done, snooze, wake, reopen, assign, comments
 *
 * Each item keeps `sync_base`: the shared fields as they last stood on BOTH
 * sides. A field that differs from the base on one side only was changed on
 * that side, so that side wins. That is what stops an hourly sync from quietly
 * undoing an approval. Comments are never lost: both sides' comments are
 * merged. If the same field was changed on both sides in the same hour, the
 * office wins, except that "done" beats anything else, so a bot closing an
 * item stays closed.
 *
 * `sync_base` moves only when both sides are known to match: straight away
 * when nothing needs sending back, otherwise when the sync task confirms
 * (POST /api/sync/ack) that it wrote the office's changes into the artifact.
 * If that write fails, the change is simply sent again next hour.
 */

export const SHARED = [
  "status",
  "snoozeUntil",
  "closedAt",
  "verdict",
  "verdictBy",
  "verdictAt",
  "acked",
  "ackedBy",
  "assignee",
  "comments",
];

const KINDS = new Set(["decision", "draft", "alert", "info"]);
const STATUSES = new Set(["open", "snoozed", "done"]);
const VERDICTS = new Set(["approved", "rejected"]);

let schemaReady = null;
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = query(
      `alter table items add column if not exists sync_base jsonb;
       alter table items add column if not exists artifact_version integer;
       alter table items add column if not exists synced_at timestamptz;`
    ).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

function iso(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return isNaN(t) ? null : new Date(t).toISOString();
}

function str(v) {
  return v == null || v === "" ? null : String(v);
}

function normComment(c) {
  if (!c || typeof c !== "object" || !c.text) return null;
  const out = {
    at: iso(c.at) || new Date(0).toISOString(),
    source: c.source === "bot" ? "bot" : "office",
    text: String(c.text).slice(0, 4000),
  };
  const by = c.by || c.byName;
  if (by) out.by = String(by);
  if (c.byId) out.byId = String(c.byId);
  return out;
}

function commentKey(c) {
  return c.at.slice(0, 19) + "|" + c.text.trim().slice(0, 200);
}

export function mergeComments(...lists) {
  const seen = new Map();
  for (const list of lists) {
    for (const raw of list || []) {
      const c = normComment(raw);
      if (!c) continue;
      const k = commentKey(c);
      const prev = seen.get(k);
      seen.set(k, prev ? { ...c, ...prev, by: prev.by || c.by, byId: prev.byId || c.byId } : c);
    }
  }
  return [...seen.values()]
    .map((c) => {
      const o = { ...c };
      if (!o.by) delete o.by;
      if (!o.byId) delete o.byId;
      return o;
    })
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-40);
}

/** The shared fields of an item, normalized so the two sides compare equal. */
export function shared(it) {
  return {
    status: STATUSES.has(it.status) ? it.status : "open",
    snoozeUntil: iso(it.snoozeUntil),
    closedAt: iso(it.closedAt),
    verdict: VERDICTS.has(it.verdict) ? it.verdict : null,
    verdictBy: str(it.verdictBy),
    verdictAt: iso(it.verdictAt),
    acked: Boolean(it.acked),
    ackedBy: str(it.ackedBy),
    assignee: str(it.assignee),
    comments: mergeComments(it.comments),
  };
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function sameShared(a, b) {
  return SHARED.every((f) => same(a[f], b[f]));
}

/** Three-way merge: base = last agreed, a = artifact now, v = this app now. */
export function merge3(base, a, v) {
  const out = {};
  for (const f of SHARED) {
    if (f === "comments") continue;
    if (same(a[f], base[f])) out[f] = v[f];
    else if (same(v[f], base[f])) out[f] = a[f];
    else out[f] = v[f]; // both changed: the office wins…
  }
  // …except that a close from either side sticks.
  if (a.status === "done" && a.status !== base.status && v.status !== "done") {
    out.status = "done";
    out.closedAt = a.closedAt;
  }
  out.comments = mergeComments(a.comments, v.comments);
  return out;
}

/** The bot-owned text of an item. The artifact is always right about these. */
export function content(id, d) {
  return {
    id: String(id),
    bot: String(d.bot || "unknown"),
    botName: str(d.botName) || String(d.bot || "unknown"),
    kind: KINDS.has(d.kind) ? d.kind : "decision",
    priority: d.priority === "high" ? "high" : "normal",
    title: String(d.title || "Untitled item").slice(0, 500),
    detail: str(d.detail),
    draft: str(d.draft),
    draftChannel: str(d.draftChannel),
    createdAt: iso(d.createdAt),
  };
}

export async function writeRow(c, s, { base, version }) {
  await query(
    `insert into items
       (id, bot, bot_name, kind, priority, title, detail, draft, draft_channel,
        status, snooze_until, closed_at, verdict, verdict_by, verdict_at,
        acked, acked_by, assignee, comments, created_at, updated_at,
        sync_base, artifact_version, synced_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19::jsonb, coalesce($20::timestamptz, now()), now(),
             $21::jsonb, $22, now())
     on conflict (id) do update set
       bot = excluded.bot, bot_name = excluded.bot_name, kind = excluded.kind,
       priority = excluded.priority, title = excluded.title,
       detail = excluded.detail, draft = excluded.draft,
       draft_channel = excluded.draft_channel, status = excluded.status,
       snooze_until = excluded.snooze_until, closed_at = excluded.closed_at,
       verdict = excluded.verdict, verdict_by = excluded.verdict_by,
       verdict_at = excluded.verdict_at, acked = excluded.acked,
       acked_by = excluded.acked_by, assignee = excluded.assignee,
       comments = excluded.comments, created_at = excluded.created_at,
       sync_base = coalesce(excluded.sync_base, items.sync_base),
       artifact_version = excluded.artifact_version,
       synced_at = now(), updated_at = now()`,
    [
      c.id, c.bot, c.botName, c.kind, c.priority, c.title, c.detail, c.draft,
      c.draftChannel, s.status, s.snoozeUntil, s.closedAt, s.verdict,
      s.verdictBy, s.verdictAt, s.acked, s.ackedBy, s.assignee,
      JSON.stringify(s.comments), c.createdAt,
      base ? JSON.stringify(base) : null, version,
    ]
  );
}

/** Shared fields shaped for the artifact's database (its page reads byName). */
export function forArtifact(s) {
  return {
    ...s,
    comments: s.comments.map((c) => (c.by ? { ...c, byName: c.by } : c)),
  };
}

export function sharedFromRow(row) {
  return shared(rowToItem(row));
}
