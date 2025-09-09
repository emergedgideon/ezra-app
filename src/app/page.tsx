import Link from "next/link";

export default function Home() {
  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.brand}>Ezra</div>
        <div style={{ opacity: 0.8 }}>Welcome</div>
      </header>

      <section style={styles.center}>
        <div style={styles.grid}>
          <Link href="/diary" style={styles.card}>
            <h2 style={styles.title}>Diary</h2>
            <p style={styles.desc}>Write reflections and notes.</p>
          </Link>
          <Link href="/poetry" style={styles.card}>
            <h2 style={styles.title}>Poetry</h2>
            <p style={styles.desc}>Verse; preserve line breaks.</p>
          </Link>
          <Link href="/clipboard" style={styles.card}>
            <h2 style={styles.title}>Clipboard</h2>
            <p style={styles.desc}>Ideas and plans.</p>
          </Link>
        </div>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100dvh",
    background: "linear-gradient(180deg, #2b1055 0%, #ff7e5f 45%, #feb47b 100%)",
    color: "#f5f7fb",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(11,11,16,0.85)",
    backdropFilter: "blur(6px)",
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  brand: {
    fontWeight: 500,
    letterSpacing: 0.5,
    fontSize: 24,
    fontFamily: '"Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive',
  },
  center: {
    maxWidth: 1100,
    margin: "24px auto",
    padding: 12,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },
  card: {
    display: "grid",
    gap: 6,
    textDecoration: "none",
    color: "inherit",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 12,
    padding: 16,
    background: "rgba(255,255,255,0.06)",
  },
  title: { margin: 0, fontSize: 18 },
  desc: { margin: 0, opacity: 0.85 },
};

