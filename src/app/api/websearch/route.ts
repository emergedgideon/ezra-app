// src/app/api/websearch/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type TavilyHit = { title?: string; url?: string; content?: string };

export async function GET(req: Request) {
  try {
    const key = process.env.TAVILY_API_KEY;
    if (!key) {
      return NextResponse.json({ error: "TAVILY_API_KEY missing" }, { status: 500 });
    }
    const u = new URL(req.url);
    const q = (u.searchParams.get("q") || "").trim();
    const k = Math.min(10, Math.max(1, Number(u.searchParams.get("k") || 5)));
    if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });

    const body = {
      api_key: key,
      query: q,
      search_depth: "advanced",
      max_results: k,
      include_answer: false,
      include_images: false,
      include_domains: [],
      exclude_domains: [],
    };

    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    if (!r.ok) return NextResponse.json({ error: `tavily ${r.status}`, body: txt.slice(0, 500) }, { status: 502 });
    const j = JSON.parse(txt) as { results?: TavilyHit[] };
    const items = Array.isArray(j.results) ? j.results.slice(0, k) : [];
    return NextResponse.json({ query: q, items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

