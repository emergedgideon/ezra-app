import webpush from "web-push";

const PUBLIC = process.env.VAPID_PUBLIC_KEY!;
const PRIVATE = process.env.VAPID_PRIVATE_KEY!;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:you@example.com";

let configured = false;
export function ensurePushConfigured() {
  if (!configured) {
    webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
    configured = true;
  }
  return { PUBLIC };
}
