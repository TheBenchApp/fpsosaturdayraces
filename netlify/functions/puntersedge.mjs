const BASE = "https://api.puntersedge.online/v1";
const keyNames = ["PUNTERSEDGE_API_KEY","PUNTERS_EDGE_API_KEY","PUNTERSEDGE_KEY","PUNTERS_EDGE_KEY"];

export default async (request) => {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const keyName = keyNames.find(name => Netlify.env.get(name));
  const key = keyName ? Netlify.env.get(keyName) : null;
  if (!key) return new Response(JSON.stringify({error:"PuntersEdge API key is not configured"}),{status:500,headers:{"content-type":"application/json","cache-control":"no-store"}});

  let path;
  if (action === "acceptances") path = "/racing/acceptances";
  else if (action === "next_to_go") path = "/racing/next-to-go";
  else if (action === "results") path = "/racing/results";
  else return new Response(JSON.stringify({error:"Unsupported PuntersEdge action"}),{status:400,headers:{"content-type":"application/json","cache-control":"no-store"}});

  const upstream = new URL(BASE + path);
  for (const [k,v] of url.searchParams.entries()) if (k !== "action") upstream.searchParams.append(k,v);
  if (action === "next_to_go") {
    if (!upstream.searchParams.has("num_races")) upstream.searchParams.set("num_races","200");
    if (!upstream.searchParams.has("categories")) upstream.searchParams.set("categories","horse");
    if (!upstream.searchParams.has("bookmakers")) upstream.searchParams.set("bookmakers","sportsbet");
    if (!upstream.searchParams.has("country")) upstream.searchParams.set("country","AU");
    if (!upstream.searchParams.has("include_unresolved")) upstream.searchParams.set("include_unresolved","true");
  }

  try {
    const res = await fetch(upstream,{headers:{"X-API-Key":key,"Accept":"application/json"}});
    const body = await res.text();

    // Acceptances are the authoritative field/runner card, but PuntersEdge documents
    // /racing/events as the authoritative source for advertised start_time.
    // Enrich acceptance races with event times so cards remain usable before markets
    // have populated timing on the acceptance rows themselves.
    if (action === "acceptances" && res.ok) {
      let acceptances;
      try { acceptances = JSON.parse(body); } catch { acceptances = null; }
      const date = url.searchParams.get("date");
      if (acceptances && Array.isArray(acceptances.meetings) && /^\\d{4}-\\d{2}-\\d{2}$/.test(date || "")) {
        const eventsUrl = new URL(BASE + "/racing/events");
        // A whole-date request can 403 until the end of that AET day fits inside the plan horizon.
        // A rolling 24h request enriches whichever races are currently reachable; acceptances local
        // time remains the authoritative early-card fallback for races beyond the events horizon.
        eventsUrl.searchParams.set("hours_ahead", "24");
        eventsUrl.searchParams.set("categories", "horse");
        eventsUrl.searchParams.set("country", "AU");
        eventsUrl.searchParams.set("include_unresolved", "true");
        const eventsRes = await fetch(eventsUrl,{headers:{"X-API-Key":key,"Accept":"application/json"}});
        if (eventsRes.ok) {
          const eventsBody = await eventsRes.json();
          const events = Array.isArray(eventsBody) ? eventsBody : (Array.isArray(eventsBody?.races) ? eventsBody.races : []);
          const norm = v => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g,"");
          const byId = new Map(events.filter(e=>e.race_id).map(e=>[String(e.race_id),e]));
          const byVenueNumber = new Map(events.map(e=>[norm(e.venue)+":"+String(e.race_number ?? e.number ?? ""),e]));
          for (const meeting of acceptances.meetings) {
            for (const race of (meeting.races || [])) {
              const event = (race.race_id && byId.get(String(race.race_id))) ||
                byVenueNumber.get(norm(meeting.venue || race.venue)+":"+String(race.race_number ?? race.number ?? ""));
              if (event?.start_time) race.start_time = event.start_time;
            }
          }
        }
        return new Response(JSON.stringify(acceptances),{status:res.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
      }
    }

    return new Response(body,{status:res.status,headers:{"content-type":res.headers.get("content-type") || "application/json","cache-control":"no-store"}});
  } catch (err) {
    return new Response(JSON.stringify({error:"PuntersEdge request failed",detail:String(err?.message || err)}),{status:502,headers:{"content-type":"application/json","cache-control":"no-store"}});
  }
};
