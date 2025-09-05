// src/app/api/google/gmail/messages/route.ts
import { NextResponse } from "next/server";
import { getOrCreateSession } from "@/lib/session";
import { getValidTokens } from "@/lib/google-oauth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const sid = await getOrCreateSession();
    const tok = await getValidTokens(sid);
    if (!tok?.access_token) return NextResponse.json({ error: "not_linked" }, { status: 401 });

    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    const qp = new URL(req.url).searchParams;
    const maxResults = Math.min(100, Number(qp.get("max") || 10));
    url.searchParams.set("maxResults", String(maxResults));
    const q = (qp.get("q") || "").trim();
    if (q) url.searchParams.set("q", q);

    const r = await fetch(url, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    const txt = await r.text();
    if (!r.ok) return NextResponse.json({ error: `gmail ${r.status}`, body: txt.slice(0, 400) }, { status: 502 });
    return new Response(txt, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

