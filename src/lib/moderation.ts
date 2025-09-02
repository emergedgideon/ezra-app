// src/lib/moderation.ts
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// default ON unless you set ENABLE_INPUT_MODERATION=false in env
const INPUT_MODERATION = process.env.ENABLE_INPUT_MODERATION !== "false";

type ModerationCategories = Record<string, boolean>;
type ModerationScores = Record<string, number>;

// Narrow the SDK response without depending on exact upstream types
function pickFirstResult(res: unknown): {
  flagged?: boolean;
  categories?: ModerationCategories;
  category_scores?: ModerationScores;
} | undefined {
  if (
    res &&
    typeof res === "object" &&
    "results" in res &&
    Array.isArray((res as Record<string, unknown>).results)
  ) {
    const first = (res as { results: unknown[] }).results[0];
    if (first && typeof first === "object") {
      const obj = first as {
        flagged?: boolean;
        categories?: ModerationCategories;
        category_scores?: ModerationScores;
      };
      return obj;
    }
  }
  return undefined;
}

export async function moderateUserTextOrThrow(userText: string) {
  if (!INPUT_MODERATION || !userText) return;

  const res = await client.moderations.create({
    model: "omni-moderation-latest", // latest moderation model
    input: userText,
  });

  const result = pickFirstResult(res);
  if (!result) return;

  if (process.env.NODE_ENV !== "production") {
    // Safe optional logging
    if (result.categories) console.log("[moderation] categories:", result.categories);
    if (result.category_scores) console.log("[moderation] scores:", result.category_scores);
  }

  if (result.flagged) {
    const reason =
      result.categories
        ? Object.entries(result.categories)
            .filter(([, v]) => Boolean(v))
            .map(([k]) => k)
            .join(", ")
        : "policy";

    const err = new Error(`Blocked by moderation: ${reason}`) as Error & { code: string };
    err.code = "USER_INPUT_BLOCKED"; // explicit code without @ts-ignore
    throw err;
  }
}
