import { NextResponse } from "next/server";
import { query, rowToItem } from "../../../lib/db";
import { checkBotKey, callerFrom } from "../../../lib/auth";

// GET /api/items            → everything the board shows (office, signed in)
// GET /api/items?bot=yoda&open=1  → a bot reading its own open items (bot key)
export async function GET(req) {
  /* THIS CHECK USED NOT TO EXIST. The route trusted middleware, and middleware
     let through anything carrying an x-bot-key header whatever its value — so
     this handler would hand the whole board, customer names and money figures
     and drafted replies included, to an unauthenticated stranger with curl.
     See the note at the top of middleware.js. */
  const caller = callerFrom(req);
  if (!caller) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const bot = searchParams.get("bot");

  /* A bot reads its own queue; the whole board is for a signed-in person.
     One key is shared by every bot, so this does not stop a stolen key being
     used — it stops a stolen key being a single request away from the lot,
     and it is the call the README already documents bots making. */
  if (caller.isBot && !bot) {
    return NextResponse.json(
      { error: "name a bot: /api/items?bot=<name>" },
      { status: 400 }
    );
  }
  const openOnly = searchParams.get("open") === "1";

  const where = [];
  const params = [];
  if (bot) {
    params.push(bot);
    where.push(`bot = $${params.length}`);
  }
  if (openOnly) where.push("status <> 'done'");

  const sql =
    "select * from items" +
    (where.length ? " where " + where.join(" and ") : "") +
    " order by created_at desc limit 400";

  const { rows } = await query(sql, params);
  return NextResponse.json({ items: rows.map(rowToItem) });
}

// POST /api/items — a bot (or Zapier, on a bot's behalf) files a new item.
// Requires the x-bot-key header.
export async function POST(req) {
  if (!checkBotKey(req)) {
    return NextResponse.json({ error: "bad bot key" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body || !body.bot || !body.title) {
    return NextResponse.json(
      { error: "bot and title are required" },
      { status: 400 }
    );
  }

  const id =
    body.id ||
    `${body.bot}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const comments = Array.isArray(body.comments) ? body.comments : [];

  const { rows } = await query(
    `insert into items
       (id, bot, bot_name, kind, priority, title, detail, draft, draft_channel, comments)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (id) do update set
       title = excluded.title,
       detail = excluded.detail,
       draft = excluded.draft,
       updated_at = now()
     returning *`,
    [
      id,
      body.bot,
      body.botName || body.bot,
      body.kind || "decision",
      body.priority === "high" ? "high" : "normal",
      body.title,
      body.detail || null,
      body.draft || null,
      body.draftChannel || null,
      JSON.stringify(comments),
    ]
  );

  return NextResponse.json({ item: rowToItem(rows[0]) }, { status: 201 });
}
