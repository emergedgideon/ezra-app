// src/lib/memory.ts
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";


export type MemoryItem = {
  id: string;
  title: string;      // local-only label
  content: string;
  tags?: string[];
  createdAt: string;  // ISO
};


const PROVIDER = process.env.MEMORY_PROVIDER ?? "file";


/* ========== FILE (local) ========== */
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "memory.json");


async function ensureFileStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "[]", "utf8");
  }
}


async function fileReadAll(): Promise<MemoryItem[]> {
  await ensureFileStore();
  return JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as MemoryItem[];
}


async function fileWriteAll(items: MemoryItem[]) {
  await ensureFileStore();
  await fs.writeFile(DATA_FILE, JSON.stringify(items, null, 2), "utf8");
}


async function fileSaveMemory(input: { title: string; content: string; tags?: string[] }): Promise<MemoryItem> {
  const all = await fileReadAll();
  const item: MemoryItem = {
    id: randomUUID(),
    title: input.title,
    content: input.content,
    tags: input.tags ?? [],
    createdAt: new Date().toISOString(),
  };
  all.unshift(item);
  await fileWriteAll(all);
  return item;
}


async function fileSearchMemories(q: string): Promise<MemoryItem[]> {
  const all = await fileReadAll();
  return all.filter((m) => m.content.includes(q) || m.title.includes(q));
}


/* ========== MEMARA (HTTP) ========== */
const BASE   = (process.env.MEMARA_BASE || "").replace(/\/+$/, ""); // no trailing slash
const SAVE   = process.env.MEMARA_SAVE_PATH   || "/memories";
const SEARCH = process.env.MEMARA_SEARCH_PATH || "/memories/search";
const INFO   = process.env.MEMARA_INFO_PATH   || "/info";


const DEFAULT_CATEGORY   = process.env.MEMARA_DEFAULT_CATEGORY || "chat";
const DEFAULT_IMPORTANCE = Number(process.env.MEMARA_DEFAULT_IMPORTANCE || 5);
const SEARCH_LIMIT       = Number(process.env.MEMARA_SEARCH_LIMIT || 10);


// Type guards
function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}
function asString(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}
function hasKey<K extends string>(obj: unknown, key: K): obj is Record<K, unknown> {
  return isRecord(obj) && key in obj;
}

function url(pathname: string) {
  if (pathname.startsWith("http")) return pathname;
  if (!BASE) throw new Error("MEMARA_BASE is required");
  return `${BASE}${pathname}`;
}


async function memaraFetch(pathname: string, init: RequestInit = {}): Promise<unknown> {
  const key = process.env.MEMARA_API_KEY;
  if (!key) throw new Error("MEMARA_API_KEY missing");


  const u = url(pathname);
  const method = (init.method || "GET").toUpperCase();
  console.log("[MEMARA]", method, u);


  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${key}`,
    ...(init.headers as HeadersInit | undefined),
  };


  const res = await fetch(u, { ...(init as RequestInit), headers } as RequestInit);


  const ct = res.headers.get("content-type") || "";
  const text = await res.text();


  if (!res.ok) {
    console.error("[MEMARA] ERROR", res.status, method, u, text.slice(0, 200));
    throw new Error(`Memara ${u} ${res.status}: ${text}`);
  }
  if (!ct.includes("application/json")) {
    throw new Error(`Memara returned non-JSON (${ct}): ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as unknown;
}


async function memaraSaveMemory(input: { title: string; content: string; tags?: string[] }): Promise<MemoryItem> {
  const body = {
    content: input.content,
    tags: input.tags ?? [],
    category: DEFAULT_CATEGORY,
    importance: DEFAULT_IMPORTANCE,
  };


  const data = await memaraFetch(SAVE, { method: "POST", body: JSON.stringify(body) });


  const src: unknown = hasKey(data, "memory") ? data["memory"] : data;
  const rec = isRecord(src) ? src : {};

  return {
    id: asString(rec.id, randomUUID()),
    title: input.title || asString(rec.title, "Memory"),
    content: asString(rec.content, input.content),
    tags: Array.isArray(rec.tags) ? (rec.tags as string[]) : input.tags ?? [],
    createdAt: asString(rec.createdAt, new Date().toISOString()),
  };
}


async function memaraSearchMemories(q: string, limit = SEARCH_LIMIT): Promise<MemoryItem[]> {
  const query = String(q ?? "").trim();
  if (!query) throw new Error("query must be a non-empty string");


  const key = process.env.MEMARA_API_KEY || "";
  if (!BASE || !key) throw new Error("Missing MEMARA_BASE or MEMARA_API_KEY");


  const searchUrl = `${BASE}${SEARCH}?query=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`;
  console.log("[MEMARA][GET]", searchUrl);


  const res = await fetch(searchUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  } as RequestInit);


  const text = await res.text();
  console.log("[MEMARA][GET][STATUS]", res.status, text.slice(0, 200));


  if (!res.ok) throw new Error(`Memara GET search ${res.status}: ${text.slice(0, 300)}`);


  const data = JSON.parse(text) as unknown;


  let rows: unknown = [];
  if (Array.isArray(data)) {
    rows = data;
  } else if (isRecord(data)) {
    rows =
      (Array.isArray(data.items) && data.items) ||
      (Array.isArray(data.results) && data.results) ||
      (Array.isArray((data as Record<string, unknown>).memories) && (data as Record<string, unknown>).memories) ||
      [];
  }


  if (!Array.isArray(rows)) rows = [];


  return (rows as unknown[]).map((r): MemoryItem => {
    const rec = isRecord(r) ? r : {};
    return {
      id: asString(rec.id, randomUUID()),
      title: asString(rec.title, "(untitled)"),
      content: asString(rec.content, asString((rec as Record<string, unknown>).text, "")),
      tags: Array.isArray(rec.tags) ? (rec.tags as string[]) : [],
      createdAt: asString(rec.createdAt, new Date().toISOString()),
    };
  });
}


/* ========== PUBLIC API ========== */
export async function saveMemory(input: { title: string; content: string; tags?: string[] }) {
  if (PROVIDER === "memara") return memaraSaveMemory(input);
  return fileSaveMemory(input);
}


export async function searchMemories(q: string) {
  if (PROVIDER === "memara") return memaraSearchMemories(q);
  return fileSearchMemories(q);
}


export async function memaraInfo() {
  return memaraFetch(INFO);
}

