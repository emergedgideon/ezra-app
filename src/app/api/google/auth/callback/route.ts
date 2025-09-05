// src/app/api/google/auth/callback/route.ts
import { NextResponse } from "next/server";
import { getOrCreateSession } from "@/lib/session";
import { exchangeCodeForTokens, saveGoogleTokens } from "@/lib/google-oauth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const sid = await getOrCreateSession();
    const u = new URL(req.url);
    const code = u.searchParams.get("code");
    if (!code) return NextResponse.json({ error: "code missing" }, { status: 400 });

    const tokens = await exchangeCodeForTokens(code);
    await saveGoogleTokens(sid, tokens);

    // redirect home with a small hint param
    const base = (process.env.NEXT_PUBLIC_BASE_URL || "/").replace(/\/$/, "");
    const dest = base ? `${base}/?google=ok` : "/";
    return NextResponse.redirect(dest);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

