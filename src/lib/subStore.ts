// src/lib/subStore.ts
import { sql } from "@vercel/postgres";

export type PushSubscriptionRecord = {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
  [k: string]: unknown;
};

// Save or update a subscription (by endpoint)
export async function saveSubscription(sub: PushSubscriptionRecord) {
  await sql`
    INSERT INTO push_subscriptions (endpoint, subscription)
    VALUES (${sub.endpoint}, ${JSON.stringify(sub)}::jsonb)
    ON CONFLICT (endpoint)
    DO UPDATE SET subscription = EXCLUDED.subscription, created_at = now();
  `;
}

// Read the most recent subscription (single-user flow)
export async function readSubscription(): Promise<PushSubscriptionRecord | null> {
  const { rows } = await sql`
    SELECT subscription
    FROM push_subscriptions
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return (rows[0]?.subscription as PushSubscriptionRecord) ?? null;
}

