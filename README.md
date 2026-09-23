# Squatch-Bot Dispatch — office web app

A self-contained Next.js app: office staff sign in with a username and password on
your own domain, see what the Squatch-Bot Army has filed, and act on it. The bots
write to it over HTTP with a shared key.

---

## What changed on intake — 23 Sep 2026

Four things were fixed before this was put anywhere reachable. They are
recorded here because the second one had been live-ready as written.

**1. The board was readable by anyone, with no password.** `middleware.js`
waved through any `/api/*` request that merely *had* an `x-bot-key` header —
it never checked the value — and `GET /api/items` and `GET /api/runs` had no
check of their own. So `curl /api/items -H "x-bot-key: anything"` returned up
to 400 items: customer names, money figures, drafted replies, who approved
what. Every route now identifies its own caller through `callerFrom()`, and
middleware no longer guards the API at all.

**2. Sign-in could not have worked.** `middleware.js` imported `node:crypto`,
which does not exist on the Edge runtime that middleware runs on by default.
Middleware now checks only whether a session cookie is *present*, and whether
it is *genuine* is decided by the board page and by each route — where the
data is, and where the arithmetic is available.

**3. Next.js was three critical advisories behind.** The pinned `15.5.4` is
vulnerable to CVE-2025-66478 — a CVSS 10.0 remote-code-execution hole in the
React Server Components protocol, affecting App Router apps exactly like this
one — plus the December 11 denial-of-service and source-code-exposure pair.
Now on the latest patched 15.5.x. **If a version of this app was ever
deployed publicly on 15.5.4, rotate `AUTH_SECRET`, `BOT_API_KEY` and the
database password**, per Vercel's own advice for that CVE.

**4. The database connection accepted any certificate.** `rejectUnauthorized:
false` meant encrypted but unverified — no proof the thing answering is your
database. Neon, Supabase and Vercel Postgres all present publicly trusted
certificates, so verification simply works. `DATABASE_CA` and
`DATABASE_SSL_NO_VERIFY` exist in `.env.example` for the rare provider that
needs them.

Also added: a speed limit on password guessing (`/api/login`), and
`/api/health` for diagnosing a bot that cannot get through.

What was already right, and is worth saying: scrypt hashing with per-user
salts, timing-safe comparison, signed httpOnly cookies, no plaintext password
anywhere, and parameterized SQL throughout.

---

## What's in here

```
app/
  page.jsx              the board (server component → Board)
  board.jsx             the board UI, all the buttons
  login/page.jsx        the login screen
  api/login|logout      session in/out
  api/items             GET list (office) · POST new item (bots)
  api/items/[id]        PATCH one action: ack, done, snooze, wake,
                        approve, reject, assign, comment
  api/runs              GET last run per bot · POST a run record (bots)
lib/db.js               Postgres pool + row mapping
lib/auth.js             password check, signed session cookie, bot key check
middleware.js           everything needs a session except /login and bot calls
schema.sql              the two tables
scripts/hash-password.mjs   turns a password into the hash you store
```

## Setup

**1. Database.** Any Postgres works — Neon, Supabase, or Vercel Postgres, all have a
free tier. Create it, then run `schema.sql` against it once.

**2. Environment variables** (Vercel → Project → Settings → Environment Variables):

| Name | What it is |
|---|---|
| `DATABASE_URL` | the Postgres connection string |
| `AUTH_SECRET` | any long random string — `openssl rand -base64 32` |
| `BOT_API_KEY` | another long random string; the bots send it as `x-bot-key` |
| `OFFICE_USERS` | JSON array of the office logins (below) |

**3. Office logins.** Never put a plain password in the code or in an environment
variable. For each person run:

```
npm install
node scripts/hash-password.mjs "their password"
```

It prints `<salt>:<key>`. Build `OFFICE_USERS` from those:

```json
[
  {"user":"kristofer","name":"Kristofer","hash":"a1b2…:9f8e…"},
  {"user":"office","name":"Front Office","hash":"c3d4…:7a6b…"}
]
```

Give each person their own login rather than one shared account — then the board can
show who approved what, and one person leaving means changing one line.

**4. Deploy** to Vercel and point a subdomain at it, e.g. `dispatch.sasquatchpestcontrol.com`.

**5. Test:** open the subdomain → you should be redirected to `/login`.

---

## How the bots write to it

Scheduled Claude tasks run in Anthropic's cloud, and that network **cannot reach
outside websites** — this was tested and the request is refused. So a bot cannot POST
here directly. Two ways around it:

**A. Email bridge (no code here to change).** The bot emails a structured report to a
dedicated address. Zapier (or Make) watches that mailbox, parses it, and POSTs to this
app. That's the only change: a Zap with an email trigger and a webhook action.

**B. Run the bot on the PC.** Tasks bound to the office computer may be able to reach
this app directly from there, depending on the network policy on that machine. Worth
one test before paying for Zapier.

Either way the request looks like this:

```http
POST https://dispatch.sasquatchpestcontrol.com/api/items
x-bot-key: <BOT_API_KEY>
content-type: application/json

{
  "bot": "yoda",
  "botName": "Yoda · Gorilla Bot",
  "kind": "decision",          // decision | draft | alert | info
  "priority": "high",
  "title": "Rodent follow-up price missing from Top Note",
  "detail": "What a person needs to decide, and why.",
  "draft": "Text of a reply or post, for kind=draft",
  "draftChannel": "Google review reply",
  "comments": [{ "at": "2026-09-23T00:30:00Z", "source": "bot", "text": "The evidence." }]
}
```

Recording a run (drives the right-hand rail, so a bot that silently stops shows up):

```http
POST /api/runs
x-bot-key: <BOT_API_KEY>

{ "bot": "yoda", "botName": "Yoda · Gorilla Bot", "status": "ok",
  "summary": "3 accounts audited, 1 needs a price" }
```

Reading back what the office decided, at the start of the next run:

```http
GET /api/items?bot=yoda&open=1
x-bot-key: <BOT_API_KEY>
```

**A bot must name itself in `?bot=`.** Reading the whole board in one request
is for a signed-in person; a bot key with no `bot=` now gets a 400 saying so.
One key is shared by every bot, so this does not make a stolen key harmless —
it stops a stolen key being a single request away from everything. The call
above, the one this README always documented, is unchanged.

Each item carries `verdict` (`approved` / `rejected` / null), `assignee`, and the
`comments` array. An approved draft means send it; a rejected one means never send it;
an office comment is an instruction. When the bot is finished with an item:

```http
PATCH /api/items/<id>
x-bot-key: <BOT_API_KEY>

{ "action": "comment", "text": "Set the follow-up to $95 as you asked.", "botName": "Yoda" }
```

then

```http
PATCH /api/items/<id>
x-bot-key: <BOT_API_KEY>

{ "action": "done" }
```

---

## When the reporting isn't coming through

Ask the app first. `/api/health` needs no credentials and returns nothing
about any customer, bot or item — only whether the server is up, whether it
can reach the database, and which environment variables are *set* (never any
part of their values).

```bash
curl https://dispatch.sasquatchpestcontrol.com/api/health
```

Read the answer like this:

| What comes back | What it means |
|---|---|
| JSON, `"db": true` | The app is healthy. The problem is upstream — the sender. |
| JSON, `"db": false` with `dbError` | App is up, database is not reachable. Check `DATABASE_URL`. |
| JSON, a `configured` field showing `false` | That environment variable was never set, or was set for Preview and not Production. |
| HTML, or a Vercel login page | **Deployment Protection is on.** See below — this is the usual culprit. |
| Nothing / connection refused | Wrong domain, or the deployment isn't live. |

**Deployment Protection is the one that catches everybody.** Vercel can put
its own authentication in front of a project, and when it is on, a bot's POST
never reaches this code at all — Vercel answers first with an HTML login page,
and the bot sees a "success" that wrote nothing. Turn it off for Production
(Project → Settings → Deployment Protection), or issue a Protection Bypass
token and have the sender include it. Preview deployments are protected by
default even when Production is not, which is why a Zap tested against a
preview URL can "work" and then never deliver.

Then check the sender, in this order:

1. **Header name.** `x-bot-key`, spelled exactly. `Authorization: Bearer <key>`
   also works. Anything else is rejected as an unknown caller.
2. **Right key.** A wrong value is a 401, not a silent failure — so look at the
   response body your sender received rather than assuming.
3. **Required fields.** `POST /api/items` needs `bot` and `title`. Missing
   either is a 400 with the reason in the body.
4. **Content type.** `application/json`, and a body that is actually JSON.
5. **The URL.** The production domain, not a preview one.

A live end-to-end test that leaves a visible result on the board:

```bash
curl -X POST https://dispatch.sasquatchpestcontrol.com/api/items \
  -H "x-bot-key: $BOT_API_KEY" \
  -H "content-type: application/json" \
  -d '{"bot":"yoda","botName":"Yoda · Gorilla Bot","kind":"info",
       "title":"Connection test","detail":"Delete me."}'
```

A `201` and an item on the board means the whole path works. Anything else
returns the reason in the body — read it rather than guessing.

### Getting the bots to reach it at all

The bots are the other half of this and they are not solved by anything in
this repo. Three routes, in the order worth trying:

1. **A scheduled task on the office PC.** It has ordinary network access, so it
   can POST here directly with no middleman and no monthly bill. Test this
   first — it costs one run to find out.
2. **An email bridge.** The bot emails a structured report to a dedicated
   address; Zapier or Make watches that mailbox, parses it, and POSTs here.
   Reliable, costs a Zapier plan, and adds a few minutes of delay.
3. **Direct from a cloud-scheduled task.** Only if that environment is allowed
   to make outbound requests. Worth one test before building around it —
   and it is a test, not an assumption, either way.

Whichever route, the request is the same shape as the one documented above.

## Security notes worth keeping

- `BOT_API_KEY` is the only thing standing between the internet and writing items.
  Treat it like a password, keep it out of the repo, and rotate it if it's ever pasted
  into a chat, an email, or a Zap someone else can read.
- Sessions last 12 hours and the cookie is signed with `AUTH_SECRET`. Changing that
  secret signs everybody out, which is the fastest way to cut off access.
- There's no password reset flow. To change someone's password, generate a new hash and
  update `OFFICE_USERS`.
- This board carries customer names, money figures, and drafted replies. Keep it on
  HTTPS (Vercel does this by default) and don't share the login outside the office.
