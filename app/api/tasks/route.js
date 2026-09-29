import { NextResponse } from "next/server";
import { query, rowToItem } from "../../../lib/db";
import { callerFrom } from "../../../lib/auth";
import { ensureSchema } from "../../../lib/sync";

export const dynamic = "force-dynamic";

/*
 * POST /api/tasks/ — the office gives one bot a job outside its schedule.
 * Body: { bot, text, urgent? }
 *
 * The task is filed as an ordinary board item (kind "task") so it shows up,
 * can be commented on and closes like everything else. It has no artifact
 * version yet, so the next hourly sync creates it on the Claude artifact board
 * and starts that bot's run with the task text (see lib/sync.js, `create`).
 * The bot reports back by commenting on and closing the same item.
 *
 * Signed-in office staff only. A bot key can't file tasks for other bots.
 */
const BOTS = {
  yoda: "Yoda · Gorilla Bot",
  r2d2: "R2-D2 · Dispatch Bot",
  vader: "Vader · Ledger Bot",
  obiwan: "Obi-Wan · Content Bot",
  chewbacca: "Chewbacca · Star Bot",
  leia: "Leia · Map Bot",
  sarlac: "SARLAC · Lead Bot",
};

function stamp(d) {
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

export async function POST(req) {
  const caller = callerFrom(req);
  if (!caller || caller.isBot) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  await ensureSchema();
  const body = await req.json().catch(() => ({}));
  const bot = String(body.bot || "");
  const text = String(body.text || "").trim().slice(0, 4000);
  if (!BOTS[bot]) {
    return NextResponse.json({ error: "unknown bot" }, { status: 400 });
  }
  if (text.length < 3) {
    return NextResponse.json({ error: "write the task first" }, { status: 400 });
  }

  const now = new Date();
  const who = caller.name || caller.user;
  const firstLine = text.split("\n")[0].trim();
  const title =
    "Task from " + who + ": " + (firstLine.length > 110 ? firstLine.slice(0, 107) + "…" : firstLine);
  const id = `${bot}-task-${stamp(now)}-${Math.random().toString(36).slice(2, 6)}`;
  const comments = [{ at: now.toISOString(), source: "office", by: who, text }];

  const { rows } = await query(
    `insert into items
       (id, bot, bot_name, kind, priority, title, detail, status, acked, acked_by,
        comments, created_at, updated_at)
     values ($1,$2,$3,'task',$4,$5,$6,'open',true,$7,$8::jsonb,$9,$9)
     returning *`,
    [
      id,
      bot,
      BOTS[bot],
      body.urgent ? "high" : "normal",
      title,
      "Sent from the office board. The next hourly sync starts " +
        BOTS[bot].split(" · ")[0] +
        " on this task, and the answer comes back here as a comment.",
      who,
      JSON.stringify(comments),
      now.toISOString(),
    ]
  );
  return NextResponse.json({ item: rowToItem(rows[0]) }, { status: 201 });
}
