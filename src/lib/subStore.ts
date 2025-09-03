// src/lib/subStore.ts
import { sql } from "@vercel/postgres";

type Sub = {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
  [k: string]: any;
};

// Save or update a subscription (by endpoint)
export async function saveSubscription(sub: Sub) {
  await sql`
    INSERT INTO push_subscriptions (endpoint, subscription)
    VALUES (${sub.endpoint}, ${JSON.stringify(sub)}::jsonb)
    ON CONFLICT (endpoint)
    DO UPDATE SET subscription = EXCLUDED.subscription, created_at = now();
  `;
}

