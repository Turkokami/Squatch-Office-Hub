import { NextResponse } from "next/server";
import { verifyPassword, makeSession, COOKIE_NAME, COOKIE_MAX_AGE } from "../../../lib/auth";

/**
 * A SPEED LIMIT ON GUESSING. This route is the front door and it had no limit
 * at all: an office password could be attacked as fast as the network allows.
 * scrypt makes each guess cost real work, which is the main defense and is
 * already in place — this stops someone running thousands of them a minute
 * anyway.
 *
 * Be honest about what it is worth. The counter lives in the memory of one
 * serverless instance, so Vercel can run several and an attacker spread
 * across them gets a few times this allowance; a restart clears it. It raises
 * the cost of a guessing run and does not end it. The thing that ends it is
 * passwords long enough not to be guessed, which is why the README says to
 * use a password manager rather than a season and a year.
 */
const ATTEMPTS = new Map();
const WINDOW_MS = 10 * 60 * 1000; // ten minutes
const MAX_TRIES = 10;

function tooMany(ip) {
  const now = Date.now();
  const rec = ATTEMPTS.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) {
    ATTEMPTS.set(ip, { first: now, count: 1 });
    if (ATTEMPTS.size > 5000) ATTEMPTS.clear(); // never grow without bound
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_TRIES;
}

export async function POST(req) {
  /* x-forwarded-for is set by Vercel's edge and can be forged anywhere else,
     which is another reason not to lean on this for security. */
  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  if (tooMany(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes and try again." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const user = verifyPassword(body.username, body.password);
  if (!user) {
    /* One message for a wrong username and a wrong password alike: naming
       which half was wrong tells an attacker which usernames exist. */
    return NextResponse.json(
      { error: "That username and password don't match." },
      { status: 401 }
    );
  }

  ATTEMPTS.delete(ip);
  const res = NextResponse.json({ ok: true, name: user.name });
  res.cookies.set(COOKIE_NAME, makeSession(user), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
