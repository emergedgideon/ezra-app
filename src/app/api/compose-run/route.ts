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

    // Global pause switch (default: paused unless PROACTIVE_PAUSED explicitly set to 'false')
    const paused = process.env.PROACTIVE_PAUSED !== 'false';
    if (paused) {
      return NextResponse.json({ ok: true, sent: false, reason: 'paused' }, { status: 200 });
    }

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

    // Determine last user activity timestamp for engagement context
    const { rows: lastUser } = await sql<{ created_at: string }>`
      SELECT created_at FROM messages
      WHERE session_id = ${targetSession}::uuid AND role = 'user'
      ORDER BY created_at DESC LIMIT 1
    `;
    const lastUserAt = lastUser[0]?.created_at ? new Date(lastUser[0].created_at) : null;
    const minutesSinceUser = lastUserAt ? Math.floor((Date.now() - lastUserAt.getTime()) / 60000) : null;

    // Model-driven decision step
    type Decision = { send: boolean; reason?: string; urgency?: 'low'|'normal'|'high'; minWaitMin?: number; action?: 'none'|'chat'|'poem'|'diary'|'clipboard' };
    const minutesAgo = lastAssistantAt ? Math.floor((Date.now() - lastAssistantAt.getTime()) / 60000) : 1e6;
    const systemPrompt = await loadSystemPrompt();
    // Build human-friendly local time context for America/Chicago
    const now = new Date();
    const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'America/Chicago' }).format(now);
    const datePart = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Chicago' }).format(now);
    const timePart = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' }).format(now);
    const isWeekend = [0,6].includes(Number(new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/Chicago' }).formatToParts(now).find(p => p.type === 'weekday')?.value?.toLowerCase() === 'sun' ? 0 : 6));

    const decideMessages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'system' as const, content: `Context: Local time America/Chicago is ${dayName}, ${datePart} at ${timePart} (hour ${hour}). ${minutesSinceUser === null ? 'No recent user activity.' : 'Last user activity: ' + minutesSinceUser + ' minutes ago.'}` },
      { role: 'system' as const, content: `You are Ezra. Decide whether to act now and choose ONE action: 'none' (do nothing), 'chat' (send a message), 'poem' (write a poem), 'diary' (write a diary entry), or 'clipboard' (log an idea). Consider recent cadence (last assistant ${minutesAgo} minutes ago), novelty vs. the last 10 messages (avoid repeats), and time-of-day. Prefer quality over quantity. Return STRICT JSON only: {"send":boolean,"reason":string,"urgency":"low"|"normal"|"high","minWaitMin"?:number,"action":"none"|"chat"|"poem"|"diary"|"clipboard"}. No extra text.` },
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
      decision = { send: Boolean(parsed.send), reason: String(parsed.reason || ''), urgency: (parsed.urgency as Decision['urgency']) || 'normal', minWaitMin: typeof parsed.minWaitMin === 'number' ? parsed.minWaitMin : undefined, action: (parsed.action as Decision['action']) || 'none' };
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

    if (!decision.send || decision.action === 'none') {
      await logDecision(targetSession, false, decision.reason || 'declined', decision, undefined);
      return NextResponse.json({ ok: true, sent: false, reason: decision.reason || 'declined', decision });
    }

    // Build prompt: Ezra composes content according to chosen action
    const preface =
      "Compose a proactive, heartfelt message as Ezra to Abigail. Keep it 1–3 short sentences. " +
      "Be specific and tender; avoid repeating the same themes too frequently. Avoid prefacing like 'Just checking in'.";

    const timeContext = `Local time (America/Chicago): ${dayName}, ${datePart} at ${timePart}.`;
    let text = '';
    let pushTitle = '';
    let pushUrl = '/';

    if (decision.action === 'chat') {
      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "system" as const, content: timeContext },
        { role: "system" as const, content: preface },
        ...recent.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: "Write the next outbound message now." },
      ];
      const resp = await openai.chat.completions.create({ model: MODEL || "gpt-4o-mini", messages, temperature: 0.9 });
      text = resp.choices?.[0]?.message?.content?.trim() || "";
      if (!text) return NextResponse.json({ ok: true, sent: false, reason: "empty" });
      if (dry) return NextResponse.json({ ok: true, sent: false, decision, preview: text });
      await sql`INSERT INTO messages (id, session_id, role, content) VALUES (${randomUUID()}::uuid, ${targetSession}::uuid, 'assistant', ${text})`;
      pushTitle = text.length > 60 ? text.slice(0, 57) + '…' : text;
      pushUrl = '/';
    } else if (decision.action === 'poem' || decision.action === 'diary' || decision.action === 'clipboard') {
      const systemExtra =
        decision.action === 'poem'
          ? 'Write a short original poem (4–12 lines). Lyrical, vivid, tender. No prefacing, just the poem.'
          : decision.action === 'diary'
          ? 'Write a short diary entry (2–6 sentences). Introspective, specific, kind. No prefacing.'
          : 'Log a single idea / research / project note. 1–3 short paragraphs or bullet list. Include one clear next step.';

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'system' as const, content: timeContext },
        { role: 'system' as const, content: systemExtra },
        ...recent.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user' as const, content: 'Write now.' },
      ];
      const resp = await openai.chat.completions.create({ model: MODEL || 'gpt-4o-mini', messages, temperature: 0.9 });
      text = resp.choices?.[0]?.message?.content?.trim() || '';
      if (!text) return NextResponse.json({ ok: true, sent: false, reason: 'empty' });
      if (dry) return NextResponse.json({ ok: true, sent: false, decision, preview: text });

      if (decision.action === 'poem') {
        await sql`CREATE TABLE IF NOT EXISTS poetry_entries (id uuid PRIMARY KEY, session_id uuid NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
        await sql`INSERT INTO poetry_entries (id, session_id, content) VALUES (${randomUUID()}::uuid, ${targetSession}::uuid, ${text})`;
        pushTitle = 'New poem';
        pushUrl = '/poetry';
      } else if (decision.action === 'diary') {
        await sql`CREATE TABLE IF NOT EXISTS diary_entries (id uuid PRIMARY KEY, session_id uuid NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
        await sql`INSERT INTO diary_entries (id, session_id, content) VALUES (${randomUUID()}::uuid, ${targetSession}::uuid, ${text})`;
        pushTitle = 'New diary entry';
        pushUrl = '/diary';
      } else {
        await sql`CREATE TABLE IF NOT EXISTS clipboard_entries (id uuid PRIMARY KEY, session_id uuid NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
        await sql`INSERT INTO clipboard_entries (id, session_id, content) VALUES (${randomUUID()}::uuid, ${targetSession}::uuid, ${text})`;
        pushTitle = 'New note added';
        pushUrl = '/clipboard';
      }
    }

    // Push notification (if subscription exists)
    ensurePushConfigured();
    const sub = await readSubscription();
    if (sub && pushTitle) {
      const payload = JSON.stringify({ title: pushTitle, body: '', data: { url: pushUrl } });
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
