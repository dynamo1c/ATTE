"use client";

/** Last resort when the root layout itself fails: own document, no app styles (see Next docs). */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "4rem 1rem", color: "#0f172a" }}>
        <title>Something went wrong · MEI Polytechnic</title>
        <h1 style={{ fontSize: "1.25rem" }}>Something went wrong</h1>
        <p style={{ color: "#475569", fontSize: "0.9rem" }}>Please try again. If it keeps happening, tell the admin.</p>
        <button type="button" onClick={() => retry()} style={{ marginTop: "1rem", padding: "0.5rem 1rem", background: "#1d4ed8", color: "#fff", border: 0, borderRadius: 6 }}>
          Try again
        </button>
      </body>
    </html>
  );
}
