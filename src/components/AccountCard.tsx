"use client";
import { useCallback, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useAsyncData } from "@/lib/useAsyncData";

/**
 * Claim a username + PIN so this profile survives a device change.
 *
 * Without one, the anonymous session IS the account: a new browser or cleared
 * storage silently starts over. That is how one person ended up with three
 * half-populated profiles. This card exists to make that fact visible and
 * fixable, so it stays expanded and warning-toned until a username is set.
 */
export function AccountCard() {
  const supabase = useState(() => supabaseBrowser())[0];
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("cf_my_username");
    if (error) throw error;
    return (data as string | null) ?? null;
  }, [supabase]);
  const { data: username, reload } = useAsyncData(load);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pin !== pin2) return setErr("The two PINs do not match.");
    setBusy(true);
    const { error } = await supabase.rpc("cf_set_credentials", {
      p_username: name.trim(),
      p_pin: pin,
    });
    setBusy(false);
    if (error) return setErr(error.message.replace(/^.*?:\s*/, ""));
    setPin("");
    setPin2("");
    setOpen(false);
    setSaved(true);
    reload();
  }

  const claimed = !!username;

  return (
    <section
      className={`card p-4 ${claimed ? "" : "border-warn/50 bg-warn/5"}`}
      aria-label="Account backup"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold">
            {claimed ? (
              <>
                <span className="text-good">✓</span> Account saved as{" "}
                <span className="font-mono text-accenthi">{username}</span>
              </>
            ) : (
              <>
                <span className="text-warn">⚠</span> This profile only exists on this device
              </>
            )}
          </p>
          <p className="mt-0.5 text-xs text-ink2">
            {claimed
              ? "Sign in on another device with your username and PIN to bring this history with you."
              : "Clearing your browser data or opening Cert Forge on another device will start you over from zero, with no warning. Set a username and PIN to prevent that."}
          </p>
        </div>
        <button className="btn btn-ghost text-sm" onClick={() => setOpen((o) => !o)}>
          {open ? "Cancel" : claimed ? "Change PIN" : "Secure this profile"}
        </button>
      </div>

      {saved && !open && (
        <p className="mt-2 text-xs font-semibold text-good">
          Saved. Write the PIN down — there is no reset.
        </p>
      )}

      {open && (
        <form onSubmit={save} className="mt-4 grid gap-3 border-t border-edge pt-4 sm:grid-cols-3">
          <label className="text-xs text-ink2">
            Username
            <input
              type="text"
              required
              autoCapitalize="none"
              autoCorrect="off"
              maxLength={24}
              defaultValue={username ?? ""}
              onChange={(e) => setName(e.target.value)}
              placeholder="3-24 chars"
              className="mt-1 w-full"
            />
          </label>
          <label className="text-xs text-ink2">
            PIN
            <input
              type="password"
              required
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={10}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="4-10 digits"
              className="mt-1 w-full"
            />
          </label>
          <label className="text-xs text-ink2">
            Confirm PIN
            <input
              type="password"
              required
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={10}
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))}
              className="mt-1 w-full"
            />
          </label>
          {err && <p className="text-sm text-bad sm:col-span-3">{err}</p>}
          <div className="sm:col-span-3">
            <button className="btn btn-primary text-sm" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            <span className="ml-3 text-xs text-ink3">
              There is no PIN reset — nothing here can email you.
            </span>
          </div>
        </form>
      )}
    </section>
  );
}
