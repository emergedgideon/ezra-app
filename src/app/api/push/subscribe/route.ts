// src/app/api/push/subscribe/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { saveSubscription } from "@/lib/subStore";
import { ensurePushConfigured } from "@/lib/push";

export async function POST(req: Request) {
  ensurePushConfigured();
  const body = await req.json().catch(() => null);

  if (!body || typeof body !== "object" || !("endpoint" in body)) {
    return NextResponse.json({ ok: false, error: "Invalid subscription" }, { status: 400 });
  }

  await saveSubscription(body as unknown as { endpoint: string });
  return NextResponse.json({ ok: true });
}
