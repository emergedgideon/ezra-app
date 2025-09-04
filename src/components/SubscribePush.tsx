// src/components/SubscribePush.tsx
"use client";

import { useEffect, useState } from "react";
import { urlBase64ToUint8Array } from "../lib/vapid"; // adjust to "@/lib/vapid" if you use an alias

type Status = "idle" | "subscribing" | "subscribed" | "error";

export default function SubscribePush({ inline = false }: { inline?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [step, setStep] = useState<string>("");

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  function withTimeout<T>(p: Promise<T>, label: string, ms = 8000) {
    return Promise.race<T>([
      p,
      new Promise<T>((_, rej) =>
        setTimeout(() => rej(new Error(`Timed out waiting for ${label}`)), ms)
      ),
    ]);
  }

  async function subscribe() {
    try {
      setStatus("subscribing");
      setStep("checking browser features");

      if (!("serviceWorker" in navigator)) {
        throw new Error("Service workers not supported");
      }
      if (!("Notification" in window)) {
        throw new Error("Notifications not supported");
      }

      // Ask permission if not granted
      setStep(`notification permission: ${Notification.permission}`);
      if (Notification.permission !== "granted") {
        const perm = await Notification.requestPermission();
        setStep(`notification permission result: ${perm}`);
        if (perm !== "granted") {
          throw new Error(`Permission was ${perm}`);
        }
      }

      // Ensure SW is ready
      setStep("waiting for service worker ready");
      const reg = await withTimeout(navigator.serviceWorker.ready, "service worker ready");
      console.log("[subscribe] sw ready:", reg.scope);

      // Get public key
      setStep("fetching /api/push/public-key");
      const pkRes = await withTimeout(fetch("/api/push/public-key"), "public-key fetch");
      if (!pkRes.ok) {
        const t = await pkRes.text();
        throw new Error(`public-key failed: ${pkRes.status} ${t}`);
      }
      const { publicKey } = await pkRes.json();
      if (!publicKey || typeof publicKey !== "string") {
        throw new Error("public key missing/invalid");
      }
      console.log("[subscribe] got public key (len)", publicKey.length);

      // Reuse existing subscription if present
      setStep("checking existing subscription");
      const existing = await reg.pushManager.getSubscription();

      // Create subscription
      setStep(existing ? "reusing subscription" : "creating subscription");
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      console.log("[subscribe] subscription ok:", !!sub);

      // Save to server
      setStep("saving subscription to server");
      const saveRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (!saveRes.ok) {
        const t = await saveRes.text();
        throw new Error(`subscribe endpoint failed: ${saveRes.status} ${t}`);
      }

      setStatus("subscribed");
      setStep("✅ subscribed — you can send a test push");
      alert("✅ Subscribed to push.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[subscribe] error:", e);
      setStatus("error");
      setStep(`❌ ${msg}`);
      alert(`Subscription failed: ${msg}`);
    }
  }

  async function sendTest() {
    try {
      setStep("sending test push");
      const res = await fetch("/api/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Ezra (test)",
          body: "Hello from your server.",
        }),
      });
      const text = await res.text();
      console.log("[sendTest] status:", res.status, "body:", text);
      if (!res.ok) {
        setStep(`send failed: ${res.status}`);
        alert(`Send failed: ${res.status}\n${text}`);
        return;
      }
      setStep("✅ server accepted push — check notifications");
      alert("✅ Server accepted push. Check for a notification.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[sendTest] network error:", e);
      setStep(`❌ network error: ${msg}`);
      alert(`Network error: ${msg}`);
    }
  }

  const wrapperStyle: React.CSSProperties = inline
    ? { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }
    : { position: "fixed", bottom: 56, right: 12, zIndex: 9999, display: "flex", gap: 8, alignItems: "center" };

  return (
    <div style={wrapperStyle}>
      <button
        onClick={subscribe}
        disabled={status === "subscribing"}
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px solid #333",
          background: "#111",
          color: "#fff",
          cursor: status === "subscribing" ? "not-allowed" : "pointer",
        }}
      >
        Subscribe to Push ({status})
      </button>
      <button
        onClick={sendTest}
        disabled={status !== "subscribed"}
        title={status !== "subscribed" ? "Subscribe first" : ""}
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px solid #333",
          background: status === "subscribed" ? "#111" : "#222",
          color: "#fff",
          cursor: status === "subscribed" ? "pointer" : "not-allowed",
        }}
      >
        Send Test Push
      </button>
      {step ? <span style={{ fontSize: 12, opacity: 0.8, maxWidth: 280 }}>{step}</span> : null}
    </div>
  );
}
