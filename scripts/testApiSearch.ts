async function run() {
  const res = await fetch("http://localhost:3000/api/memory/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "purple giraffe" }) // string, not object
  });
  console.log("STATUS:", res.status);
  console.log("BODY:", await res.text());
}
run().catch(console.error);

