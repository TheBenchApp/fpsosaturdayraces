// Temporary Krok acceptance-test endpoint.
// First verifies Krok reachability + API-key authentication using /status and /me.
// Only if authentication succeeds does it make the requested racing-meetings call.
// It never returns or logs the API key.
const BASE = "https://krokodds.com.au/api/v1";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

const readPayload = async (res) => {
  const raw = await res.text();
  try { return JSON.parse(raw); } catch { return { raw: raw.slice(0, 2000) }; }
};

export default async (request) => {
  const key = Netlify.env.get("KROK_ODDS_API_KEY");
  if (!key) return json({ error: "KROK_ODDS_API_KEY is not configured" }, 500);

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
    return json({ error: "date=YYYY-MM-DD is required" }, 400);
  }

  const headers = { "X-API-Key": key.trim(), "Accept": "application/json" };

  try {
    // /status is public: proves Netlify can reach the documented Krok API.
    const statusRes = await fetch(BASE + "/status", { headers: { "Accept": "application/json" } });
    const statusPayload = await readPayload(statusRes);

    // /me is Krok's documented key-introspection endpoint: isolate authentication
    // before spending a racing request.
    const meRes = await fetch(BASE + "/me", { headers });
    const mePayload = await readPayload(meRes);

    if (!meRes.ok) {
      return json({
        acceptance_test: true,
        stage: "authentication",
        krok_reachable: statusRes.ok,
        status_http: statusRes.status,
        status_payload: statusPayload,
        auth_http: meRes.status,
        auth_payload: mePayload,
        env_key_present: true,
        env_key_trimmed: key !== key.trim(),
        env_key_prefix_ok: key.trim().startsWith("krok_")
      }, meRes.status);
    }

    // Authentication passed; now make exactly one racing data request.
    const upstream = new URL(BASE + "/racing/meetings");
    upstream.searchParams.set("date", date);
    upstream.searchParams.set("race_type", "T");
    upstream.searchParams.set("limit", "50");

    const raceRes = await fetch(upstream, { headers });
    const racePayload = await readPayload(raceRes);

    return json({
      acceptance_test: true,
      stage: "racing",
      requested_date: date,
      krok_reachable: statusRes.ok,
      auth_http: meRes.status,
      auth: mePayload,
      racing_http: raceRes.status,
      racing_payload: racePayload
    }, raceRes.ok ? 200 : raceRes.status);
  } catch (err) {
    return json({ error: "Krok diagnostic failed", detail: String(err?.message || err) }, 502);
  }
};
