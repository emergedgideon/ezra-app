// src/lib/session.ts
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { sql } from "@/lib/db";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "ezra_session";
const COOKIE_DAYS = Number(process.env.SESSION_COOKIE_DAYS || 90);

export async function getOrCreateSession(): Promise<string> {
  const store = await cookies();
  let sid = store.get(COOKIE_NAME)?.value;

  if (sid) return sid;

  sid = randomUUID();

  // ensure row exists
  await sql`INSERT INTO chat_sessions (id) VALUES (${sid}::uuid) ON CONFLICT DO NOTHING`;

  // set cookie
  store.set({
    name: COOKIE_NAME,
    value: String(sid),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_DAYS * 24 * 60 * 60,
  });

  return sid;
}

export async function requireSession(): Promise<string> {
  const store = await cookies();
  const sid = store.get(COOKIE_NAME)?.value;
  if (!sid) return getOrCreateSession();
  return sid;
}

function random6(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function createLinkCode(sessionId: string): Promise<string> {
  const code = random6();
  const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  await sql`
    INSERT INTO session_links (code, session_id, expires_at)
    VALUES (${code}, ${sessionId}::uuid, ${expires.toISOString()})
  `;
  return code;
}

export async function redeemLinkCode(code: string): Promise<string | null> {
  const { rows } = await sql<{ session_id: string }>`
    SELECT session_id
    FROM session_links
    WHERE code = ${code} AND expires_at > NOW()
    LIMIT 1
  `;
  if (!rows.length) return null;

  await sql`DELETE FROM session_links WHERE code = ${code}`;
  return rows[0].session_id;
}
