"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) {
      router.replace("/");
      router.refresh();
    } else {
      const data = res ? await res.json().catch(() => ({})) : {};
      setError(data.error || "Couldn't sign in. Check the username and password.");
    }
  }

  return (
    <main className="login">
      <form onSubmit={submit}>
        <p className="sub">Sasquatch Pest Control · WA</p>
        <h1>Squatch-Bot Dispatch</h1>
        <label htmlFor="username">
          Username
          <input
            id="username"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label htmlFor="password">
          Password
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? <p className="err">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
