/**
 * Proxy to Railway backend so the browser never crosses origins (avoids CORS).
 * POST body: { weeksBack?: number }
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || "https://indmoneyreviewbot-production.up.railway.app").replace(/\/$/, "");

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const res = await fetch(`${BACKEND_URL}/api/weekly-pulse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ error: "Invalid response from backend" }));
    return Response.json(data, { status: res.status });
  } catch (e) {
    return Response.json(
      { error: e.message || "Backend unreachable. Check Railway is up." },
      { status: 502 }
    );
  }
}
