import { NextResponse } from "next/server";
import { query, rowToItem } from "../../../../lib/db";
import { callerFrom } from "../../../../lib/auth";

// PATCH /api/items/:id — one office action, or a bot closing an item out.
// Body: { action: "ack" | "done" | "reopen" | "snooze" | "wake" | "approve"
//                 | "reject" | "assign" | "comment",
//         days?, assignee?, text? }
export async function PATCH(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  /* This route already checked its caller properly — it is the one that did.
     It goes through the shared helper now so that every route in the app
     answers "who is asking?" the same way and a future one cannot be written
     without noticing the question. */
  const caller = callerFrom(req);
  if (!caller) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  const isBot = caller.isBot;
  // A bot signs its own name to what it writes; an office action carries the
  // name of whoever is signed in.
  const session = isBot ? { user: "bot", name: body.botName || "Bot" } : caller;

  const existing = await query("select * from items where id = $1", [id]);
  if (!existing.rows.length) {
    return NextResponse.json({ error: "no such item" }, { status: 404 });
  }
  const item = existing.rows[0];
  const who = session.name || session.user;

  let sql = null;
  let args = [];

  switch (action) {
    case "ack":
      sql = "update items set acked = true, acked_by = $2, updated_at = now() where id = $1 returning *";
      args = [id, who];
      break;
    case "done":
      sql = "update items set status = 'done', closed_at = now(), updated_at = now() where id = $1 returning *";
      args = [id];
      break;
    case "reopen":
      sql = "update items set status = 'open', closed_at = null, snooze_until = null, updated_at = now() where id = $1 returning *";
      args = [id];
      break;
    case "snooze": {
      const days = Math.min(Math.max(parseInt(body.days, 10) || 1, 1), 30);
      sql = `update items set status = 'snoozed',
             snooze_until = now() + ($2 || ' days')::interval,
             updated_at = now() where id = $1 returning *`;
      args = [id, String(days)];
      break;
    }
    case "wake":
      sql = "update items set status = 'open', snooze_until = null, updated_at = now() where id = $1 returning *";
      args = [id];
      break;
    case "approve":
      sql = `update items set verdict = 'approved', verdict_by = $2, verdict_at = now(),
             acked = true, updated_at = now() where id = $1 returning *`;
      args = [id, who];
      break;
    case "reject":
      sql = `update items set verdict = 'rejected', verdict_by = $2, verdict_at = now(),
             acked = true, updated_at = now() where id = $1 returning *`;
      args = [id, who];
      break;
    case "assign":
      sql = "update items set assignee = $2, updated_at = now() where id = $1 returning *";
      args = [id, (body.assignee || "").trim() || null];
      break;
    case "comment": {
      const text = (body.text || "").trim();
      if (!text) {
        return NextResponse.json({ error: "empty comment" }, { status: 400 });
      }
      const comments = (item.comments || []).concat([
        {
          at: new Date().toISOString(),
          source: isBot ? "bot" : "office",
          by: who,
          text: text.slice(0, 4000),
        },
      ]);
      sql = `update items set comments = $2::jsonb, acked = true, updated_at = now()
             where id = $1 returning *`;
      args = [id, JSON.stringify(comments.slice(-40))];
      break;
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const { rows } = await query(sql, args);
  return NextResponse.json({ item: rowToItem(rows[0]) });
}
