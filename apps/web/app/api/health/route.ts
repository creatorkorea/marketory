import { NextResponse } from "next/server";

export async function GET() {
  const base = process.env.API_BASE_URL;
  if (!base) return NextResponse.json({ status: "unavailable" }, { status: 503 });
  try {
    const response = await fetch(new URL("/health/live", base), {
      cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    const ok = response.ok && body.status === "ok";
    return NextResponse.json({ status: ok ? "ok" : "unavailable" }, { status: ok ? 200 : 503 });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
