"use client";

import { useEffect } from "react";

/**
 * Friendly error screen for error.tsx boundaries. Never shows the error text (it may contain internals);
 * shows the reference code, which matches the server log line.
 */
export function ErrorView({ error, retry, home = "/" }: { error: unknown; retry: () => void; home?: string }) {
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">Nothing you entered was lost on our side: anything saved before this is safe. Try again; if it keeps happening, tell the admin.</p>
      {digest && <p className="mt-2 font-mono text-xs text-slate-400">Reference: {digest}</p>}
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" onClick={() => retry()} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
          Try again
        </button>
        <a href={home} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
          Go to start
        </a>
      </div>
    </div>
  );
}
