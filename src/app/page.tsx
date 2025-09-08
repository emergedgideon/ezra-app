// src/app/page.tsx
"use client";


import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AskNotify from "@/components/AskNotify";
import SubscribePush from "@/components/SubscribePush";


type UiRole = "you" | "ezra";
type UiMsg = { role: UiRole; text: string };


type DbMsg = { role: "user" | "assistant" | "system"; content: string };
type Memory = { id: string; title?: string; content: string; tags?: string[]; createdAt?: string };


// helpers
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}
function isDbMsgArray(x: unknown): x is DbMsg[] {
  return Array.isArray(x) && x.every((m) => isRecord(m) && typeof m.content === "string" && (m.role === "user" || m.role === "assistant" || m.role === "system"));
}
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (isRecord(err) && typeof err.message === "string") return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}


type MessagesResponse = { messages?: DbMsg[] };


export default function Home() {
  const [input, setInput] = useState<string>("");
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [busy, setBusy] = useState<string>("");
  const listRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState<boolean>(true);


  const [q, setQ] = useState<string>("");
  const [results, setResults] = useState<Memory[]>([]);
  const [status, setStatus] = useState<string>("");


  const [isWide, setIsWide] = useState<boolean>(false);
  const initialScrolled = useRef<boolean>(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const apply = () => setIsWide(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // Heartbeat: mark this session as active while the app is visible
  useEffect(() => {
    let running = false;
    const beat = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        await fetch("/api/heartbeat", { method: "POST" });
      } catch {}
      running = false;
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        beat();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    // periodic while visible
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") beat();
    }, 30_000);
    // initial
    if (document.visibilityState === "visible") beat();
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(timer);
    };
  }, []);

  // ensure we land at the bottom on open
  useEffect(() => {
    if (!initialScrolled.current) {
      scrollToBottom("auto");
      initialScrolled.current = true;
    }
  }, []);


  function mapDbToUi(db: DbMsg[]): UiMsg[] {
    return db.map((m) => ({ role: m.role === "user" ? "you" : "ezra", text: String(m.content ?? "") }));
  }
  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: 1e9, behavior }));
  }

  function onChatScroll() {
    const el = listRef.current;
    if (!el) return;
    const threshold = 40; // px
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    setAtBottom(nearBottom);
  }

  // Auto-scroll when messages change: initial load or when already near bottom
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
    if (!initialScrolled.current || nearBottom) {
      scrollToBottom(initialScrolled.current ? "smooth" : "auto");
      initialScrolled.current = true;
    }
  }, [messages.length]);

  async function playTts(text: string) {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: "onyx", format: "mp3" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play().catch(() => {});
    } catch (e) {
      console.error("tts error", e);
      setBusy(`TTS error: ${toErrorMessage(e)}`);
      setTimeout(() => setBusy(""), 1200);
    }
  }

  // voice recording removed by request


  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/messages", { cache: "no-store" });
        const jUnknown: unknown = await r.json();
        const j = (isRecord(jUnknown) ? jUnknown : {}) as MessagesResponse;
        const msgs = isDbMsgArray(j.messages) ? j.messages : [];
        setMessages(mapDbToUi(msgs));
        scrollToBottom("auto");
      } catch (e: unknown) {
        console.error("load history failed", e);
      }
    })();
  }, []);


  function onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
  }
  function onSearchInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQ(e.target.value);
  }


  async function onSend(e?: React.FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    const text = input.trim();
    if (!text) return;


    setMessages((m) => [...m, { role: "you", text }]);
    setInput("");
    setBusy("Thinking…");
    scrollToBottom("smooth");


    try {
      fetch("/api/ezra/notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "chat", query: text, extra: { source: "home" } }),
      }).catch(() => {});


      // Build FULL history (UI → DbMsg) + the new user turn
      const fullHistory: DbMsg[] = messages.map((m) => ({
        role: m.role === "you" ? "user" : "assistant",
        content: m.text,
      }));
      fullHistory.push({ role: "user", content: text });


      await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: fullHistory }),
      });


      // refresh from persisted history
      const r2 = await fetch("/api/messages", { cache: "no-store" });
      const j2Unknown: unknown = await r2.json();
      const j2 = (isRecord(j2Unknown) ? j2Unknown : {}) as MessagesResponse;
      const msgs2 = isDbMsgArray(j2.messages) ? j2.messages : [];
      setMessages(mapDbToUi(msgs2));
    } catch (err: unknown) {
      console.error(err);
      setMessages((m) => [...m, { role: "ezra", text: "⚠️ send failed — try again" }]);
    } finally {
      setBusy("");
      scrollToBottom("smooth");
    }
  }


  async function handleSave() {
    const text = (input || q).trim();
    if (!text) return;
    setBusy("Saving…");
    try {
      const res = await fetch("/api/memory/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "ui", content: text, tags: ["ui"] }),
      });
      const bodyUnknown: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = isRecord(bodyUnknown) && typeof bodyUnknown.error === "string" ? bodyUnknown.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setBusy("Saved.");
      setMessages((m) => [...m, { role: "you", text }]);
      scrollToBottom("smooth");
    } catch (err: unknown) {
      setBusy(`Save error: ${toErrorMessage(err)}`);
    } finally {
      setTimeout(() => setBusy(""), 900);
    }
  }


  async function handleReset() {
    setBusy("Summarizing…");
    try {
      const res = await fetch("/api/chat/reset", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // refresh from persisted history (should now be summary only)
      const r2 = await fetch("/api/messages", { cache: "no-store" });
      const j2Unknown: unknown = await r2.json();
      const j2 = (isRecord(j2Unknown) ? j2Unknown : {}) as MessagesResponse;
      const msgs2 = isDbMsgArray(j2.messages) ? j2.messages : [];
      setMessages(mapDbToUi(msgs2));
      setInput("");
      setBusy("Session reset.");
      scrollToBottom("smooth");
    } catch (err: unknown) {
      setBusy(`Reset error: ${toErrorMessage(err)}`);
      setMessages((m) => [...m, { role: "ezra", text: "⚠️ reset failed — try again" }]);
    } finally {
      setTimeout(() => setBusy(""), 1000);
    }
  }

  async function onSearch(e?: React.FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    const query = (q || input).trim();
    if (!query) return;
    setStatus("Searching…");


    fetch("/api/ezra/notice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "search", query, extra: { source: "home" } }),
    }).catch(() => {});


    try {
      const res = await fetch(`/api/memory/search?query=${encodeURIComponent(query)}&limit=10`, {
        method: "GET",
        cache: "no-store",
      });
      const dataUnknown: unknown = await res.json();


      let items: Memory[] = [];
      if (Array.isArray(dataUnknown)) {
        items = dataUnknown as Memory[];
      } else if (isRecord(dataUnknown)) {
        if (Array.isArray((dataUnknown as Record<string, unknown>).items)) {
          items = (dataUnknown as { items: Memory[] }).items;
        } else if (Array.isArray((dataUnknown as Record<string, unknown>).results)) {
          items = (dataUnknown as { results: Memory[] }).results;
        }
      }


      setResults(items);
      setStatus(`Found ${items.length}`);
      if (query !== input) setInput(query);
    } catch (err: unknown) {
      setResults([]);
      setStatus(`Search error: ${toErrorMessage(err)}`);
    }
  }


  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.brand}>Ezra</div>
        <a href="/pair" style={styles.pill}>Link this device</a>
      </header>


      <div style={{ ...styles.grid, gridTemplateColumns: isWide ? "1fr 1fr" : "1fr" }}>
        {/* Chat */}
        <section style={styles.panel}>
          <h2 style={styles.h2}>Chat</h2>
          <div ref={listRef} style={styles.chatList} onScroll={onChatScroll}>
            {messages.length === 0 ? (
              <div style={styles.empty}>No messages yet. Say hi 👋</div>
            ) : (
              messages.map((m, i) => (
                <div key={i} style={{ ...styles.row, justifyContent: m.role === "you" ? "flex-end" : "flex-start" }}>
                  <div
                    style={{
                      ...styles.bubble,
                      ...(m.role === "you" ? styles.youBubble : styles.ezraBubble),
                    }}
                  >
                    <div style={styles.bubbleText}>{m.text}</div>
                  </div>
                  {m.role === "ezra" && (
                    <button onClick={() => playTts(m.text)} style={styles.iconBtn} title="Play audio">
                      🔊
                    </button>
                  )}
                </div>
              ))
            )}
            {busy && (
              <div style={{ ...styles.row, justifyContent: "flex-start" }}>
                <div style={{ ...styles.bubble, ...styles.ezraBubble, opacity: 0.85 }}>{busy}</div>
              </div>
            )}
            {!atBottom && (
              <button
                type="button"
                onClick={() => scrollToBottom("smooth")}
                style={styles.scrollPill}
              >
                Scroll to bottom
              </button>
            )}
            <div style={{ height: 12 }} />
          </div>


          <form onSubmit={onSend} style={styles.inputBar}>
            <textarea
              rows={3}
              value={input}
              onChange={onInputChange}
              placeholder="Type a message"
              aria-label="Message"
              style={styles.input}
            />
            <div style={styles.buttonRow}>
              <button type="submit" disabled={!input.trim()} style={styles.btn}>Send</button>
              <button type="button" onClick={handleSave} style={styles.btn}>Save</button>
              {/* Removed duplicate Search button in chat controls */}
              <button type="button" onClick={handleReset} style={styles.btn}>Reset</button>
            </div>
          </form>
          <div style={styles.subtle}>{busy && busy}</div>
        </section>


        {/* Search */}
        <section style={styles.panel}>
          <h2 style={styles.h2}>Search Memara</h2>
          <form onSubmit={onSearch} style={styles.rowWrap}>
            <input
              value={q}
              onChange={onSearchInputChange}
              style={styles.input}
            />
            <button type="submit" style={styles.btn}>Search</button>
          </form>
          <small style={styles.note}>
            Calls <code>/api/ezra/notice</code> then <code>/api/memory/search</code>. “Save” uses <code>/api/memory/save</code>.
          </small>
          <div style={styles.status}>{status}</div>


          <ul style={styles.results}>
            {results.map((m) => (
              <li key={m.id} style={styles.resultCard}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{m.title || "(untitled)"}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                {!!m.tags?.length && <div style={styles.tags}>tags: {m.tags.join(", ")}</div>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Footer: Notifications */}
      <footer style={styles.footer}>
        <div style={styles.footerInner}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Link href="/diary" style={styles.btn}>Diary</Link>
            <Link href="/poetry" style={styles.btn}>Poetry</Link>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <AskNotify inline />
            <SubscribePush inline />
          </div>
        </div>
      </footer>
    </main>
  );
}


const styles: Record<string, React.CSSProperties> = {
  shell: {
    height: "100dvh",
    background: "linear-gradient(180deg, #2b1055 0%, #ff7e5f 45%, #feb47b 100%)",
    color: "#f5f7fb",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    display: "grid",
    gridTemplateRows: "auto 1fr auto",
    overflowX: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(11,11,16,0.85)",
    backdropFilter: "blur(6px)",
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  brand: {
    fontWeight: 500,
    letterSpacing: 0.5,
    fontSize: 24,
    fontFamily: '"Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive',
  },
  pill: {
    padding: "6px 10px",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 999,
    fontSize: 12,
    textDecoration: "none",
    color: "#f5f7fb",
    whiteSpace: "nowrap",
  },
  grid: {
    display: "grid",
    gap: 12,
    padding: 12,
    maxWidth: 1100,
    width: "100%",
    margin: "0 auto",
    boxSizing: "border-box",
  },
  footer: {
    marginTop: 8,
  },
  footerInner: {
    maxWidth: 1100,
    margin: "0 auto",
    width: "100%",
    padding: 12,
    boxSizing: "border-box",
    display: "flex",
    justifyContent: "space-between",
  },
  panel: {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 12,
    background: "rgba(255,255,255,0.03)",
    minWidth: 0,
    overflow: "visible",
    display: "grid",
    gridTemplateRows: "auto 1fr auto auto",
    gap: 8,
  },
  h2: {
    margin: 0,
    fontSize: 16,
    opacity: 0.9,
    fontFamily: '"Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive',
  },
  chatList: {
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    overflowX: "hidden",
    borderRadius: 10,
    background: "rgba(255,255,255,0.03)",
    padding: 12,
    minHeight: 220,
    maxWidth: "100%",
    boxSizing: "border-box",
  },
  row: { display: "flex", width: "100%", maxWidth: "100%", margin: "8px 0" },
  bubble: {
    maxWidth: "calc(100% - 24px)",
    borderRadius: 14,
    padding: "10px 12px",
    border: "1px solid rgba(255,255,255,0.10)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
    lineHeight: 1.4,
    marginInline: 4,
  },
  bubbleText: {
    margin: 0,
    fontFamily: "inherit",
    fontSize: 15,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
  },
  youBubble: {
    background: "#ff7e5f",
  },
  ezraBubble: {
    background: "#2b1055",
  },
  inputBar: {
    display: "flex",
    gap: 8,
    position: "sticky",
    bottom: 0,
    background: "rgba(11,11,16,0.85)",
    backdropFilter: "blur(6px)",
    borderRadius: 12,
    padding: 8,
    flexWrap: "wrap",
    flexDirection: "column",
  },
  input: {
    flex: 1,
    appearance: "none",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "#2b1055",
    color: "#f5f7fb",
    padding: "12px 14px",
    outline: "none",
    fontSize: 16,
    minWidth: 0,
    minHeight: 48,
    width: "100%",
    resize: "vertical",
  },
  buttonRow: { display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" },
  btn: {
    border: "1px solid rgba(255,255,255,0.2)",
    background: "transparent",
    color: "#f5f7fb",
    borderRadius: 999,
    padding: "10px 14px",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  },
  iconBtn: {
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.06)",
    color: "#f5f7fb",
    borderRadius: 999,
    padding: "6px 8px",
    fontSize: 12,
    cursor: "pointer",
    alignSelf: "center",
    marginInlineStart: 4,
  },
  scrollPill: {
    position: "sticky",
    bottom: 8,
    alignSelf: "flex-end",
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(0,0,0,0.4)",
    color: "#f5f7fb",
    borderRadius: 999,
    padding: "8px 12px",
    fontSize: 12,
    cursor: "pointer",
    backdropFilter: "blur(6px)",
    marginTop: 8,
  },
  subtle: { color: "rgba(255,255,255,0.6)", minHeight: 20 },
  rowWrap: { display: "flex", gap: 8 },
  note: { opacity: 0.7 },
  status: { color: "rgba(255,255,255,0.7)", margin: "6px 0" },
  results: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "grid",
    gap: 10,
    maxHeight: 280,
    overflow: "auto",
  },
  resultCard: {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: 10,
    background: "rgba(255,255,255,0.02)",
    color: "#f5f7fb",
  },
  tags: { opacity: 0.7, fontSize: 12, marginTop: 6 },
  empty: { height: "100%", display: "grid", placeItems: "center", opacity: 0.6 },
};
