// src/lib/register-sw.ts
export function registerServiceWorker() {
  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          console.log("✅ Service worker registered:", reg.scope);
        })
        .catch((err) => {
          console.error("❌ Service worker registration failed:", err);
        });
    });
  }
}
