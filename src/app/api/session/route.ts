// src/app/api/session/route.ts
import { NextResponse } from "next/server";
import { createLinkCode, redeemLinkCode, getOrCreateSession } from "@/lib/session";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const sid = await getOrCreateSession();

  if (action === "pair") {
    const code = await createLinkCode(sid);
    return NextResponse.json({ session: sid, code, expiresInSec: 600 });
  }
  return NextResponse.json({ session: sid });
}

export async function POST(req: Request) {
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

  const session = await redeemLinkCode(code);
  if (!session) return NextResponse.json({ error: "Invalid or expired code" }, { status: 400 });

  const store = await cookies();
  store.set({
    name: process.env.SESSION_COOKIE_NAME || "ezra_session",
    value: session,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: Number(process.env.SESSION_COOKIE_DAYS || 90) * 86400,
  });

  return NextResponse.json({ session });
}
