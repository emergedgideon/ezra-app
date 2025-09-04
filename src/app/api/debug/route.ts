// src/app/api/debug/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

export async function GET() {
  const subRow = await sql<{ subscription: unknown }>`
    SELECT subscription
    FROM push_subscriptions
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const trigRow = await sql<{ hint: string | null }>`
    SELECT hint
    FROM zap_triggers
    ORDER BY id DESC
    LIMIT 1
  `;

  return NextResponse.json({
    hasSubscription: Boolean(subRow.rows[0]?.subscription),
    lastTrigger: trigRow.rows[0]?.hint ?? null,
  });
}

