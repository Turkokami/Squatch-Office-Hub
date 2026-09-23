import { NextResponse } from "next/server";
import { query, rowToRun } from "../../../lib/db";
import { checkBotKey, callerFrom } from "../../../lib/auth";

// GET /api/runs — last run per bot, for the rail on the board.
export async function GET(req) {
  /* Same hole as GET /api/items had, and the same fix: this handler had no
     caller check of its own and middleware's was bypassable by sending an
     x-bot-key header with any value. What leaks here is smaller — which bots
     ran, when, and their one-line summaries — but it is still a map of the
     office's automation handed to a stranger. */
  if (!callerFrom(req)) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  const { rows } = await query("select * from runs order by bot asc");
  return NextResponse.json({ runs: rows.map(rowToRun) });
}

// POST /api/runs — a bot records that it ran. Requires the x-bot-key header.
// Body: { bot, botName, status: "ok" | "failed", summary }
export async function POST(req) {
  if (!checkBotKey(req)) {
    return NextResponse.json({ error: "bad bot key" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body || !body.bot) {
    return NextResponse.json({ error: "bot is required" }, { status: 400 });
  }
  const { rows } = await query(
    `insert into runs (bot, bot_name, last_run_at, status, summary)
     values ($1, $2, now(), $3, $4)
     on conflict (bot) do update set
       bot_name = excluded.bot_name,
       last_run_at = excluded.last_run_at,
       status = excluded.status,
       summary = excluded.summary
     returning *`,
    [
      body.bot,
      body.botName || body.bot,
      body.status === "failed" ? "failed" : "ok",
      body.summary || null,
    ]
  );
  return NextResponse.json({ run: rowToRun(rows[0]) });
}
