// scripts/testSave.ts
type Json = Record<string, unknown>;

async function main() {
  try {
    const body: Json = {
      title: "Ezra test",
      body: "Hello from testSave script",
    };

    const res = await fetch("http://localhost:3000/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const saved = await res.text();
    console.log("SAVED:", saved);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("ERROR:", msg);
    process.exit(1);
  }
}

main();

