// src/app/api/v1/entries/route.ts
import { NextResponse } from "next/server";
import { createEntry, listEntries } from "@/lib/entries";

export const runtime = "nodejs";

type CreateBody = {
  type?: "diary" | "poetry" | "clipboard" | "none";
  content?: string;
  title?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    const limitStr = url.searchParams.get("limit");
    const limit = limitStr ? Number(limitStr) : undefined;

    const validType =
      type === "diary" || type === "poetry" || type === "clipboard" ? (type as "diary" | "poetry" | "clipboard") : undefined;

    const items = await listEntries({ type: validType, limit });
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: { code: "server_error", message: msg } }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body: CreateBody = (await req.json().catch(() => ({}))) as CreateBody;
    const type = body.type || "diary"; // default to diary if omitted

    if (type === "none") {
      return NextResponse.json({ ok: true, created: false, reason: "none_selected" });
    }

    if (type !== "diary" && type !== "poetry" && type !== "clipboard") {
      return NextResponse.json({ ok: false, error: { code: "bad_type", message: "type must be diary|poetry|clipboard|none" } }, { status: 400 });
    }

    const content = typeof body.content === "string" ? body.content : "";
    if (!content.trim()) {
      return NextResponse.json({ ok: false, error: { code: "content_required", message: "content is required" } }, { status: 400 });
    }

    const entry = await createEntry({ type, content, title: body.title, tags: body.tags, metadata: body.metadata });
    return NextResponse.json({ ok: true, created: true, entry });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: { code: "server_error", message: msg } }, { status: 500 });
  }
}

