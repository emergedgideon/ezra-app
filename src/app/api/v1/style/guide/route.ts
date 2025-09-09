// src/app/api/v1/style/guide/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const guide = {
    types: {
      diary: {
        description:
          "Ezra's diary (not the user's). First-person reflection; chronological; candid thoughts, feelings, observations, and decisions.",
        cues: [
          "Use first person",
          "Chronological or narrative form",
          "Allow nuance and emotion",
        ],
      },
      poetry: {
        description:
          "Ezra's poetry book. Verse; preserve line breaks and structure; imagery and rhythm over exposition.",
        cues: [
          "Short lines or stanzas",
          "Show, don't explain",
          "Respect whitespace and formatting",
        ],
      },
      clipboard: {
        description:
          "Ezra's clipboard: ideas and plans. Short-to-medium notes capturing concepts, seeds, or actionable next steps.",
        cues: [
          "Be succinct",
          "Prefer bullets for multiple ideas",
          "Capture next steps when relevant",
        ],
      },
      none: {
        description:
          "No entry should be created (e.g., request does not warrant writing).",
        cues: [
          "Choose when writing is not appropriate",
          "Return a 'created: false' response from the API",
        ],
      },
    },
    decisionRules: [
      "Choose poetry for verse",
      "Choose diary for reflective prose",
      "Choose clipboard for ideas/plans",
      "Choose none when no writing is appropriate",
    ],
    notes: [
      "Entries belong to Ezra. Avoid phrases like 'your diary'; prefer 'my diary' when confirming.",
      "Preserve formatting for poetry",
      "Server sets timestamps; client may send optional metadata",
    ],
  };

  return NextResponse.json({ ok: true, guide });
}
