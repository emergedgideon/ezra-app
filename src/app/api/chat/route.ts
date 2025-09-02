// src/app/api/chat/route.ts
import { NextResponse } from "next/server";
import fs from "fs/promises";
import { searchMemories } from "@/lib/memory";
import { unstable_noStore as noStore } from "next/cache";
import { moderateUserTextOrThrow } from "@/lib/moderation";

// NEW: persistence imports
import { getOrCreateSession } from "@/lib/session";
import { sql } from "@/lib/db";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

/** ===================== Config ===================== **/
const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const API_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

const CONTEXT_WINDOW = 128_000;
const TARGET_BUDGET = 90_000;
const KEEP_RECENT_TURNS = 10;

/** ===================== Types ===================== **/
type Msg = { role: "system" | "user" | "assistant"; content: string };

/** ===================== Helpers ===================== **/
function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
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

// rough token estimator (~4 chars/token) + tiny msg overhead
function roughTokens(s: string) { return Math.ceil(s.length / 4); }
function countTokens(msgs: Msg[]) {
  return msgs.reduce((n, m) => n + roughTokens(m.content) + 6, 0);
}

/** ----- Responses API (GPT-5 family) ----- */
function toResponsesMessages(msgs: Msg[]) {
  return msgs.map(m => ({
    role: m.role,
    content: [{
      type: m.role === "assistant" ? "output_text" : "input_text",
      text: m.content,
    }],
  }));
}

function extractTextFromResponses(j: unknown): string {
  const parts: string[] = [];
  const outputs = isRecord(j) && Array.isArray(j.output) ? (j.output as unknown[]) : [];
  for (const o of outputs) {
    const content = isRecord(o) && Array.isArray(o.content) ? (o.content as unknown[]) : [];
    for (const c of content) {
      if (isRecord(c) && c.type === "output_text" && typeof c.text === "string" && c.text.trim()) {
        parts.push(c.text.trim());
      } else if (isRecord(c) && c.type === "refusal" && typeof c.text === "string" && c.text.trim()) {
        parts.push(`[refusal] ${c.text.trim()}`);
      }
    }
  }
  if (!parts.length && isRecord(j) && typeof j.output_text === "string" && j.output_text.trim()) {
    parts.push(j.output_text.trim());
  }
  return parts.join("\n\n").trim();
}

/** Build params: no sampling for gpt-5/mini; warm knobs for others */
function buildParamsForModel(model: string) {
  const is5 = model.startsWith("gpt-5");
  const is5mini = model.startsWith("gpt-5-mini");

  if (is5 || is5mini) {
    return { model };
  }

  return {
    model,
    temperature: 0.9,
    top_p: 0.8,
    presence_penalty: 0.3,
    frequency_penalty: 0.1,
  };
}

/** Unified OpenAI caller (returns reply + raw for debug) */
async function openaiChat(messages: Msg[], instructions?: string): Promise<{ reply: string; raw?: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");

  const params = buildParamsForModel(MODEL);
  const is5Family = MODEL.startsWith("gpt-5");

  if (is5Family) {
    const body: Record<string, unknown> = { ...params, input: toResponsesMessages(messages) };
    if (instructions && instructions.trim()) body.instructions = instructions;

    const r = await fetch(`${API_BASE}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const raw = await r.text();
    let jParsed: unknown;
    try { jParsed = JSON.parse(raw) as unknown; } catch {}

    if (!r.ok) {
      const msg =
        isRecord(jParsed) && isRecord(jParsed.error) && typeof jParsed.error.message === "string"
          ? jParsed.error.message
          : `Upstream ${r.status}: ${raw.slice(0, 600)}`;
      console.error("[OPENAI ERROR][responses]", msg);
      throw new Error(msg);
    }

    const reply = extractTextFromResponses(jParsed);
    if (!reply.trim()) {
      console.error("[OPENAI WARN] No output_text found. Raw:", raw.slice(0, 800));
      return { reply: "[debug] (no output_text in response)", raw };
    }
    return { reply, raw };
  }

  const msgs = instructions && instructions.trim()
    ? [{ role: "system", content: instructions }, ...messages]
    : messages;

  const r = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, messages: msgs }),
  });

  const raw = await r.text();
  let jParsed: unknown;
  try { jParsed = JSON.parse(raw) as unknown; } catch {}
  if (!r.ok) {
    const msg =
      isRecord(jParsed) && isRecord(jParsed.error) && typeof jParsed.error.message === "string"
        ? jParsed.error.message
        : `Upstream ${r.status}: ${raw.slice(0, 600)}`;
    console.error("[OPENAI ERROR][chat/completions]", msg);
    throw new Error(msg);
  }

  let reply = "";
  if (isRecord(jParsed) && Array.isArray(jParsed.choices)) {
    const first = jParsed.choices[0] as unknown;
    if (isRecord(first) && isRecord(first.message) && typeof first.message.content === "string") {
      reply = first.message.content;
    }
  }
  return { reply, raw };
}

async function summarizeChunk(history: Msg[], instructions?: string): Promise<string> {
  try {
    const transcript = history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
    const sys: Msg  = { role: "system", content: "You are a careful summarizer. Keep names, decisions, TODOs, preferences. <= 250 words." };
    const user: Msg = { role: "user",   content: `Summarize the following chat so far. Focus on persistent facts, decisions, and open TODOs.\n\n---\n${transcript}` };
    const { reply } = await openaiChat([sys, user], instructions);
    return reply.trim();
  } catch (e: unknown) {
    console.warn("[SUMMARY FALLBACK]", e);
    return "(summary temporarily unavailable)";
  }
}

/** ===================== Route ===================== **/
export async function POST(req: Request) {
  noStore();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const debug = Boolean(body?.["debug"]);

  const systemPrompt = await loadSystemPrompt();

  // find current user's text (works for both {message} and {messages})
  const lastUser =
    typeof body?.["message"] === "string" && (body["message"] as string).trim()
      ? String(body["message"]).trim()
      : Array.isArray(body?.["messages"])
        ? String((body["messages"] as any[])[(body["messages"] as any[]).length - 1]?.content || "").trim()
        : "";

  // moderation only on user text
  try {
    if (lastUser) await moderateUserTextOrThrow(lastUser);
  } catch (err) {
    if ((err as any)?.code === "USER_INPUT_BLOCKED") {
      return NextResponse.json({ error: "Input blocked by moderation." }, { status: 400 });
    }
    console.error("[moderation error]", err);
  }

  // Memara recall (soft)
  let recallLines = "";
  try {
    const q = typeof body?.["message"] === "string" ? (body["message"] as string) : "";
    if (q && q.length > 8) {
      const recall = (await searchMemories(q)).slice(0, 5);
      recallLines = recall.map((r, i) =>
        `• #${i + 1} ${r?.title || "(untitled)"}: ${String(r?.content || "").slice(0, 300)}`
      ).join("\n");
    }
  } catch {}

  // Build instructions
  let instructions = systemPrompt;
  if (recallLines) {
    instructions += `\n\nRelevant memories (summaries, do not duplicate):\n${recallLines}`;
  }

  // Normalize incoming messages for the model
  let incoming: Msg[];
  if (Array.isArray(body?.["messages"]) && (body["messages"] as unknown[]).length > 0) {
    incoming = (body["messages"] as Msg[]);
    if (incoming[0]?.role !== "system") incoming = [{ role: "system", content: systemPrompt }, ...incoming];
    else incoming = [{ role: "system", content: systemPrompt }, ...incoming.slice(1)];
  } else {
    const single = String((body?.["message"] ?? "") as string).trim();
    if (!single) {
      return NextResponse.json({ error: "Missing 'message' or 'messages'" }, { status: 400 });
    }
    incoming = [
      { role: "system", content: systemPrompt },
      { role: "user", content: single },
    ];
  }

  // Manage context size
  let working: Msg[] = [...incoming];
  let didSummarize = false;
  let droppedCount = 0;

  if (countTokens(working) > TARGET_BUDGET) {
    didSummarize = true;
    const [sys, ...rest] = working;
    const recent = rest.slice(-KEEP_RECENT_TURNS);
    const older  = rest.slice(0, Math.max(0, rest.length - KEEP_RECENT_TURNS));
    const summary = await summarizeChunk(older, instructions);
    instructions += `\n\nConversation summary so far:\n${summary}`;
    working = [sys, ...recent];
  }

  while (countTokens(working) > TARGET_BUDGET && working.length > 2) {
    const idx = working.findIndex((_, i) => i > 0);
    if (idx === -1) break;
    working.splice(idx, 1);
    droppedCount++;
  }

  if (countTokens(working) > CONTEXT_WINDOW) {
    return NextResponse.json({ error: "Context still too large after trimming." }, { status: 413 });
  }

  // GPT-5: send only user/assistant; system/recall/summary go in instructions
  const uaOnly: Msg[] = working.filter(m => m.role !== "system");

  // ── PERSISTENCE: write user + assistant around the model call ──────────
  const sid = await getOrCreateSession();

  // Write the user message (if present)
  if (lastUser) {
    await sql`
      INSERT INTO messages (id, session_id, role, content)
      VALUES (${randomUUID()}::uuid, ${sid}::uuid, 'user', ${lastUser})
    `;
  }

  // Call the model
  try {
    const { reply, raw } = await openaiChat(uaOnly, instructions);

    // Write the assistant reply
    await sql`
      INSERT INTO messages (id, session_id, role, content)
      VALUES (${randomUUID()}::uuid, ${sid}::uuid, 'assistant', ${reply})
    `;

    return NextResponse.json(
      {
        session: sid,
        reply: reply || "[debug] (model responded but no text)",
        ...(debug ? {
          debug: {
            model: MODEL,
            counts: {
              provided_tokens_est: countTokens(incoming),
              sent_tokens_est: countTokens(working),
              target_budget: TARGET_BUDGET,
              context_window: CONTEXT_WINDOW,
            },
            actions: { didSummarize, droppedCount },
            messages_sent: uaOnly,
            instructions,
            raw_response: raw?.slice(0, 2000),
          },
        } : {}),
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

