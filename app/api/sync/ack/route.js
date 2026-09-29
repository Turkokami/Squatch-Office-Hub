import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { callerFrom } from "../../../../lib/auth";
import { ensureSchema, shared } from "../../../../lib/sync";

export const dynamic = "force-dynamic";

// POST /api/sync/ack — the sync task wrote these office changes into the
// artifact. Body: { acks: [{ id, version, fields }] }, where version is the
// artifact document's NEW version and fields are exactly what was written.
export async function POST(req) {
  if (!callerFrom(req)) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  await ensureSchema();
  const body = await req.json().catch(() => null);
  const acks = Array.isArray(body && body.acks) ? body.acks.slice(0, 1000) : [];
  let n = 0;
  for (const k of acks) {
    const version = parseInt(k && k.version, 10);
    if (!k || !k.id || !k.fields || !Number.isFinite(version)) continue;
    const r = await query(
      `update items set sync_base = $2::jsonb, artifact_version = $3, synced_at = now()
       where id = $1`,
      [String(k.id), JSON.stringify(shared(k.fields)), version]
    );
    n += r.rowCount || 0;
  }
  return NextResponse.json({ acked: n });
}
