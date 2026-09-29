import { NextResponse } from "next/server";
import { query, rowToItem } from "../../../lib/db";
import { callerFrom } from "../../../lib/auth";
import {
  ensureSchema,
  shared,
  sharedFromRow,
  sameShared,
  merge3,
  content,
  writeRow,
  forArtifact,
} from "../../../lib/sync";

export const dynamic = "force-dynamic";

/*
 * The hourly artifact sync. See lib/sync.js for how the two sides are merged.
 * Called from Chrome on the office PC while signed in, so it rides the normal
 * office session. No key has to live in the task's instructions.
 */

// GET /api/sync → the artifact version this app last saw for each item, so the
// sync task sends only the items that changed since.
export async function GET(req) {
  if (!callerFrom(req)) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  await ensureSchema();
  const { rows } = await query(
    "select id, artifact_version from items where artifact_version is not null"
  );
  const versions = {};
  for (const r of rows) versions[r.id] = r.artifact_version;
  return NextResponse.json({ versions });
}

// POST /api/sync
// Body: { items: [{ id, version, data }], runs: [{ id, data }] }
//   items: artifact documents that are new or whose version changed
//   runs:  the artifact's runs collection
// Returns: { push: [{ id, version, fields }], stats }
//   push: office changes to write into the artifact (update, pinned to
//         `version`), then confirm with POST /api/sync/ack.
export async function POST(req) {
  if (!callerFrom(req)) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  await ensureSchema();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "send JSON: { items, runs }" }, { status: 400 });
  }
  const incoming = Array.isArray(body.items) ? body.items.slice(0, 1000) : [];
  const runs = Array.isArray(body.runs) ? body.runs.slice(0, 50) : [];

  const stats = { received: 0, created: 0, updated: 0, skipped: 0, runs: 0 };
  const push = [];
  const seen = new Set();

  for (const doc of incoming) {
    const id = doc && doc.id;
    const data = doc && doc.data;
    const version = parseInt(doc && doc.version, 10);
    if (!id || !data || typeof data !== "object" || !Number.isFinite(version)) {
      stats.skipped++;
      continue;
    }
    if (data.example) {
      stats.skipped++;
      continue;
    }
    stats.received++;
    seen.add(String(id));

    const c = content(id, data);
    const a = shared(data);
    const existing = await query("select * from items where id = $1", [c.id]);

    if (!existing.rows.length) {
      await writeRow(c, a, { base: a, version });
      stats.created++;
      continue;
    }

    const row = existing.rows[0];
    const v = sharedFromRow(row);
    const base = row.sync_base ? shared(row.sync_base) : v;
    const merged = merge3(base, a, v);
    const agreed = sameShared(merged, a);
    // Move the base only when the artifact already matches; otherwise wait
    // for the ack, so a failed write is retried rather than forgotten.
    await writeRow(c, merged, { base: agreed ? merged : base, version });
    stats.updated++;
    if (!agreed) push.push({ id: c.id, version, fields: forArtifact(merged) });
  }

  // Office changes on items the artifact didn't send (unchanged there).
  const { rows } = await query(
    "select * from items where artifact_version is not null and sync_base is not null"
  );
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    const v = sharedFromRow(row);
    if (!sameShared(v, shared(row.sync_base))) {
      push.push({ id: row.id, version: row.artifact_version, fields: forArtifact(v) });
    }
  }

  // Tasks the office wrote here (no artifact copy yet). The sync task creates
  // each one on the artifact board, starts that bot's run with the task text
  // (fire: true), then acks with the new artifact version, exactly like a push.
  const created = await query(
    "select * from items where artifact_version is null order by created_at asc limit 50"
  );
  const create = created.rows.map((row) => {
    const it = rowToItem(row);
    const s = forArtifact(shared(it));
    return {
      id: it.id,
      bot: it.bot,
      fire: it.kind === "task" && s.status === "open",
      task: it.kind === "task" ? (it.comments?.[0]?.text || it.title) : null,
      data: {
        bot: it.bot,
        botName: it.botName,
        kind: it.kind,
        priority: it.priority,
        title: it.title,
        detail: it.detail,
        createdAt: new Date(it.createdAt).toISOString(),
        source: "office",
        ...s,
      },
      fields: s,
    };
  });

  for (const r of runs) {
    const id = r && (r.id || r.bot);
    const d = (r && r.data) || r || {};
    if (!id) continue;
    await query(
      `insert into runs (bot, bot_name, last_run_at, status, summary)
       values ($1, $2, coalesce($3::timestamptz, now()), $4, $5)
       on conflict (bot) do update set
         bot_name = excluded.bot_name, last_run_at = excluded.last_run_at,
         status = excluded.status, summary = excluded.summary`,
      [
        String(id),
        String(d.botName || d.bot || id),
        d.lastRunAt || null,
        d.status === "failed" ? "failed" : "ok",
        d.summary || null,
      ]
    );
    stats.runs++;
  }

  return NextResponse.json({ push, create, stats });
}
