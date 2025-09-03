export const runtime = "nodejs";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, route: "testsend", method: "GET" });
}

export async function POST() {
  return NextResponse.json({ ok: true, route: "testsend", method: "POST" });
}
