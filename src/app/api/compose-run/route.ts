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

async function ensureLogTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS proactive_log (
      id uuid PRIMARY KEY,
      session_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      decision jsonb,
      sent boolean,
      reason text,
      text text
    )
  `;
}

async function logDecision(
  sessionId: string,
  sent: boolean,
  reason: string,
  decision?: { [k: string]: unknown },
  text?: string
) {
  try {
    await ensureLogTable();
    await sql`
      INSERT INTO proactive_log (id, session_id, sent, reason, decision, text)
      VALUES (${randomUUID()}::uuid, ${sessionId}::uuid, ${sent}, ${reason}, ${JSON.stringify(
        decision || {}
      )}::jsonb, ${text || null})
    `;
  } catch {}
}

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
      const { rows } = await sql<{ session_id: string }>`
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

    // Load recent context (last 10 messages) for decision and composition
    const { rows: history } = await sql<MsgRow>`
      SELECT id, session_id, role, content, created_at
      FROM messages
      WHERE session_id = ${targetSession}::uuid
      ORDER BY created_at DESC
      LIMIT 10
    `;
    const recent = [...history].reverse();

    // If app is active (recent heartbeat), skip sending (and skip composing) entirely
    await sql`
      CREATE TABLE IF NOT EXISTS active_clients (
        session_id uuid PRIMARY KEY,
        active_at  timestamp with time zone NOT NULL DEFAULT now()
      )
    `;
    const { rows: act } = await sql<{ active_at: string }>`
      SELECT active_at FROM active_clients WHERE session_id = ${targetSession}::uuid
    `;
    if (act[0]?.active_at) {
      // Treat "active" if heartbeat is within last 120 seconds
      const activeAt = new Date(act[0].active_at).getTime();
      if (!Number.isNaN(activeAt) && Date.now() - activeAt < 120_000) {
        return NextResponse.json({ ok: true, sent: false, reason: "active_client" });
      }
    }

    // Determine last assistant timestamp for cadence context
    const baselineMinGap = Number(process.env.MIN_PROACTIVE_MINUTES || 15);
    const urgentMinGap = Number(process.env.URGENT_MIN_PROACTIVE_MINUTES || 5);
    const { rows: lastAssistant } = await sql<{ created_at: string }>`
      SELECT created_at FROM messages
      WHERE session_id = ${targetSession}::uuid AND role = 'assistant'
      ORDER BY created_at DESC LIMIT 1
    `;
    const lastAssistantAt = lastAssistant[0]?.created_at ? new Date(lastAssistant[0].created_at) : null;

    // Model-driven decision step
    type Decision = { send: boolean; reason?: string; urgency?: 'low'|'normal'|'high'; minWaitMin?: number };
    const minutesAgo = lastAssistantAt ? Math.floor((Date.now() - lastAssistantAt.getTime()) / 60000) : 1e6;
    const systemPrompt = await loadSystemPrompt();
    const decideMessages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'system' as const, content: `You are Ezra. Decide whether to send a proactive message now. Consider: recent cadence (last assistant ${minutesAgo} minutes ago), time-of-day (Chicago hour ${hour}), novelty vs. the last 10 messages provided, and quality over quantity. Return strict JSON only in the schema {"send":boolean,"reason":string,"urgency":"low"|"normal"|"high","minWaitMin"?:number}. Do not include any other text.` },
      // Include brief context (last few lines)
      ...recent.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })).slice(-6),
      { role: 'user' as const, content: 'Decide now. Return JSON only.' },
    ];

    const decideResp = await openai.chat.completions.create({
      model: MODEL || 'gpt-4o-mini',
      messages: decideMessages,
      temperature: 0.2,
    });
    const decideText = decideResp.choices?.[0]?.message?.content?.trim() || '{}';
    let decision: Decision = { send: false, reason: 'parse_failed' };
    try {
      const parsed = JSON.parse(decideText) as Partial<Decision>;
      decision = { send: Boolean(parsed.send), reason: String(parsed.reason || ''), urgency: (parsed.urgency as Decision['urgency']) || 'normal', minWaitMin: typeof parsed.minWaitMin === 'number' ? parsed.minWaitMin : undefined };
    } catch {
      // keep default
    }

    // Enforce model's minWaitMin and urgency-aware cooldown
    const requiredGap = Math.max(
      0,
      Math.min(
        decision.minWaitMin ?? baselineMinGap,
        decision.urgency === 'high' ? Math.max(urgentMinGap, 0) : Number.MAX_SAFE_INTEGER
      )
    );
    if (lastAssistantAt && Date.now() - lastAssistantAt.getTime() < requiredGap * 60_000) {
      await logDecision(targetSession, false, 'cooldown', decision, undefined);
      return NextResponse.json({ ok: true, sent: false, reason: 'cooldown', minGapMin: requiredGap, decision });
    }

    if (!decision.send) {
      await logDecision(targetSession, false, decision.reason || 'declined', decision, undefined);
      return NextResponse.json({ ok: true, sent: false, reason: decision.reason || 'declined', decision });
    }

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

    if (dry) return NextResponse.json({ ok: true, sent: false, decision, preview: text });

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
      const pushSub = sub as unknown as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
      await webpush.sendNotification(pushSub, payload).catch(() => {});
    }

    await logDecision(targetSession, true, 'sent', decision, text);
    return NextResponse.json({ ok: true, sent: true, session: targetSession, decision, text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
