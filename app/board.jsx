"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const BOTS = [
  { key: "yoda", name: "Yoda", sign: "Gorilla Bot" },
  { key: "r2d2", name: "R2-D2", sign: "Dispatch Bot" },
  { key: "vader", name: "Vader", sign: "Ledger Bot" },
  { key: "obiwan", name: "Obi-Wan", sign: "Content Bot" },
  { key: "chewbacca", name: "Chewbacca", sign: "Star Bot" },
  { key: "leia", name: "Leia", sign: "Map Bot" },
  { key: "bobafett", name: "Boba Fett", sign: "Lead Bot" },
];

const TABS = [
  { key: "open", label: "Needs you" },
  { key: "approvals", label: "Approvals" },
  { key: "snoozed", label: "Snoozed" },
  { key: "done", label: "Cleared" },
];

function ago(value) {
  if (!value) return "";
  const t = Date.parse(value);
  if (Number.isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 8) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function whenText(value) {
  if (!value) return "no run filed yet";
  const t = Date.parse(value);
  if (Number.isNaN(t)) return "unknown";
  return new Date(t).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function effectiveStatus(item) {
  if (item.status === "done") return "done";
  if (item.status === "snoozed") {
    if (!item.snoozeUntil) return "snoozed";
    return Date.parse(item.snoozeUntil) > Date.now() ? "snoozed" : "open";
  }
  return "open";
}

function needsApproval(item) {
  return item.kind === "draft" && !item.verdict && effectiveStatus(item) === "open";
}

function botLabel(item) {
  const bot = BOTS.find((b) => b.key === item.bot);
  return bot ? `${bot.name} · ${bot.sign}` : item.botName || item.bot;
}

export default function Board({ who }) {
  const [items, setItems] = useState([]);
  const [runs, setRuns] = useState([]);
  const [view, setView] = useState("open");
  const [picked, setPicked] = useState({});
  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState({});
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        fetch("/api/items", { cache: "no-store" }),
        fetch("/api/runs", { cache: "no-store" }),
      ]);
      if (a.ok) setItems((await a.json()).items || []);
      if (b.ok) setRuns((await b.json()).runs || []);
      setLive(a.ok && b.ok);
    } catch {
      setLive(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 20000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  async function act(id, body) {
    if (busy[id]) return;
    setBusy((s) => ({ ...s, [id]: true }));
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const { item } = await res.json();
        setItems((list) => list.map((x) => (x.id === item.id ? item : x)));
      }
    } finally {
      setBusy((s) => ({ ...s, [id]: false }));
    }
  }

  const counts = useMemo(() => {
    let open = 0;
    let approvals = 0;
    let snoozed = 0;
    const perBot = {};
    for (const item of items) {
      const st = effectiveStatus(item);
      if (st === "open") {
        open += 1;
        perBot[item.bot] = (perBot[item.bot] || 0) + 1;
      }
      if (st === "snoozed") snoozed += 1;
      if (needsApproval(item)) approvals += 1;
    }
    return { open, approvals, snoozed, perBot };
  }, [items]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const chosen = Object.keys(picked);
    return items
      .filter((item) => {
        const st = effectiveStatus(item);
        if (view === "open" && st !== "open") return false;
        if (view === "snoozed" && st !== "snoozed") return false;
        if (view === "done" && st !== "done") return false;
        if (view === "approvals" && !needsApproval(item)) return false;
        if (chosen.length && !picked[item.bot]) return false;
        if (needle) {
          const hay = [
            item.title,
            item.detail,
            item.draft,
            item.assignee,
            botLabel(item),
            ...(item.comments || []).map((c) => c.text),
          ]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (view === "done") {
          return Date.parse(b.closedAt || b.createdAt) - Date.parse(a.closedAt || a.createdAt);
        }
        const pa = a.priority === "high" ? 0 : 1;
        const pb = b.priority === "high" ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return Date.parse(a.createdAt) - Date.parse(b.createdAt);
      });
  }, [items, view, picked, q]);

  const emptyCopy = {
    open: ["Nothing waiting", "Every bot report has been cleared. New items land here the moment a bot files one."],
    approvals: ["No drafts to approve", "When a bot writes a reply, review response or post, it waits here for your yes."],
    snoozed: ["Nothing snoozed", "Snoozed items reappear in Needs you when their time is up."],
    done: ["Nothing cleared yet", "Items you finish stay here so you can look back at what was decided."],
  }[view];

  const assigneeNames = [...new Set(items.map((i) => i.assignee).filter(Boolean))];

  return (
    <>
      <header className="top">
        <div className="wrap top-in">
          <div className="brand">
            <h1>Squatch-Bot Dispatch</h1>
            <span className="sub">Sasquatch Pest Control · WA</span>
          </div>
          <div className="counts">
            <span className="c-open"><b>{counts.open}</b> needs you</span>
            <span className="c-appr"><b>{counts.approvals}</b> approvals</span>
            <span className="c-snz"><b>{counts.snoozed}</b> snoozed</span>
          </div>
          <div className="who">
            <span>{live ? `signed in as ${who}` : "reconnecting…"}</span>
            <button
              className="btn"
              onClick={async () => {
                await fetch("/api/logout", { method: "POST" });
                window.location.href = "/login";
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="wrap">
        <div className="controls">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={view === t.key}
                onClick={() => setView(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            id="search"
            className="search"
            type="search"
            placeholder="Search items, customers, notes"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="botbar">
          <button
            className="botchip"
            aria-pressed={Object.keys(picked).length === 0}
            onClick={() => setPicked({})}
          >
            All bots
          </button>
          {BOTS.map((b) => (
            <button
              key={b.key}
              className="botchip"
              aria-pressed={!!picked[b.key]}
              onClick={() =>
                setPicked((p) => {
                  const next = { ...p };
                  if (next[b.key]) delete next[b.key];
                  else next[b.key] = true;
                  return next;
                })
              }
            >
              {b.name}
              <span className="n">{counts.perBot[b.key] || 0}</span>
            </button>
          ))}
        </div>

        <div className="board">
          <section className="queue">
            {visible.length === 0 ? (
              <div className="empty">
                <strong>{emptyCopy[0]}</strong>
                {emptyCopy[1]}
              </div>
            ) : (
              visible.map((item) => {
                const st = effectiveStatus(item);
                const isBusy = !!busy[item.id];
                return (
                  <article key={item.id} className={`item k-${item.kind} s-${st}`}>
                    <div className="stripe" />
                    <div className="item-in">
                      <div className="meta">
                        <span className="bot">{botLabel(item)}</span>
                        <span>{ago(item.createdAt)}</span>
                        <span className={`tag ${item.kind}`}>{item.kind}</span>
                        {item.priority === "high" ? <span className="tag alert">urgent</span> : null}
                        {item.assignee ? <span className="tag assigned">{item.assignee}</span> : null}
                        {item.acked && st === "open" ? <span className="tag acked">seen</span> : null}
                      </div>

                      <h3>{item.title}</h3>
                      {item.detail ? <p className="detail">{item.detail}</p> : null}

                      {item.draft ? (
                        <details className="draft" open={view === "approvals"}>
                          <summary>
                            Preview draft{item.draftChannel ? ` · ${item.draftChannel}` : ""}
                          </summary>
                          <div className="body">{item.draft}</div>
                        </details>
                      ) : null}

                      <div className="actions">
                        {st !== "done" ? (
                          <>
                            {item.kind === "draft" && !item.verdict ? (
                              <>
                                <button className="btn gold" disabled={isBusy} onClick={() => act(item.id, { action: "approve" })}>
                                  Approve
                                </button>
                                <button className="btn warn" disabled={isBusy} onClick={() => act(item.id, { action: "reject" })}>
                                  Reject
                                </button>
                              </>
                            ) : null}
                            {!item.acked ? (
                              <button className="btn" disabled={isBusy} onClick={() => act(item.id, { action: "ack" })}>
                                Acknowledge
                              </button>
                            ) : null}
                            <button className="btn go" disabled={isBusy} onClick={() => act(item.id, { action: "done" })}>
                              Done
                            </button>
                            {st === "snoozed" ? (
                              <button className="btn" disabled={isBusy} onClick={() => act(item.id, { action: "wake" })}>
                                Wake now
                              </button>
                            ) : (
                              <>
                                <button className="btn" disabled={isBusy} onClick={() => act(item.id, { action: "snooze", days: 1 })}>
                                  Snooze 1d
                                </button>
                                <button className="btn" disabled={isBusy} onClick={() => act(item.id, { action: "snooze", days: 7 })}>
                                  1w
                                </button>
                              </>
                            )}
                            <input
                              className="assign"
                              list="staff-names"
                              placeholder="Assign to…"
                              defaultValue={item.assignee || ""}
                              onBlur={(e) => {
                                const value = e.target.value.trim();
                                if (value !== (item.assignee || "")) {
                                  act(item.id, { action: "assign", assignee: value });
                                }
                              }}
                            />
                          </>
                        ) : (
                          <button className="btn" disabled={isBusy} onClick={() => act(item.id, { action: "reopen" })}>
                            Reopen
                          </button>
                        )}
                        {item.verdict === "approved" ? (
                          <span className="verdict ok">approved · the bot sends it next run</span>
                        ) : null}
                        {item.verdict === "rejected" ? (
                          <span className="verdict no">rejected — nothing will be sent</span>
                        ) : null}
                        {st === "snoozed" && item.snoozeUntil ? (
                          <span className="verdict">back {whenText(item.snoozeUntil)}</span>
                        ) : null}
                      </div>

                      <div className="thread">
                        {(item.comments || []).map((c, i) => (
                          <div className="note" key={i}>
                            <span className={`byline${c.source === "bot" ? " bot" : ""}`}>
                              {c.source === "bot" ? botLabel(item) : c.by || "Office"} · {ago(c.at)}
                            </span>
                            <p>{c.text}</p>
                          </div>
                        ))}
                        <div className="composer">
                          <textarea
                            rows={1}
                            placeholder="Reply to the bot — it reads this on the next run"
                            value={drafts[item.id] || ""}
                            onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                          />
                          <button
                            className="btn"
                            disabled={isBusy}
                            onClick={async () => {
                              const text = (drafts[item.id] || "").trim();
                              if (!text) return;
                              await act(item.id, { action: "comment", text });
                              setDrafts((d) => ({ ...d, [item.id]: "" }));
                            }}
                          >
                            Send
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </section>

          <aside className="rail">
            <h2>Last run</h2>
            <div className="runs">
              {BOTS.map((b) => {
                const r = runs.find((x) => x.bot === b.key);
                return (
                  <div key={b.key} className={`run ${r ? (r.status === "failed" ? "failed" : "ok") : ""}`}>
                    <span className="pip" />
                    <div>
                      <div className="nm">{b.name}</div>
                      <div className="when">{whenText(r?.lastRunAt)}</div>
                      {r?.summary ? <div className="note2">{r.summary}</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <h2>Stripe colors</h2>
            <div className="legend">
              <div className="row">
                <span className="sw" style={{ background: "var(--green)" }} />
                <span><b>Decision</b> — the bot needs an answer to finish the job</span>
              </div>
              <div className="row">
                <span className="sw" style={{ background: "var(--gold)" }} />
                <span><b>Draft</b> — written and waiting; approve it and the next run sends it</span>
              </div>
              <div className="row">
                <span className="sw" style={{ background: "var(--rust)" }} />
                <span><b>Alert</b> — something is wrong and won&apos;t fix itself</span>
              </div>
              <div className="row">
                <span className="sw" style={{ background: "var(--slate)" }} />
                <span><b>Snoozed</b> — comes back on its own</span>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <datalist id="staff-names">
        {assigneeNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </>
  );
}
