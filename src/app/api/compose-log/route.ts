// src/app/api/compose-log/route.ts
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";

export const runtime = "nodejs";

type LogRow = {
  id: string;
  created_at: string;
  sent: boolean | null;
  reason: string | null;
  decision: Record<string, unknown> | null;
  text: string | null;
};

async function ensureLogTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS proactive_log (
      id uuid PRIMARY KEY,
      session_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      decision jsonb,
      sent boolean,
      reason text,
      text text
    )
  `;
}

export async function GET(req: Request) {
  try {
    const sid = await getOrCreateSession();
    await ensureLogTable();

    const u = new URL(req.url);
    const n = Math.min(50, Math.max(1, Number(u.searchParams.get("limit") || 10)));

    const { rows } = await sql<LogRow>`
      SELECT id, created_at, sent, reason, decision, text
      FROM proactive_log
      WHERE session_id = ${sid}::uuid
      ORDER BY created_at DESC
      LIMIT ${n}
    `;

    const items = rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      sent: Boolean(r.sent),
      reason: r.reason || null,
      decision: r.decision || {},
      preview: (r.text || "").slice(0, 280),
    }));

    return NextResponse.json({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

