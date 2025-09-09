// src/app/api/transcribe/route.ts
import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (process.env.AI_ENABLED !== 'true') {
    return NextResponse.json(
      { ok: false, error: { code: 'disabled', message: 'Transcription is disabled' } },
      { status: 410 }
    );
  }
  try {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob)) {
      return NextResponse.json({ error: "audio file missing" }, { status: 400 });
    }

    const filename = (form.get("filename") as string) || "audio.webm";
    const file = new File([audio], filename, { type: audio.type || "audio/webm" });

    const resp = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-transcribe",
      // language: "en", // optional
    });

    const text = (resp as { text?: string }).text || "";
    return NextResponse.json({ text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
