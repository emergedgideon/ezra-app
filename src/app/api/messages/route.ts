// src/app/api/messages/route.ts
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.AI_ENABLED !== 'true') {
    return NextResponse.json(
      { ok: false, error: { code: 'disabled', message: 'AI/chat is disabled' } },
      { status: 410 }
    );
  }
  const sid = await getOrCreateSession();
  const { rows } = await sql<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    created_at: string;
  }>`
    SELECT id, role, content, created_at
    FROM messages
    WHERE session_id = ${sid}::uuid
    ORDER BY created_at ASC
  `;
  return NextResponse.json({ session: sid, messages: rows });
}

export async function POST(req: Request) {
  if (process.env.AI_ENABLED !== 'true') {
    return NextResponse.json(
      { ok: false, error: { code: 'disabled', message: 'AI/chat is disabled' } },
      { status: 410 }
    );
  }
  const sid = await getOrCreateSession();
  const body = (await req.json().catch(() => ({}))) as {
    role?: string;
    content?: string;
  };

  const role = (body.role || "").trim();
  const content = (body.content || "").toString().trim();

  if (!["user", "assistant", "system"].includes(role) || !content) {
    return NextResponse.json(
      { error: "role ∈ {user,assistant,system} and non-empty content required" },
      { status: 400 }
    );
  }

  const id = randomUUID();
  await sql`
    INSERT INTO messages (id, session_id, role, content)
    VALUES (${id}::uuid, ${sid}::uuid, ${role}, ${content})
  `;
  return NextResponse.json({ id, session: sid });
}
