// src/lib/moderation.ts
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// default ON unless you set ENABLE_INPUT_MODERATION=false in env
const INPUT_MODERATION = process.env.ENABLE_INPUT_MODERATION !== "false";

export async function moderateUserTextOrThrow(userText: string) {
  if (!INPUT_MODERATION || !userText) return;

  const res = await client.moderations.create({
    model: "omni-moderation-latest", // latest moderation model
    input: userText,
  });

  const result = res.results?.[0];
  if (!result) return;

  if (process.env.NODE_ENV !== "production") {
    console.log("[moderation] categories:", result.categories);
    console.log("[moderation] scores:", result.category_scores);
  }

  if (result.flagged) {
    const reason = Object.entries(result.categories)
      .filter(([_, v]) => Boolean(v))
      .map(([k]) => k)
      .join(", ");
    const err = new Error(`Blocked by moderation: ${reason}`);
    // @ts-ignore
    err.code = "USER_INPUT_BLOCKED";
    throw err;
  }
}

