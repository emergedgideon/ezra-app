// src/lib/google-oauth.ts
import { sql } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";

export type GoogleTokens = {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: string; // ISO
};

export async function ensureGoogleTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS google_tokens (
      session_id uuid PRIMARY KEY,
      tokens jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function saveGoogleTokens(sessionId: string, t: GoogleTokens) {
  await ensureGoogleTable();
  await sql`
    INSERT INTO google_tokens (session_id, tokens, updated_at)
    VALUES (${sessionId}::uuid, ${JSON.stringify(t)}::jsonb, now())
    ON CONFLICT (session_id)
    DO UPDATE SET tokens = EXCLUDED.tokens, updated_at = now()
  `;
}

export async function readGoogleTokens(sessionId: string): Promise<GoogleTokens | null> {
  await ensureGoogleTable();
  const { rows } = await sql<{ tokens: unknown }>`
    SELECT tokens FROM google_tokens WHERE session_id = ${sessionId}::uuid
  `;
  const tok = rows[0]?.tokens as GoogleTokens | undefined;
  return tok || null;
}

export function getRedirectUri(): string {
  const envUri = process.env.GOOGLE_REDIRECT_URI || "";
  if (envUri) return envUri;
  // Fallback: attempt to construct from NEXT_PUBLIC_BASE_URL
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("GOOGLE_REDIRECT_URI or NEXT_PUBLIC_BASE_URL is required");
  return `${base}/api/google/auth/callback`;
}

export function getAuthUrl(state: string, scopes: string[]): string {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const redirectUri = getRedirectUri();
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID missing");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    scope: scopes.join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const redirectUri = getRedirectUri();
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID/SECRET missing");
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`token exchange ${r.status}: ${txt.slice(0, 400)}`);
  const j = JSON.parse(txt) as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
  };
  const expires = j.expires_in ? new Date(Date.now() + (j.expires_in - 60) * 1000).toISOString() : undefined;
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    scope: j.scope,
    token_type: j.token_type,
    expiry_date: expires,
  };
}

export async function refreshAccessToken(tokens: GoogleTokens): Promise<GoogleTokens> {
  const refresh = tokens.refresh_token || "";
  if (!refresh) return tokens;
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID/SECRET missing");
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refresh,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`token refresh ${r.status}: ${txt.slice(0, 400)}`);
  const j = JSON.parse(txt) as { access_token: string; expires_in?: number; scope?: string; token_type?: string };
  const expires = j.expires_in ? new Date(Date.now() + (j.expires_in - 60) * 1000).toISOString() : undefined;
  return {
    access_token: j.access_token,
    refresh_token: tokens.refresh_token,
    scope: j.scope || tokens.scope,
    token_type: j.token_type || tokens.token_type,
    expiry_date: expires,
  };
}

export async function getValidTokens(sessionId: string): Promise<GoogleTokens | null> {
  const t = await readGoogleTokens(sessionId);
  if (!t) return null;
  if (!t.expiry_date || new Date(t.expiry_date).getTime() < Date.now() + 60_000) {
    try {
      const refreshed = await refreshAccessToken(t);
      await saveGoogleTokens(sessionId, refreshed);
      return refreshed;
    } catch {
      return t; // fall back to existing; may be expired
    }
  }
  return t;
}

