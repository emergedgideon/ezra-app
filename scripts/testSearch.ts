import { searchMemories } from "../src/lib/memory";

async function run() {
  try {
    const results = await searchMemories("purple giraffe");
    console.log("RESULTS:", results);
  } catch (err: any) {
    console.error("ERROR:", err.message);
  }
}

run();

