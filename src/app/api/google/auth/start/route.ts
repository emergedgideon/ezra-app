// src/app/api/google/auth/start/route.ts
import { NextResponse } from "next/server";
import { getOrCreateSession } from "@/lib/session";
import { getAuthUrl } from "@/lib/google-oauth";

export const runtime = "nodejs";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
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

