import crypto from "node:crypto";

// Repeated as a literal in middleware.js, which must not import this file —
// see the note there. Change it in both places, or sessions stop being read.
const COOKIE = "squatch_session";
const MAX_AGE = 60 * 60 * 12; // 12 hours

// OFFICE_USERS is a JSON array set in the hosting environment, e.g.
// [{"user":"kristofer","name":"Kristofer","hash":"<salt>:<key>"}]
// Generate each hash with: npm run hash -- "the password"
function users() {
  try {
    const parsed = JSON.parse(process.env.OFFICE_USERS || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function verifyPassword(username, password) {
  const record = users().find(
    (u) => String(u.user).toLowerCase() === String(username || "").trim().toLowerCase()
  );
  if (!record || typeof record.hash !== "string") return null;
  const [salt, key] = record.hash.split(":");
  if (!salt || !key) return null;
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  const a = Buffer.from(derived, "hex");
  const b = Buffer.from(key, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { user: record.user, name: record.name || record.user };
}

function sign(value) {
  return crypto
    .createHmac("sha256", process.env.AUTH_SECRET || "")
    .update(value)
    .digest("base64url");
}

export function makeSession(user) {
  const body = Buffer.from(
    JSON.stringify({ u: user.user, n: user.name, exp: Date.now() + MAX_AGE * 1000 })
  ).toString("base64url");
  return body + "." + sign(body);
}

export function readSession(token) {
  if (!token || typeof token !== "string") return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!data.exp || data.exp < Date.now()) return null;
    return { user: data.u, name: data.n };
  } catch {
    return null;
  }
}

export const COOKIE_NAME = COOKIE;
export const COOKIE_MAX_AGE = MAX_AGE;

/**
 * WHO IS ASKING — the single answer every route and the board page uses.
 *
 * Returns { user, name, isBot } for a caller who proved who they are, and
 * null for everyone else. A route that does not call this has no gate on it:
 * middleware deliberately does not check the API any more, because the
 * version that did let anyone through on the mere presence of an x-bot-key
 * header. Read the note at the top of middleware.js before moving this.
 *
 * Takes the request rather than next/headers' cookies() so that one function
 * serves GET, POST and PATCH handlers alike.
 */
export function callerFrom(req) {
  if (checkBotKey(req)) return { user: "bot", name: "Bot", isBot: true };
  const token = req?.cookies?.get?.(COOKIE)?.value;
  const session = readSession(token);
  return session ? { ...session, isBot: false } : null;
}

// Bots and Zapier authenticate with a shared key instead of a login.
export function checkBotKey(req) {
  const key = process.env.BOT_API_KEY;
  if (!key) return false;
  const sent =
    req.headers.get("x-bot-key") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!sent || sent.length !== key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(key));
}
