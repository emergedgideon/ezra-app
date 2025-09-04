// src/app/api/chat/reset/route.ts
import { NextResponse } from "next/server";
import { getOrCreateSession } from "@/lib/session";
import { sql } from "@/lib/db";
import { randomUUID } from "crypto";
import { saveMemory } from "@/lib/memory";
import { openai, MODEL } from "@/lib/openai";

export const runtime = "nodejs";

type DbMsg = { id: string; role: "user" | "assistant" | "system"; content: string; created_at: string };

async function generateSummary(history: DbMsg[]): Promise<string> {
  const transcript = history
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const system = {
    role: "system" as const,
    content: "You are a careful summarizer. Keep names, decisions, preferences, and TODOs. <= 250 words.",
  };
  const user = {
    role: "user" as const,
    content: `Summarize the following chat so far. Focus on persistent facts, decisions, and open TODOs.\n\n---\n${transcript}`,
  };

  try {
    const isResponses = MODEL?.startsWith("gpt-5");
    if (isResponses) {
      // Use Responses API via SDK
      const r = await openai.responses.create({
        model: MODEL,
        input: [
          { role: system.role, content: [{ type: "output_text", text: system.content }] },
          { role: user.role, content: [{ type: "input_text", text: user.content }] },
        ],
      } as any);
      const text = (r.output_text || "").trim();
      return text || "(summary unavailable)";
    }

    const resp = await openai.chat.completions.create({
      model: MODEL || "gpt-4o-mini",
      messages: [system, user] as any,
      temperature: 0.2,
    });
    const summary = resp.choices?.[0]?.message?.content?.trim() || "";
    return summary || "(summary unavailable)";
  } catch (e) {
    console.warn("[reset] summary error", e);
    return "(summary temporarily unavailable)";
  }
}

export async function POST() {
  const sid = await getOrCreateSession();

  // Load full history for this session
  const { rows } = await sql<DbMsg[]>`
    SELECT id, role, content, created_at
    FROM messages
    WHERE session_id = ${sid}::uuid
    ORDER BY created_at ASC
  `;

  const history = Array.isArray(rows) ? (rows as unknown as DbMsg[]) : [];
  const summary = await generateSummary(history);

  // Save summary to memories (file or Memara)
  let memoryId: string | undefined;
  try {
    const saved = await saveMemory({
      title: "Chat Summary",
      content: summary,
      tags: ["summary", `session:${sid}`],
    });
    memoryId = saved.id;
  } catch (e) {
    console.warn("[reset] saveMemory failed", e);
  }

  // Clear prior chat for the session
  await sql`
    DELETE FROM messages
    WHERE session_id = ${sid}::uuid
  `;

  // Seed the new session with the summary as the only assistant message
  await sql`
    INSERT INTO messages (id, session_id, role, content)
    VALUES (${randomUUID()}::uuid, ${sid}::uuid, 'assistant', ${summary})
  `;

  return NextResponse.json({ session: sid, summary, memoryId });
}

