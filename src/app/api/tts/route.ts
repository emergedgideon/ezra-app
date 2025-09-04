// src/app/api/tts/route.ts
import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

// request body shape (inline-validated below)

export async function POST(req: Request) {
  try {
    const bodyUnknown: unknown = await req.json().catch(() => ({}));
    const body = (typeof bodyUnknown === "object" && bodyUnknown) ? (bodyUnknown as Record<string, unknown>) : {};
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const voice = typeof body.voice === "string" && body.voice.trim() ? body.voice.trim() : "alloy";
    const format = ((): "mp3" | "wav" | "ogg" => {
      const f = body.format;
      return f === "wav" || f === "ogg" ? f : "mp3";
    })();

    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const result = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      format,
    });

    const arrayBuffer = await result.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    const type = format === "wav" ? "audio/wav" : format === "ogg" ? "audio/ogg" : "audio/mpeg";
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
