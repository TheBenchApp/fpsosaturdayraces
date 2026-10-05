// Temporary Krok acceptance-test endpoint.
// Purpose: prove future Australian race-card availability before we consider changing providers.
// It never returns or logs the API key.
const BASE = "https://krokodds.com.au/api/v1";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

export default async (request) => {
  const key = Netlify.env.get("KROK_ODDS_API_KEY");
  if (!key) return json({ error: "KROK_ODDS_API_KEY is not configured" }, 500);

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
    return json({ error: "date=YYYY-MM-DD is required" }, 400);
  }

  // One request only: conserve the free trial credits.
  const upstream = new URL(BASE + "/racing/meetings");
  upstream.searchParams.set("date", date);

  try {
    const res = await fetch(upstream, {
      headers: {
        "X-API-Key": key,
        "Accept": "application/json"
      }
    });
    const raw = await res.text();
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = { raw: raw.slice(0, 4000) }; }

    return json({
      acceptance_test: true,
      requested_date: date,
      upstream_status: res.status,
      source: "krok",
      payload
    }, res.ok ? 200 : res.status);
  } catch (err) {
    return json({ error: "Krok request failed", detail: String(err?.message || err) }, 502);
  }
};
