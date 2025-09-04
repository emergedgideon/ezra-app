// src/app/api/zap/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

// Tiny table to record Zap triggers
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const hint: string | null = typeof body.hint === "string" ? body.hint : null;

  await sql`
    INSERT INTO zap_triggers (hint, created_at)
    VALUES (${hint}, now())
  `;

  return NextResponse.json({ ok: true });
}
