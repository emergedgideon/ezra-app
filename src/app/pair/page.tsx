"use client";

import { useState } from "react";

export default function PairPage() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<string>("");

  async function redeem() {
    setStatus("Redeeming…");
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const json = await res.json();
    setResult(json);
    setStatus("");
  }

  async function sendTest() {
    setStatus("Sending test message…");
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content: "hello from PHONE" }),
    });
    const json = await res.json();
    setResult(json);
    setStatus("");
  }

  async function showMessages() {
    setStatus("Loading messages…");
    const res = await fetch("/api/messages");
    const json = await res.json();
    setResult(json);
    setStatus("");
  }

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Link Device</h1>
      <p>Enter your 6-digit code to join the same chat session.</p>

      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="123456"
        style={{ fontSize: "1.5rem", letterSpacing: "0.5rem" }}
      />
      <button onClick={redeem} style={{ marginLeft: "1rem" }}>
        Redeem
      </button>

      <div style={{ marginTop: "1rem" }}>
        <button onClick={sendTest}>Send “hello from PHONE”</button>
        <button onClick={showMessages} style={{ marginLeft: "0.5rem" }}>
          Show Messages
        </button>
      </div>

      {status && <p style={{ marginTop: "0.5rem" }}>{status}</p>}

      {result && (
        <pre style={{ marginTop: "1rem", whiteSpace: "pre-wrap" }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

