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
    const format = ((): "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm" => {
      const f = body.format;
      return f === "wav" || f === "opus" || f === "aac" || f === "flac" || f === "pcm" ? f : "mp3";
    })();

    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const result = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      response_format: format,
    });

    const arrayBuffer = await result.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    const type =
      format === "mp3"
        ? "audio/mpeg"
        : format === "wav"
        ? "audio/wav"
        : format === "opus"
        ? "audio/ogg; codecs=opus"
        : format === "aac"
        ? "audio/aac"
        : format === "flac"
        ? "audio/flac"
        : "application/octet-stream"; // pcm
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
