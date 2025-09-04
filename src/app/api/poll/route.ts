// src/app/api/poll/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { ensurePushConfigured } from "@/lib/push"; // change to "../../../lib/push" if not using "@"
import { readSubscription } from "@/lib/subStore";
import webpush from "web-push";

function parseLastLine(csvText: string): string | null {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) return null; // only header present
  const last = lines[lines.length - 1];
  const firstCell = last.split(",")[0]?.trim() ?? "";
  return firstCell || null;
}

// The shape we store from the browser's PushSubscription JSON
type StoredSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  // allow extra fields without using `any`
  [k: string]: unknown;
};

export async function GET() {
  try {
    const url = process.env.GOOGLE_SHEET_CSV_URL;
    if (!url) {
      return NextResponse.json(
        { ok: false, error: "GOOGLE_SHEET_CSV_URL missing" },
        { status: 500 }
      );
    }

    // 1) Fetch the live CSV
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) {
      const t = await resp.text();
      return NextResponse.json(
        { ok: false, error: `Sheet fetch failed: ${resp.status}`, body: t },
        { status: 502 }
      );
    }
    const csv = await resp.text();
    const hint = parseLastLine(csv);
    if (!hint) return NextResponse.json({ ok: true, skipped: "no data rows" });

    // 2) Skip duplicates (compare to last stored hint)
    const { rows } = await sql<{ hint: string | null }>`
      SELECT hint FROM zap_triggers ORDER BY id DESC LIMIT 1
    `;
    const lastHint = rows[0]?.hint ?? null;
    if (lastHint === hint) {
      return NextResponse.json({ ok: true, skipped: "duplicate" });
    }

    // 3) Record trigger
    await sql`INSERT INTO zap_triggers (hint, created_at) VALUES (${hint}, now())`;

    // 4) Send push with app-side agency
    ensurePushConfigured();
    const sub = (await readSubscription()) as StoredSubscription | null;
    if (!sub) {
      return NextResponse.json(
        { ok: false, error: "No subscription on file" },
        { status: 404 }
      );
    }

    const title = "Ezra";
    const body =
      hint && hint.toLowerCase() !== "trigger"
        ? `Heads up: ${hint}`
        : "Ping ✨ I’ve got something for you.";

    const payload = JSON.stringify({ title, body, data: { url: "/" } });

    await webpush.sendNotification(sub, payload);

    return NextResponse.json({ ok: true, sent: { title, body } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
