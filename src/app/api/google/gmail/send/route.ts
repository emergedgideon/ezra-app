// src/app/api/google/gmail/send/route.ts
import { NextResponse } from "next/server";
import { getOrCreateSession } from "@/lib/session";
import { getValidTokens } from "@/lib/google-oauth";

export const runtime = "nodejs";

function toBase64Url(input: string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function POST(req: Request) {
  try {
    const sid = await getOrCreateSession();
    const tok = await getValidTokens(sid);
    if (!tok?.access_token) return NextResponse.json({ error: "not_linked" }, { status: 401 });

    const bodyUnknown: unknown = await req.json().catch(() => ({}));
    const b = (bodyUnknown || {}) as Record<string, unknown>;
    const to = typeof b.to === "string" ? b.to : "";
    const subject = typeof b.subject === "string" ? b.subject : "";
    const text = typeof b.text === "string" ? b.text : "";
    const html = typeof b.html === "string" ? b.html : undefined;
    const from = (typeof b.from === "string" && b.from) || undefined; // optional override
    if (!to || (!text && !html)) return NextResponse.json({ error: "to and text/html required" }, { status: 400 });

    const lines: string[] = [];
    if (from) lines.push(`From: ${from}`);
    lines.push(`To: ${to}`);
    if (subject) lines.push(`Subject: ${subject}`);
    if (html) {
      lines.push('MIME-Version: 1.0');
      lines.push('Content-Type: text/html; charset="UTF-8"');
      lines.push("");
      lines.push(html);
    } else {
      lines.push('Content-Type: text/plain; charset="UTF-8"');
      lines.push("");
      lines.push(text);
    }
    const raw = toBase64Url(lines.join("\r\n"));

    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    const txt = await r.text();
    if (!r.ok) return NextResponse.json({ error: `gmail ${r.status}`, body: txt.slice(0, 500) }, { status: 502 });
    return new Response(txt, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

