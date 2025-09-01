import { saveMemory } from "../src/lib/memory";

async function run() {
  try {
    const saved = await saveMemory({
      title: "search demo",
      content: "purple giraffe",
      tags: ["demo"]
    });
    console.log("SAVED:", saved);
  } catch (err: any) {
    console.error("ERROR:", err.message);
  }
}

run();

