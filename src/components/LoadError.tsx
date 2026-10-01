"use client";

/** Consistent "couldn't load" state with a manual retry — never an infinite spinner. */
export function LoadError({ onRetry, label = "Couldn't load this yet." }: { onRetry: () => void; label?: string }) {
  return (
    <div className="mx-auto mt-16 max-w-md">
      <div className="card p-8 text-center">
        <p className="text-sm text-ink2">{label}</p>
        <p className="mt-1 text-xs text-ink3">
          This is usually a momentary hiccup while your session connects.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button className="btn btn-primary" onClick={onRetry}>
            Try again
          </button>
          <button className="btn btn-ghost" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
