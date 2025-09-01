// src/app/api/chat/route.ts
import { NextResponse } from "next/server";
import fs from "fs/promises";
import { searchMemories } from "@/lib/memory";
import { unstable_noStore as noStore } from "next/cache";

export const runtime = "nodejs";

/** ===================== Config ===================== **/
const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini"; // "gpt-5" or "gpt-5-mini" use Responses API
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

/** ----- Responses API helpers (GPT-5 family) ----- */
// Map roles to correct content types for the Responses API
function toResponsesMessages(msgs: Msg[]) {
  // we no longer send system turns to GPT-5; system content goes into `instructions`
  return msgs.map(m => ({
    role: m.role, // "user" | "assistant"
    content: [{
      type: m.role === "assistant" ? "output_text" : "input_text",
      text: m.content,
    }],
  }));
}

// Pull all output_text chunks (and surface refusals)
function extractTextFromResponses(j: unknown): string {
  const parts: string[] = [];

  // outputs: Array<{ content: Array<{type: string, text?: string}> }>
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

/** Unified OpenAI caller (returns reply + raw for debug) */
async function openaiChat(messages: Msg[], instructions?: string): Promise<{ reply: string; raw?: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");

  if (MODEL.startsWith("gpt-5")) {
    // GPT-5 / mini use Responses API; pass system+recall+summary via `instructions`
    const body: Record<string, unknown> = {
      model: MODEL,
      input: toResponsesMessages(messages),
    };
    if (instructions && instructions.trim()) body.instructions = instructions;

    const r = await fetch(`${API_BASE}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const raw = await r.text();
    let jParsed: unknown;
    try { jParsed = JSON.parse(raw) as unknown; } catch { jParsed = undefined; }

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

  // Legacy non-GPT-5: Chat Completions; prepend system instructions as one system message
  const msgs = instructions && instructions.trim()
    ? [{ role: "system", content: instructions }, ...messages]
    : messages;

  const r = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: msgs }),
  });

  const raw = await r.text();
  let jParsed: unknown;
  try { jParsed = JSON.parse(raw) as unknown; } catch { jParsed = undefined; }
  if (!r.ok) {
    const msg =
      isRecord(jParsed) && isRecord(jParsed.error) && typeof jParsed.error.message === "string"
        ? jParsed.error.message
        : `Upstream ${r.status}: ${raw.slice(0, 600)}`;
    console.error("[OPENAI ERROR][chat/completions]", msg);
    throw new Error(msg);
  }

  // Safely extract the reply without using `any`
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
    const { reply } = await openaiChat([sys, user], instructions); // pass instructions so tone stays steady
    return reply.trim();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[SUMMARY FALLBACK]", msg);
    return "(summary temporarily unavailable)";
  }
}

/** ===================== Route ===================== **/
export async function POST(req: Request) {
  noStore(); // disable route caching

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const debug = Boolean((body as Record<string, unknown>)?.["debug"]);

  // Accept full history or single message
  const systemPrompt = await loadSystemPrompt();

  // --- Memara recall (throttled) ---
  let recallLines = "";
  try {
    const lastUser =
      typeof body?.["message"] === "string" && (body["message"] as string).trim()
        ? String(body["message"]).trim()
        : Array.isArray(body?.["messages"])
          ? String(
              (body["messages"] as unknown[])[(body["messages"] as unknown[]).length - 1] &&
              (body["messages"] as Record<string, unknown>[])[(body["messages"] as unknown[]).length - 1].content
            ).trim()
          : "";

    const q = lastUser;
    if (q && q.length > 8) {
      const recall = (await searchMemories(q)).slice(0, 5); // call with one arg, enforce limit here
      recallLines = recall
        .map((r, i) => {
          const title = r?.title || "(untitled)";
          const content = String(r?.content || "").slice(0, 300);
          return `• #${i + 1} ${title}: ${content}`;
        })
        .join("\n");
    }
  } catch {}

  // Build combined INSTRUCTIONS (system + recall; we'll append summary later)
  let instructions = systemPrompt;
  if (recallLines) {
    instructions += `\n\nRelevant memories (summaries, do not duplicate):\n${recallLines}`;
  }

  // --- Normalize incoming ---
  let incoming: Msg[];
  if (Array.isArray(body?.["messages"]) && (body["messages"] as unknown[]).length > 0) {
    incoming = (body["messages"] as Msg[]);
    // ensure there's at least a placeholder system at head so our logic stays consistent
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

  // --- Context manager: summarize older, keep last N turns ---
  let working: Msg[] = [...incoming];
  let didSummarize = false;
  let droppedCount = 0;

  if (countTokens(working) > TARGET_BUDGET) {
    didSummarize = true;
    const [sys, ...rest] = working;
    const recent = rest.slice(-KEEP_RECENT_TURNS);
    const older  = rest.slice(0, Math.max(0, rest.length - KEEP_RECENT_TURNS));
    const summary = await summarizeChunk(older, instructions);

    // Move summary into instructions; keep only system header + recent turns
    instructions += `\n\nConversation summary so far:\n${summary}`;
    working = [sys, ...recent];
  }

  // If still too big, drop oldest of recent until under budget
  while (countTokens(working) > TARGET_BUDGET && working.length > 2) {
    // drop first non-system message
    const idx = working.findIndex((_, i) => i > 0);
    if (idx === -1) break;
    working.splice(idx, 1);
    droppedCount++;
  }

  if (countTokens(working) > CONTEXT_WINDOW) {
    return NextResponse.json(
      { error: "Context still too large after trimming." },
      { status: 413 }
    );
  }

  // For GPT-5 we send only user/assistant turns; system/recall/summary go via instructions
  const uaOnly: Msg[] = working.filter(m => m.role !== "system");

  // --- Call model ---
  try {
    const { reply, raw } = await openaiChat(uaOnly, instructions);
    return NextResponse.json(
      {
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
            messages_sent: uaOnly,      // what we actually sent as history
            instructions,               // full instructions string we sent
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
