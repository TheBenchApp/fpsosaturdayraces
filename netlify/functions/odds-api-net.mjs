const BASE = "https://api.odds-api.net/v1";

export default async (request) => {
  const key = Netlify.env.get("ODDS_API_NET_KEY");
  if (!key) return new Response(JSON.stringify({ error: "ODDS_API_NET_KEY is not configured" }), { status: 500, headers: { "content-type": "application/json" } });

  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "me";
  const allowed = new Set(["me","usage","sports","leagues","bookmakers","coverage","racing","race","race_odds","events","event_odds"]);
  if (!allowed.has(action)) return new Response(JSON.stringify({ error: "Unsupported action" }), { status: 400, headers: { "content-type": "application/json" } });

  let path;
  if (action === "me") path = "/me";
  else if (action === "usage") path = "/usage";
  else if (action === "sports") path = "/sports";
  else if (action === "leagues") path = "/leagues";
  else if (action === "bookmakers") path = "/bookmakers";
  else if (action === "coverage") path = "/coverage";
  else if (action === "racing") path = "/racing/events";
  else if (action === "race") {
    const id = url.searchParams.get("event_id");
    if (!id) return new Response(JSON.stringify({ error: "event_id is required" }), { status: 400, headers: { "content-type": "application/json" } });
    path = "/racing/events/" + encodeURIComponent(id);
  } else if (action === "race_odds") {
    const id = url.searchParams.get("event_id");
    if (!id) return new Response(JSON.stringify({ error: "event_id is required" }), { status: 400, headers: { "content-type": "application/json" } });
    path = "/racing/events/" + encodeURIComponent(id) + "/odds";
  } else if (action === "events") path = "/events";
  else {
    const id = url.searchParams.get("event_id");
    if (!id) return new Response(JSON.stringify({ error: "event_id is required" }), { status: 400, headers: { "content-type": "application/json" } });
    path = "/events/" + encodeURIComponent(id) + "/odds/snapshot";
  }

  const upstream = new URL(BASE + path);
  for (const [k,v] of url.searchParams.entries()) {
    if (k !== "action" && k !== "event_id") upstream.searchParams.append(k,v);
  }
  if (action === "racing" && !upstream.searchParams.has("race_type")) upstream.searchParams.set("race_type","horse-racing");
  if (action === "racing" && !upstream.searchParams.has("race_country")) upstream.searchParams.set("race_country","AU");
  if (action === "race_odds" && !upstream.searchParams.has("bookmakers")) upstream.searchParams.set("bookmakers","sportsbet");

  try {
    const res = await fetch(upstream, { headers: { "X-API-Key": key, "Accept": "application/json" } });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") || "application/json",
        "cache-control": action === "racing" ? "public, max-age=60, s-maxage=60" : "no-store"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Odds API request failed", detail: String(err?.message || err) }), { status: 502, headers: { "content-type": "application/json" } });
  }
};
