"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Mode = "start" | "restore";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("start");
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Fresh start: anonymous session, then cf_join creates the profile only if the
   * invite code is valid. Profiles can no longer be created from the client —
   * that was how anyone on the internet could read the answer keys
   * (scripts/sql/2026-10-01c-invite-gate.sql).
   */
  async function enter(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !invite.trim()) return;
    setBusy(true);
    setErr(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) {
      setBusy(false);
      setErr(error?.message ?? "Could not start a session.");
      return;
    }
    const { data: joined, error: jErr } = await supabase.rpc("cf_join", {
      p_display_name: name.trim(),
      p_invite: invite.trim(),
    });
    const result = joined as { ok: boolean; error?: string } | null;
    if (jErr || !result?.ok) {
      // Drop the half-made anonymous session so a retry starts clean.
      await supabase.auth.signOut();
      setBusy(false);
      setErr(result?.error ?? jErr?.message ?? "Could not join.");
      return;
    }
    // Full navigation so the server proxy sees the new auth cookies.
    window.location.assign("/");
  }

  /**
   * Restore: still start an anonymous session, then hand it to cf_claim_profile,
   * which verifies the PIN and moves the saved history onto this session.
   */
  async function restore(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !pin) return;
    setBusy(true);
    setErr(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) {
      setBusy(false);
      setErr(error?.message ?? "Could not start a session.");
      return;
    }
    // No placeholder profile is created here on purpose: cf_claim_profile makes
    // the row itself, only after the PIN checks out, so a rejected attempt
    // leaves nothing behind.
    // Auth failure comes back as { ok: false, error } rather than a thrown
    // error, so the server-side attempt counter can commit — see
    // scripts/sql/2026-08-06-claim-lockout-fix.sql.
    const { data: claim, error: cErr } = await supabase.rpc("cf_claim_profile", {
      p_username: username.trim(),
      p_pin: pin,
    });
    const result = claim as { ok: boolean; error?: string } | null;
    if (cErr || !result?.ok) {
      await supabase.auth.signOut();
      setBusy(false);
      setErr(result?.error ?? cErr?.message ?? "Could not restore that account.");
      return;
    }
    window.location.assign("/");
  }

  return (
    <div className="mx-auto mt-16 max-w-md">
      <div className="card p-8">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="text-accenthi">CERT</span> FORGE
        </h1>
        <p className="mt-1 text-sm text-ink2">
          Study tracker + exam simulator for the Anthropic Partner Certification program.
        </p>

        <div className="mt-6 flex gap-1 rounded-lg border border-edge p-0.5 text-sm font-semibold">
          <button
            type="button"
            onClick={() => {
              setMode("start");
              setErr(null);
            }}
            className={`flex-1 rounded-md px-3 py-1.5 ${mode === "start" ? "bg-accent text-white" : "text-ink2"}`}
          >
            Start fresh
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("restore");
              setErr(null);
            }}
            className={`flex-1 rounded-md px-3 py-1.5 ${mode === "restore" ? "bg-accent text-white" : "text-ink2"}`}
          >
            Restore my account
          </button>
        </div>

        {mode === "start" ? (
          <>
            <form onSubmit={enter} className="mt-5 space-y-3">
              <label className="block text-sm text-ink2" htmlFor="name">
                Enter your name to start
              </label>
              <input
                id="name"
                type="text"
                required
                autoFocus
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Alex R"
                className="w-full"
              />
              <label className="block text-sm text-ink2" htmlFor="invite">
                Invite code
              </label>
              <input
                id="invite"
                type="text"
                required
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={40}
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                placeholder="From Support Forge"
                className="w-full"
              />
              {err && <p className="text-sm text-bad">{err}</p>}
              <button className="btn btn-primary w-full" disabled={busy}>
                {busy ? "Starting…" : "Start studying"}
              </button>
            </form>
            <p className="mt-4 text-xs text-ink3">
              Already have an account? Use <b>Restore my account</b> instead — no invite needed.
              This profile lives on this device. Set a username and PIN afterwards from Readiness
              and you can pick it up on any other device — without one, a new browser or cleared
              storage starts you over from zero.
            </p>
          </>
        ) : (
          <>
            <form onSubmit={restore} className="mt-5 space-y-3">
              <label className="block text-sm text-ink2" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                type="text"
                required
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                maxLength={24}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full"
              />
              <label className="block text-sm text-ink2" htmlFor="pin">
                PIN
              </label>
              <input
                id="pin"
                type="password"
                required
                inputMode="numeric"
                autoComplete="current-password"
                pattern="[0-9]{4,10}"
                maxLength={10}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="w-full"
              />
              {err && <p className="text-sm text-bad">{err}</p>}
              <button className="btn btn-primary w-full" disabled={busy}>
                {busy ? "Restoring…" : "Restore my account"}
              </button>
            </form>
            <p className="mt-4 text-xs text-ink3">
              Brings your full history onto this device. Cert Forge keeps one active device at a
              time, so whichever device you were using before will ask you to sign in again.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
