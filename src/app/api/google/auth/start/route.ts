// src/app/api/google/auth/start/route.ts
import { NextResponse } from "next/server";
import { getOrCreateSession } from "@/lib/session";
import { getAuthUrl } from "@/lib/google-oauth";

export const runtime = "nodejs";

// Full-access scopes (requires re-consent):
// - Gmail: full access via https://mail.google.com/
// - Drive: full access via https://www.googleapis.com/auth/drive
// - Calendar: full access via https://www.googleapis.com/auth/calendar
const SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
];

export async function GET() {
  try {
    const sid = await getOrCreateSession();
    const url = getAuthUrl(`sid:${sid}`, SCOPES);
    return NextResponse.redirect(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
