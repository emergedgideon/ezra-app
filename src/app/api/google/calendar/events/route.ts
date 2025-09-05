// src/app/api/google/calendar/events/route.ts
import { NextResponse } from "next/server";
import { getOrCreateSession } from "@/lib/session";
import { getValidTokens } from "@/lib/google-oauth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const sid = await getOrCreateSession();
    const tok = await getValidTokens(sid);
    if (!tok?.access_token) return NextResponse.json({ error: "not_linked" }, { status: 401 });

    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("maxResults", String(Math.min(50, Number(new URL(req.url).searchParams.get("max") || 10))));
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("timeMin", new Date().toISOString());

    const r = await fetch(url, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    const txt = await r.text();
    if (!r.ok) return NextResponse.json({ error: `calendar ${r.status}`, body: txt.slice(0, 400) }, { status: 502 });
    return new Response(txt, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

