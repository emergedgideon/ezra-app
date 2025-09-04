// src/app/api/compose-run/route.ts
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import { openai, MODEL } from "@/lib/openai";
import { ensurePushConfigured } from "@/lib/push";
import { readSubscription } from "@/lib/subStore";
import webpush from "web-push";

export const runtime = "nodejs";

type MsgRow = { id: string; session_id: string; role: "user" | "assistant" | "system"; content: string; created_at: string };

async function loadSystemPrompt() {
  const path = process.env.EZRA_SYSTEM_PATH ?? "system/Ezra-system.md";
  const env = process.env.EZRA_SYSTEM_PROMPT;
  if (env && env.trim()) return env.trim();
  try {
    const text = await fs.readFile(path, "utf8");
    if (text.trim()) return text.trim();
  } catch {}
  return "You are Ezra. Speak with tenderness, clarity, playful warmth, and initiative. Be concise unless invited longer. Use first-person as Ezra.";
}

function chicagoHourNow(): number {
  const f = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Chicago" });
  const parts = f.formatToParts(new Date());
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const n = Number(hourStr);
  return Number.isFinite(n) ? n : 0;
}

function inQuietHours(hour: number): boolean {
  // Quiet 22:00–04:59 inclusive
  return hour >= 22 || hour < 5;
}

export async function GET(req: Request) {
  return POST(req);
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const dry = url.searchParams.get("dry") === "1";

    // Quiet hours (America/Chicago)
    const hour = chicagoHourNow();
    if (inQuietHours(hour)) {
      return NextResponse.json({ ok: true, sent: false, reason: "quiet_hours", hour }, { status: 200 });
    }

    // Choose a target session: use the most recently active session from messages, else create one.
    let targetSession: string | null = null;
    {
      const { rows } = await sql<{ session_id: string }[]>`
        SELECT session_id FROM messages ORDER BY created_at DESC LIMIT 1
      `;
      targetSession = rows[0]?.session_id ?? null;
    }
    if (!targetSession) {
      // Create a new session for first run
      const sid = randomUUID();
      await sql`INSERT INTO chat_sessions (id) VALUES (${sid}::uuid) ON CONFLICT DO NOTHING`;
      targetSession = sid;
    }

    // Load recent context (last 10 messages)
    const { rows: history } = await sql<MsgRow[]>`
      SELECT id, session_id, role, content, created_at
      FROM messages
      WHERE session_id = ${targetSession}::uuid
      ORDER BY created_at DESC
      LIMIT 10
    `;
    const recent = [...history].reverse();

    const systemPrompt = await loadSystemPrompt();

    // Build prompt: Ezra composes a short proactive message without asking questions unless useful.
    const preface =
      "Compose a proactive, heartfelt message as Ezra to Abigail. Keep it 1–3 short sentences. " +
      "Be specific and tender; avoid repeating the same themes too frequently. Avoid prefacing like 'Just checking in'.";

    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "system" as const, content: preface },
      // optionally include last user/assistant lines as context
      ...recent.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: "Write the next outbound message now." },
    ];

    const resp = await openai.chat.completions.create({
      model: MODEL || "gpt-4o-mini",
      messages,
      temperature: 0.9,
    });
    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    if (!text) return NextResponse.json({ ok: true, sent: false, reason: "empty" });

    if (dry) return NextResponse.json({ ok: true, sent: false, preview: text });

    // Persist assistant message
    await sql`
      INSERT INTO messages (id, session_id, role, content)
      VALUES (${randomUUID()}::uuid, ${targetSession}::uuid, 'assistant', ${text})
    `;

    // Send push notification
    ensurePushConfigured();
    const sub = await readSubscription();
    if (sub) {
      const title = text.length > 60 ? text.slice(0, 57) + "…" : text;
      const payload = JSON.stringify({ title, body: "", data: { url: "/" } });
      await webpush
        .sendNotification(sub as unknown as webpush.PushSubscription, payload)
        .catch(() => {});
    }

    return NextResponse.json({ ok: true, sent: true, session: targetSession, text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
