// src/app/api/google/drive/search/route.ts
import { NextResponse } from "next/server";
import { getOrCreateSession } from "@/lib/session";
import { getValidTokens } from "@/lib/google-oauth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const sid = await getOrCreateSession();
    const tok = await getValidTokens(sid);
    if (!tok?.access_token) return NextResponse.json({ error: "not_linked" }, { status: 401 });

    const qp = new URL(req.url).searchParams;
    const q = (qp.get("q") || "").trim();
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    if (q) url.searchParams.set("q", q); // e.g., name contains 'notes'
    url.searchParams.set("pageSize", String(Math.min(100, Number(qp.get("max") || 10))));
    url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,owners/displayName,webViewLink)");

    const r = await fetch(url, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    const txt = await r.text();
    if (!r.ok) return NextResponse.json({ error: `drive ${r.status}`, body: txt.slice(0, 500) }, { status: 502 });
    return new Response(txt, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

