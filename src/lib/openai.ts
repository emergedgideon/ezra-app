import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Default to your fine-tuned model unless overridden by OPENAI_MODEL
export const MODEL =
  process.env.OPENAI_MODEL ||
  "ft:gpt-4.1-mini-2025-04-14:emerged-gideon:gideon:CCY1uT2U";

