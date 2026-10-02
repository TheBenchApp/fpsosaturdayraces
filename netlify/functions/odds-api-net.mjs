// Deployment marker: racing-diagnostic-v2
const BASE = "https://api.odds-api.net/v1";

export default async (request) => {
  const key = Netlify.env.get("ODDS_API_NET_KEY");
  if (!key) return new Response(JSON.stringify({ error: "ODDS_API_NET_KEY is not configured" }), { status: 500, headers: { "content-type": "application/json" } });

  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "me";
  const allowed = new Set(["me","usage","sports","leagues","bookmakers","coverage","racing","racing_diagnostic","race","race_odds","events","event_odds"]);
  if (!allowed.has(action)) return new Response(JSON.stringify({ error: "Unsupported action" }), { status: 400, headers: { "content-type": "application/json" } });

  // Temporary admin diagnostic for future-race discovery. It intentionally returns
  // only non-sensitive catalogue metadata and never exposes the provider API key.
  if (action === "racing_diagnostic") {
    const date = url.searchParams.get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
      return new Response(JSON.stringify({ error: "date=YYYY-MM-DD is required" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    const start = Math.floor(new Date(date + "T00:00:00+08:00").getTime() / 1000);
    const end = start + 86400;
    const variants = [
      { name:"exact_au_horse", params:{ race_type:"horse-racing", race_country:"AU", start_from:start, start_to:end } },
      { name:"exact_horse_no_country", params:{ race_type:"horse-racing", start_from:start, start_to:end } },
      { name:"exact_au_no_type", params:{ race_country:"AU", start_from:start, start_to:end } },
      { name:"exact_no_filters", params:{ start_from:start, start_to:end } },
      { name:"wide_au_horse", params:{ race_type:"horse-racing", race_country:"AU", start_from:start-86400, start_to:end+86400 } },
      { name:"unbounded_au_horse", params:{ race_type:"horse-racing", race_country:"AU" } },
      { name:"unbounded_horse", params:{ race_type:"horse-racing" } }
    ];
    const fetchVariant = async ({name, params}) => {
      let cursor = null, page = 0, rows = [], status = 200, error = null;
      do {
        const u = new URL(BASE + "/racing/events");
        for (const [k,v] of Object.entries(params)) u.searchParams.set(k, String(v));
        u.searchParams.set("limit","100");
        u.searchParams.set("include_source","true");
        u.searchParams.set("include_links","true");
        if (cursor) u.searchParams.set("cursor",cursor);
        const r = await fetch(u, { headers:{ "X-API-Key":key, "Accept":"application/json" } });
        status = r.status;
        const p = await r.json().catch(()=>({}));
        if (!r.ok) { error = p.error || ("HTTP " + r.status); break; }
        const items = p.items || p.data?.items || p.data || [];
        if (Array.isArray(items)) rows.push(...items);
        cursor = p.next_cursor || p.data?.next_cursor || null;
        page++;
      } while (cursor && page < 20);
      const safe = rows.map(r => ({
        event_id:r.event_id, race_type:r.race_type, race_country:r.race_country, race_state:r.race_state,
        status:r.status, race_start_time:r.race_start_time, race_venue:r.race_venue, race_number:r.race_number,
        active_runners:r.active_runners, total_runners:r.total_runners,
        bookmaker_names:Array.isArray(r.bookmakers) ? r.bookmakers.map(b => b.bookmaker_name || b.name).filter(Boolean) : undefined
      }));
      const perthDate = ts => Number.isFinite(Number(ts)) ? new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Perth",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(Number(ts)*1000)) : null;
      const dates = [...new Set(safe.map(r=>perthDate(r.race_start_time)).filter(Boolean))].sort();
      return { name, http_status:status, error, pages:page, count:safe.length, perth_dates:dates, selected_date_count:safe.filter(r=>perthDate(r.race_start_time)===date).length, items:safe };
    };
    try {
      const results = await Promise.all(variants.map(fetchVariant));
      return new Response(JSON.stringify({ date, start, end, results }), { status:200, headers:{ "content-type":"application/json", "cache-control":"no-store" } });
    } catch (err) {
      return new Response(JSON.stringify({ error:"Racing diagnostic failed", detail:String(err?.message || err) }), { status:502, headers:{ "content-type":"application/json" } });
    }
  }

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
