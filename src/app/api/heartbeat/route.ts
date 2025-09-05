// src/app/api/heartbeat/route.ts
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";

export const runtime = "nodejs";

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS active_clients (
      session_id uuid PRIMARY KEY,
      active_at  timestamp with time zone NOT NULL DEFAULT now()
    )
  `;
}

export async function POST() {
  const sid = await getOrCreateSession();
  try {
    await ensureTable();
    await sql`
      INSERT INTO active_clients (session_id, active_at)
      VALUES (${sid}::uuid, now())
      ON CONFLICT (session_id)
      DO UPDATE SET active_at = EXCLUDED.active_at
    `;
    return NextResponse.json({ ok: true, session: sid });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  const sid = await getOrCreateSession();
  try {
    await ensureTable();
    const { rows } = await sql<{ active_at: string }>`
      SELECT active_at FROM active_clients WHERE session_id = ${sid}::uuid
    `;
    return NextResponse.json({ ok: true, session: sid, active_at: rows[0]?.active_at || null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

