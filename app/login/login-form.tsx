"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

export default function LoginForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await signIn("credentials", { password, redirect: false });
    setBusy(false);
    if (!res || res.error) {
      setError("Wrong password.");
      setPassword("");
      return;
    }
    window.location.href = callbackUrl;
  }

  return (
    <form
      onSubmit={onSubmit}
      className="bg-cream p-8 border-[3px] border-ink shadow-[4px_4px_0_var(--color-ink)] w-[380px]"
    >
      <div className="text-[10px] font-bold tracking-widest uppercase mb-2 text-muted">
        Panel Haus / Curator
      </div>
      <h1 className="text-3xl font-black uppercase mb-6 tracking-wider">
        Sign in
      </h1>
      <label className="block text-[10px] font-bold uppercase tracking-widest text-muted mb-1">
        Curator password
      </label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
        className="w-full border-2 border-ink bg-cream-dark p-2 font-mono text-sm focus:outline-none focus:bg-cream"
      />
      {error && (
        <div className="text-coral text-sm mt-3 font-semibold">{error}</div>
      )}
      <button
        type="submit"
        disabled={busy || !password}
        className="mt-6 w-full bg-gold border-2 border-ink py-2.5 font-black uppercase tracking-widest text-sm shadow-[4px_4px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0_var(--color-ink)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed transition-transform"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
