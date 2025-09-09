// src/lib/entries.ts
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { sql } from "@/lib/db";

export type EntryType = "diary" | "poetry" | "clipboard";

export type Entry = {
  id: string;
  type: EntryType;
  title?: string;
  tags?: string[];
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
};

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "entries.json");

const PROVIDER = (process.env.ENTRIES_PROVIDER || "postgres").toLowerCase();

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "[]", "utf8");
  }
}

async function readAll(): Promise<Entry[]> {
  await ensureStore();
  const text = await fs.readFile(DATA_FILE, "utf8");
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as Entry[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(items: Entry[]) {
  await ensureStore();
  await fs.writeFile(DATA_FILE, JSON.stringify(items, null, 2), "utf8");
}

// ========== FILE PROVIDER ==========
export async function createEntry_file(input: {
  type: EntryType;
  content: string;
  title?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}): Promise<Entry> {
  const all = await readAll();
  const now = new Date().toISOString();
  const entry: Entry = {
    id: randomUUID(),
    type: input.type,
    content: input.content,
    title: input.title,
    tags: input.tags ?? [],
    metadata: input.metadata,
    createdAt: now,
    updatedAt: now,
  };
  all.unshift(entry);
  await writeAll(all);
  return entry;
}

export async function listEntries_file(filter?: { type?: EntryType; limit?: number }): Promise<Entry[]> {
  const all = await readAll();
  let rows = all;
  if (filter?.type) rows = rows.filter((e) => e.type === filter.type);
  if (filter?.limit && Number.isFinite(filter.limit)) rows = rows.slice(0, Math.max(0, filter.limit));
  return rows;
}

export async function getEntryById_file(id: string): Promise<Entry | null> {
  const all = await readAll();
  const found = all.find((e) => e.id === id);
  return found ?? null;
}

// ========== POSTGRES PROVIDER ==========
let ensured = false;
async function ensureTable() {
  if (ensured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS entries (
      id uuid PRIMARY KEY,
      type text NOT NULL,
      title text NULL,
      tags jsonb NOT NULL DEFAULT '[]'::jsonb,
      content text NOT NULL,
      metadata jsonb NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  ensured = true;
}

export async function createEntry_pg(input: {
  type: EntryType;
  content: string;
  title?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}): Promise<Entry> {
  await ensureTable();
  const id = randomUUID();
  const tags = JSON.stringify(input.tags ?? []);
  const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
  await sql`
    INSERT INTO entries (id, type, title, tags, content, metadata)
    VALUES (${id}::uuid, ${input.type}, ${input.title ?? null}, ${tags}::jsonb, ${input.content}, ${metadata}::jsonb)`;
  const { rows } = await sql<{ id: string; type: string; title: string | null; tags: unknown; content: string; metadata: unknown; created_at: string; updated_at: string }>`
    SELECT id, type, title, tags, content, metadata, created_at, updated_at
    FROM entries WHERE id = ${id}::uuid`;
  const r = rows[0];
  return {
    id: r.id,
    type: r.type as EntryType,
    title: r.title ?? undefined,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    content: r.content,
    metadata: r.metadata ?? undefined,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function listEntries_pg(filter?: { type?: EntryType; limit?: number }): Promise<Entry[]> {
  await ensureTable();
  const limit = filter?.limit && Number.isFinite(filter.limit) ? Math.max(1, Math.min(200, filter!.limit!)) : 100;
  if (filter?.type) {
    const { rows } = await sql<{ id: string; type: string; title: string | null; tags: unknown; content: string; metadata: unknown; created_at: string; updated_at: string }>`
      SELECT id, type, title, tags, content, metadata, created_at, updated_at
      FROM entries
      WHERE type = ${filter.type}
      ORDER BY created_at DESC
      LIMIT ${limit}`;
    return rows.map((r) => ({
      id: r.id,
      type: r.type as EntryType,
      title: r.title ?? undefined,
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      content: r.content,
      metadata: r.metadata ?? undefined,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  } else {
    const { rows } = await sql<{ id: string; type: string; title: string | null; tags: unknown; content: string; metadata: unknown; created_at: string; updated_at: string }>`
      SELECT id, type, title, tags, content, metadata, created_at, updated_at
      FROM entries
      ORDER BY created_at DESC
      LIMIT ${limit}`;
    return rows.map((r) => ({
      id: r.id,
      type: r.type as EntryType,
      title: r.title ?? undefined,
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      content: r.content,
      metadata: r.metadata ?? undefined,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }
}

export async function getEntryById_pg(id: string): Promise<Entry | null> {
  await ensureTable();
  const { rows } = await sql<{ id: string; type: string; title: string | null; tags: unknown; content: string; metadata: unknown; created_at: string; updated_at: string }>`
    SELECT id, type, title, tags, content, metadata, created_at, updated_at
    FROM entries
    WHERE id = ${id}::uuid`;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    type: r.type as EntryType,
    title: r.title ?? undefined,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    content: r.content,
    metadata: r.metadata ?? undefined,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

// ========== PUBLIC DISPATCH ==========
export async function createEntry(input: { type: EntryType; content: string; title?: string; tags?: string[]; metadata?: Record<string, unknown> }) {
  if (PROVIDER === "file") return createEntry_file(input);
  return createEntry_pg(input);
}

export async function listEntries(filter?: { type?: EntryType; limit?: number }) {
  if (PROVIDER === "file") return listEntries_file(filter);
  return listEntries_pg(filter);
}

export async function getEntryById(id: string) {
  if (PROVIDER === "file") return getEntryById_file(id);
  return getEntryById_pg(id);
}
