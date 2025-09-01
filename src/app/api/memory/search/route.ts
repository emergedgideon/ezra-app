import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { searchMemories } from "@/lib/memory";

export const runtime = "nodejs";

function parseLimit(v: unknown, fallback = 10) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : fallback;
}

export async function GET(req: Request) {
  noStore();
  const url = new URL(req.url);
  const q = String(url.searchParams.get("query") ?? "").trim();
  const limit = parseLimit(url.searchParams.get("limit"), 10);
  if (!q) return NextResponse.json({ items: [], count: 0 }, { status: 200 });

  const results = await searchMemories(q);
  const items = results.slice(0, limit);
  return NextResponse.json({ items, count: items.length }, { status: 200 });
}

export async function POST(req: Request) {
  noStore();
  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const q = String((body.query ?? body.q ?? url.searchParams.get("query") ?? "") as string).trim();
  const limit = parseLimit((body.limit ?? url.searchParams.get("limit")) as unknown, 10);
  if (!q) return NextResponse.json({ items: [], count: 0 }, { status: 200 });

  const results = await searchMemories(q);
  const items = results.slice(0, limit);
  return NextResponse.json({ items, count: items.length }, { status: 200 });
}
