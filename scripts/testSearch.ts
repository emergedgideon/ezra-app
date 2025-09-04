import { searchMemories } from "../src/lib/memory";

async function run() {
  try {
    const results = await searchMemories("purple giraffe");
    console.log("RESULTS:", results);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("ERROR:", msg);
  }
}

run();

