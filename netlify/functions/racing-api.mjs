const BASE = "https://api.puntersedge.online/v1";

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      ...extra,
    },
  });

export default async (request) => {
  if (request.method !== "GET") return json({ ok:false, error:"Method not allowed" }, 405);

  const key = Netlify.env.get("PUNTERSEDGE_API_KEY");
  if (!key) return json({ ok:false, error:"PUNTERSEDGE_API_KEY is not configured" }, 500);

  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "acceptances";

  const endpoints = {
    acceptances: "/racing/acceptances",
    events: "/racing/events",
    results: "/racing/results",
    form: "/racing/form",
    next: "/racing/next-to-go",
    markets: "/racing/markets",
    usage: "/usage",
  };
  if (!endpoints[action]) return json({ ok:false, error:"Unsupported racing action" }, 400);

  const upstream = new URL(BASE + endpoints[action]);
  const allowed = ["date","venue","hours_ahead","country","category","categories","include_unresolved","status","hours_back","race_id","meeting_date","race_number","runs","bookmakers","markets","num_races","maxAgeMinutes"];
  for (const name of allowed) {
    const value = url.searchParams.get(name);
    if (value !== null && value !== "") upstream.searchParams.set(name, value);
  }

  // Safe defaults for this app: Australian thoroughbreds only.
  if (action === "events" || action === "results") {
    if (!upstream.searchParams.has("country")) upstream.searchParams.set("country", "AU");
    if (!upstream.searchParams.has("categories") && !upstream.searchParams.has("category")) upstream.searchParams.set("categories", "horse");
  }

  try {
    const r = await fetch(upstream, { headers: { "X-API-Key": key, "Accept": "application/json" } });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!r.ok) {
      return json({
        ok:false,
        provider:"PuntersEdge",
        status:r.status,
        error:data?.detail || data?.message || data?.error || "PuntersEdge request failed",
        details:data,
      }, r.status, { "cache-control":"no-store" });
    }

    return json({ ok:true, provider:"PuntersEdge", action, data }, 200, {
      "x-racing-source":"PuntersEdge",
      "x-racing-upstream-cache": r.headers.get("x-cache") || "",
    });
  } catch (e) {
    return json({ ok:false, provider:"PuntersEdge", error:"Unable to reach PuntersEdge" }, 502, { "cache-control":"no-store" });
  }
};
