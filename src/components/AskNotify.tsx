"use client";

import { useEffect, useState } from "react";

type Perm = "default" | "denied" | "granted" | "unsupported";

export default function AskNotify() {
  const [mounted, setMounted] = useState(false);
  const hasNotif = typeof window !== "undefined" && "Notification" in window;

  // Don’t render on the server
  useEffect(() => setMounted(true), []);

  const [status, setStatus] = useState<Perm>(() =>
    hasNotif ? window.Notification.permission : "unsupported"
  );

  useEffect(() => {
    if (hasNotif) setStatus(window.Notification.permission);
  }, [hasNotif]);

  async function requestAndTest() {
    if (!("serviceWorker" in navigator)) return alert("Service workers not supported.");
    if (!hasNotif) return alert("Notifications not supported.");

    const perm = await window.Notification.requestPermission();
    setStatus(perm as Perm);
    if (perm !== "granted") return;

    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("Ezra test", {
      body: "Notifications are live.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "ezra-test",
    });
  }

  if (!mounted) return null; // prevents hydration mismatch

  return (
    <div style={{ position: "fixed", bottom: 12, right: 12, zIndex: 9999 }}>
      <button
        onClick={requestAndTest}
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px solid #333",
          background: "#111",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        Enable Notifications ({status})
      </button>
    </div>
  );
}
