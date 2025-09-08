"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Entry = { id: string; content: string; created_at: string };

export default function ClipboardPage() {
  const [items, setItems] = useState<Entry[]>([]);
  const [status, setStatus] = useState("");

  async function load() {
    setStatus("Loading…");
    try {
      const r = await fetch("/api/clipboard", { cache: "no-store" });
      const j = (await r.json()) as { items?: Entry[] };
      setItems(Array.isArray(j.items) ? j.items : []);
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <Link href="/" style={styles.brand}>Ezra</Link>
        <div style={{ opacity: 0.85 }}>Clipboard</div>
      </header>

      <section style={styles.panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ opacity: 0.8 }}>Newest first</div>
          <Link href="/" style={styles.btn}>Chat</Link>
        </div>
        <small style={{ opacity: 0.8 }}>{status}</small>
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
    background: "linear-gradient(180deg, #004e92, #000428)",
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
    minHeight: 110,
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
