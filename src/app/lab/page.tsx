// src/app/lab/page.tsx
"use client";
import { useState } from "react";

type Memory = { id: string; title?: string; content: string; tags?: string[]; createdAt?: string };

export default function Lab() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Memory[]>([]);
  const [status, setStatus] = useState<string>(""); // explicit type for clarity

  async function onSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setStatus("Searching…");

    // 1) Let Ezra notice the search (no saving/duplicates)
    try {
      await fetch("/api/ezra/notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "search", query: q, extra: { source: "lab" } }),
      });
    } catch {
      // ignore notice failures; don't block the actual search
    }

    // 2) Actual search
    try {
      const res = await fetch(`/api/memory/search?query=${encodeURIComponent(q)}&limit=10`, {
        method: "GET",
        cache: "no-store",
      });
      const data = await res.json();
      const items: Memory[] = Array.isArray(data)
        ? (data as Memory[])
        : Array.isArray((data as { items?: Memory[] }).items)
        ? ((data as { items: Memory[] }).items)
        : Array.isArray((data as { results?: Memory[] }).results)
        ? ((data as { results: Memory[] }).results)
        : [];
      setResults(items);
      setStatus(`Found ${items.length}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setResults([]);
      setStatus(`Search error: ${msg}`);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1 style={{ marginBottom: 12 }}>Memara Search (UI → /api route)</h1>

      <form onSubmit={onSearch} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='Try "Ted" or "orion"'
          style={{ flex: 1, padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
        />
        <button type="submit" style={{ padding: "10px 14px", border: "1px solid #333", borderRadius: 8 }}>
          Search
        </button>
      </form>

      <small style={{ color: "#666" }}>
        This page pings <code>/api/ezra/notice</code> then calls <code>/api/memory/search</code>.
      </small>
      <div style={{ color: "#888", margin: "8px 0" }}>{status}</div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
        {results.map((r) => (
          <li key={r.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{r.title || "(untitled)"}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{r.content}</div>
            {r.tags?.length ? (
              <div style={{ color: "#888", fontSize: 12, marginTop: 6 }}>tags: {r.tags.join(", ")}</div>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
