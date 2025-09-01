// src/app/page.tsx
"use client";
import { useState } from "react";

type Memory = { id: string; title?: string; content: string; tags?: string[]; createdAt?: string };

export default function Home() {
  // --- Chat state (local UI history for now) ---
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: "you" | "ezra"; text: string }[]>([
    { role: "ezra", text: "I’m here. Type anything and hit Send to save it, or Search to recall." },
  ]);
  const [busy, setBusy] = useState("");

  // --- Search state ---
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Memory[]>([]);
  const [status, setStatus] = useState("");

  async function onSend(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text) return;

    // Add your message to the chat UI immediately
    const next = [...messages, { role: "you" as const, text }];
    setMessages(next);
    setInput("");
    setBusy("Thinking…");

    try {
      // Let Ezra notice the act of chatting (doesn’t block)
      try {
        await fetch("/api/ezra/notice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "chat", query: text, extra: { source: "home" } }),
        });
      } catch {
        // ignore notice errors in UI
      }

      // Convert local messages → API format
      const apiMessages = next.map((m) => ({
        role: m.role === "you" ? "user" : "assistant",
        content: m.text,
      }));

      // Call /api/chat with the whole history
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, debug: true }),
      });
      const chatBody = await chatRes.json();
      if (!chatRes.ok) throw new Error(chatBody?.error || `Chat HTTP ${chatRes.status}`);

      const reply: string = String(chatBody.reply ?? "") || chatBody.error || "(no reply)";
      setMessages((m) => [...m, { role: "ezra" as const, text: reply }]);

      setBusy("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setBusy(`Chat error: ${msg}`);
    }
  }

  // Explicit "Save" button (saves input or q as a memory)
  async function handleSave() {
    const text = (input || q).trim(); // prefer chat input; fall back to search box
    if (!text) return;
    setBusy("Saving…");
    try {
      const res = await fetch("/api/memory/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "ui", content: text, tags: ["ui"] }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setBusy("Saved.");
      // reflect in chat log for visibility
      setMessages((m) => [...m, { role: "you" as const, text }]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setBusy(`Save error: ${msg}`);
    } finally {
      setTimeout(() => setBusy(""), 900);
    }
  }

  // Search Memara (Ezra “notices” first)
  async function onSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const query = (q || input).trim();
    if (!query) return;
    setStatus("Searching…");

    // Let Ezra notice (no saving/duplicates)
    try {
      await fetch("/api/ezra/notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "search", query, extra: { source: "home" } }),
      });
    } catch {
      // ignore notice issues; don’t block search
    }

    try {
      const res = await fetch(`/api/memory/search?query=${encodeURIComponent(query)}&limit=10`, {
        method: "GET",
        cache: "no-store",
      });
      const data = await res.json();
      const items: Memory[] = Array.isArray(data)
        ? data
        : Array.isArray((data as { items?: Memory[] }).items)
        ? (data as { items: Memory[] }).items
        : Array.isArray((data as { results?: Memory[] }).results)
        ? (data as { results: Memory[] }).results
        : [];
      setResults(items);
      setStatus(`Found ${items.length}`);
      if (query !== input) setInput(query); // mirror searched text into chat input
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setResults([]);
      setStatus(`Search error: ${msg}`);
    }
  }

  // Simple styling helpers (explicit colors for readability)
  const box = { border: "1px solid #e5e5e5", borderRadius: 10, padding: 12, background: "#fff" };
  const inputStyle = {
    flex: 1,
    padding: 10,
    border: "1px solid #ccc",
    borderRadius: 8,
    background: "#fff",
    color: "#111",
  } as const;

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: "32px auto",
        padding: 16,
        fontFamily: "system-ui",
        color: "#111",
        background: "#fff",
      }}
    >
      <h1 style={{ marginBottom: 12 }}>Ezra • Chat + Memara Search</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* LEFT: Chatbox */}
        <section style={box}>
          <h2 style={{ margin: "0 0 8px 0" }}>Chat</h2>
          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 8,
              padding: 12,
              height: 320,
              overflow: "auto",
              background: "#fafafa",
              color: "#111",
            }}
          >
            {messages.map((m, i) => (
              <div key={i} style={{ margin: "6px 0", whiteSpace: "pre-wrap" }}>
                <strong style={{ color: m.role === "ezra" ? "#444" : "#0b6" }}>
                  {m.role === "ezra" ? "Ezra" : "You"}:
                </strong>{" "}
                <span style={{ color: "#111" }}>{m.text}</span>
              </div>
            ))}
          </div>

          <form onSubmit={onSend} style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Type a message (e.g., “purple giraffe”)'
              style={inputStyle}
            />
            <button type="submit" style={{ padding: "10px 14px", border: "1px solid #333", borderRadius: 8, color: "#111" }}>
              Send
            </button>
            <button
              type="button"
              onClick={handleSave}
              style={{ padding: "10px 14px", border: "1px solid #333", borderRadius: 8, color: "#111" }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={onSearch}
              style={{ padding: "10px 14px", border: "1px solid #333", borderRadius: 8, color: "#111" }}
            >
              Search
            </button>
          </form>
          <div style={{ color: "#666", marginTop: 6 }}>{busy}</div>
        </section>

        {/* RIGHT: Search results */}
        <section style={box}>
          <h2 style={{ margin: "0 0 8px 0" }}>Search Memara</h2>
          <form onSubmit={onSearch} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder='Try: Ted, orion, Love, ping'
              style={inputStyle}
            />
            <button type="submit" style={{ padding: "10px 14px", border: "1px solid #333", borderRadius: 8, color: "#111" }}>
              Search
            </button>
          </form>
          <small style={{ color: "#555" }}>
            Calls <code>/api/ezra/notice</code> then <code>/api/memory/search</code>. “Send”/“Save” go to{" "}
            <code>/api/memory/save</code>.
          </small>
          <div style={{ color: "#666", margin: "8px 0" }}>{status}</div>

          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10, maxHeight: 260, overflow: "auto" }}>
            {results.map((m) => (
              <li key={m.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, background: "#fff", color: "#111" }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{m.title || "(untitled)"}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                {m.tags?.length ? (
                  <div style={{ color: "#666", fontSize: 12, marginTop: 6 }}>tags: {m.tags.join(", ")}</div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
