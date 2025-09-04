// src/app/api/setupZap/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

export async function GET() {
  await sql`
    CREATE TABLE IF NOT EXISTS zap_triggers (
      id SERIAL PRIMARY KEY,
      hint TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;
  return NextResponse.json({ ok: true });
}
