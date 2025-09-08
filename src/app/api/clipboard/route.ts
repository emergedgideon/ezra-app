// src/app/api/clipboard/route.ts
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

type Row = { id: string; content: string; created_at: string };

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS clipboard_entries (
      id uuid PRIMARY KEY,
      session_id uuid NOT NULL,
      content text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function GET() {
  try {
    const sid = await getOrCreateSession();
    await ensureTable();
    const { rows } = await sql<Row>`
      SELECT id, content, created_at
      FROM clipboard_entries
      WHERE session_id = ${sid}::uuid
      ORDER BY created_at DESC
    `;
    return NextResponse.json({ items: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const sid = await getOrCreateSession();
    await ensureTable();
    const bodyUnknown: unknown = await req.json().catch(() => ({}));
    const content = (typeof (bodyUnknown as Record<string, unknown>).content === "string"
      ? (bodyUnknown as Record<string, string>).content
      : "").trim();
    if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });
    const id = randomUUID();
    await sql`
      INSERT INTO clipboard_entries (id, session_id, content)
      VALUES (${id}::uuid, ${sid}::uuid, ${content})
    `;
    return NextResponse.json({ id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

