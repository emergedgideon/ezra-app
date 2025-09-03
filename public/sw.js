self.addEventListener("install", () => {
  console.log("Service Worker installing…");
  self.skipWaiting();
});

self.addEventListener("activate", () => {
  console.log("Service Worker activated.");
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? JSON.parse(event.data.text()) : {}; } catch {}
  const title = payload.title || "Ezra";
  const body = payload.body || "New message";
  const data = payload.data || {};
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data,
      tag: "ezra-push",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = "/"; // change if you want deep links
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      const had = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (had) return had.focus();
      return self.clients.openWindow(url);
    })
  );
});
