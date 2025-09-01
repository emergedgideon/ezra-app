import { NextResponse } from "next/server";
import { saveMemory } from "@/lib/memory";
import { unstable_noStore as noStore } from "next/cache";

export const runtime = "nodejs";

export async function POST(req: Request) {
  noStore();

  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const content = String(b?.content ?? "").trim();
    const title = String(b?.title ?? "ui");
    const tags = Array.isArray(b?.tags) ? (b.tags as string[]) : [];

    if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });

    const saved = await saveMemory({ title, content, tags });
    return NextResponse.json(saved, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Save failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
