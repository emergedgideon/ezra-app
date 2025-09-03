// src/components/SwRegister.tsx
"use client";

import { useEffect } from "react";

export default function SwRegister() {
  useEffect(() => {
    (async () => {
      try {
        if (!("serviceWorker" in navigator)) {
          console.warn("[SW] not supported in this browser");
          return;
        }
        // Unregister any old SWs on this origin (handy during dev)
        const regs = await navigator.serviceWorker.getRegistrations();
        regs.forEach(r => console.log("[SW] existing:", r.scope));
        // Try to register immediately (no window.load)
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        console.log("[SW] registered:", reg.scope);
        const ready = await navigator.serviceWorker.ready;
        console.log("[SW] ready:", ready.scope);
      } catch (e) {
        console.error("[SW] registration failed:", e);
      }
    })();
  }, []);

  return null;
}
