"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Entry = { id: string; content: string; created_at: string };

export default function PoetryPage() {
  const [items, setItems] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const r = await fetch("/api/poetry", { cache: "no-store" });
    const j = (await r.json()) as { items?: Entry[] };
    setItems(Array.isArray(j.items) ? j.items : []);
  }
  useEffect(() => { load(); }, []);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setBusy("Saving…");
    try {
      const r = await fetch("/api/poetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setText("");
      await load();
      setBusy("Saved");
    } catch (e) {
      setBusy(e instanceof Error ? e.message : String(e));
    } finally {
      setTimeout(() => setBusy(""), 800);
    }
  }

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <Link href="/" style={styles.brand}>Ezra</Link>
        <div style={{ opacity: 0.85 }}>Poetry Book</div>
      </header>

      <section style={styles.panel}>
        <form onSubmit={onAdd} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Compose a poem…"
            style={styles.input}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button style={styles.btn} disabled={!text.trim()}>Add Poem</button>
          </div>
        </form>
        <small style={{ opacity: 0.8 }}>{busy}</small>
      </section>

      <section style={styles.list}>
        {items.map((e) => (
          <article key={e.id} style={styles.card}>
            <div style={styles.meta}>{new Date(e.created_at).toLocaleString()}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{e.content}</div>
          </article>
        ))}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100dvh",
    background: "linear-gradient(180deg, #0f0c29, #302b63, #24243e)",
    color: "#f5f7fb",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
  },
  brand: { textDecoration: "none", color: "inherit", fontWeight: 700 },
  panel: {
    maxWidth: 900,
    margin: "12px auto",
    padding: 12,
    borderRadius: 10,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
  },
  input: {
    width: "100%",
    minHeight: 120,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.2)",
    padding: 10,
    background: "rgba(255,255,255,0.06)",
    color: "#f5f7fb",
    outline: "none",
    fontSize: 16,
    boxSizing: "border-box",
  },
  btn: {
    border: "1px solid rgba(255,255,255,0.3)",
    padding: "10px 14px",
    borderRadius: 999,
    background: "transparent",
    color: "#f5f7fb",
    fontWeight: 600,
    cursor: "pointer",
  },
  list: {
    maxWidth: 900,
    margin: "0 auto 24px",
    padding: 12,
    display: "grid",
    gap: 10,
  },
  card: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    padding: 12,
  },
  meta: { fontSize: 12, opacity: 0.7, marginBottom: 6 },
};
