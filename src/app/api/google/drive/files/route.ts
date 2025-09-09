// src/app/api/google/drive/files/route.ts
import { NextResponse } from "next/server";
import { getOrCreateSession } from "@/lib/session";
import { getValidTokens } from "@/lib/google-oauth";

export const runtime = "nodejs";

function makeMultipartBody(meta: Record<string, unknown>, content: string | Uint8Array, mimeType: string) {
  const boundary = "ezra-boundary-" + Math.random().toString(36).slice(2);
  const dash = "--" + boundary;
  const parts: (string | Uint8Array)[] = [];
  parts.push(dash + "\r\n");
  parts.push('Content-Type: application/json; charset="UTF-8"\r\n\r\n');
  parts.push(JSON.stringify(meta) + "\r\n");
  parts.push(dash + "\r\n");
  parts.push(`Content-Type: ${mimeType}\r\n\r\n`);
  parts.push(typeof content === 'string' ? content : content);
  parts.push("\r\n" + dash + "--\r\n");
  const bodyStr = parts.map((p) => (typeof p === 'string' ? p : Buffer.from(p))).join("");
  return { body: bodyStr, boundary };
}

export async function POST(req: Request) {
  try {
    const sid = await getOrCreateSession();
    const tok = await getValidTokens(sid);
    if (!tok?.access_token) return NextResponse.json({ error: "not_linked" }, { status: 401 });

    const bodyUnknown: unknown = await req.json().catch(() => ({}));
    const b = (bodyUnknown || {}) as Record<string, unknown>;
    const name = typeof b.name === "string" && b.name.trim() ? b.name.trim() : `note-${Date.now()}.txt`;
    const content = typeof b.content === "string" ? b.content : "";
    const mimeType = (typeof b.mimeType === "string" && b.mimeType) || "text/plain";
    const parents = Array.isArray(b.parents) ? (b.parents as string[]) : undefined; // optional folder ids

    const meta: Record<string, unknown> = { name };
    if (parents?.length) meta.parents = parents;

    const { body, boundary } = makeMultipartBody(meta, content, mimeType);

    const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok.access_token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    const txt = await r.text();
    if (!r.ok) return NextResponse.json({ error: `drive ${r.status}`, body: txt.slice(0, 500) }, { status: 502 });
    return new Response(txt, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

