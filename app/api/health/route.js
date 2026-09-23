import { NextResponse } from "next/server";
import { query } from "../../../lib/db";

export const dynamic = "force-dynamic";

/**
 * IS THE BOARD REACHABLE, AND IS THE DATABASE BEHIND IT AWAKE?
 *
 * This exists so that "the reporting isn't coming through" can be answered in
 * one request instead of three guesses. Point curl, Zapier's test button, or
 * a bot at it and the answer distinguishes the three things that actually go
 * wrong: the deployment is protected and you are talking to Vercel's login
 * wall rather than the app (you get HTML, not JSON); the app is up but
 * DATABASE_URL is wrong (db: false); the app is up and fine (db: true).
 *
 * IT DELIBERATELY NEEDS NO CREDENTIALS AND RETURNS NO DATA. A diagnostic you
 * cannot run until you have already proved who you are is useless for
 * diagnosing why you cannot prove who you are. Every field here is true of
 * the server itself — nothing about an item, a customer or a bot — so there
 * is nothing to leak. `configured` reports only whether each environment
 * variable is SET, never any part of its value.
 */
export async function GET() {
  let db = false;
  let dbError = null;
  try {
    await query("select 1");
    db = true;
  } catch (err) {
    dbError = String(err?.message || err).slice(0, 200);
  }

  return NextResponse.json({
    ok: true,
    service: "squatch-dispatch",
    time: new Date().toISOString(),
    db,
    dbError,
    configured: {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      AUTH_SECRET: Boolean(process.env.AUTH_SECRET),
      BOT_API_KEY: Boolean(process.env.BOT_API_KEY),
      OFFICE_USERS: (() => {
        try {
          const list = JSON.parse(process.env.OFFICE_USERS || "[]");
          return Array.isArray(list) ? list.length : 0;
        } catch {
          return "not valid JSON";
        }
      })(),
    },
  });
}
