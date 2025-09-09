// src/app/api/v1/entries/[id]/route.ts
import { NextResponse } from "next/server";
import { getEntryById } from "@/lib/entries";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await ctx.params;
    const id = String(rawId || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: { code: "bad_id", message: "id is required" } }, { status: 400 });
    const entry = await getEntryById(id);
    if (!entry) return NextResponse.json({ ok: false, error: { code: "not_found", message: "entry not found" } }, { status: 404 });
    return NextResponse.json({ ok: true, entry });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: { code: "server_error", message: msg } }, { status: 500 });
  }
}
