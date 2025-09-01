import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

export const runtime = "nodejs";

export async function POST(req: Request) {
  noStore();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const type = String(body?.type ?? "");
  const query = String(body?.query ?? "");
  const extra = body?.extra ?? null;

  console.log("[EZRA NOTICE]", { type, query, extra });
  return NextResponse.json({ ok: true }, { status: 200 });
}
