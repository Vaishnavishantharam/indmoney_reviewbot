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
    const raw = await res.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      const snippet = raw.slice(0, 200).replace(/\s+/g, " ");
      return Response.json(
        {
          error: "Backend returned non-JSON. Pipeline may have timed out or crashed.",
          status: res.status,
          hint: snippet || "(empty body)",
        },
        { status: res.status >= 400 ? res.status : 502 }
      );
    }
    return Response.json(data, { status: res.status });
  } catch (e) {
    return Response.json(
      { error: e.message || "Backend unreachable. Check Railway is up." },
      { status: 502 }
    );
  }
}
