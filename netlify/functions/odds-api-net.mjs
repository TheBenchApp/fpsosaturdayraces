// Deployment marker: racing-diagnostic-v2
const BASE = "https://api.odds-api.net/v1";

export default async (request) => {
  const key = Netlify.env.get("ODDS_API_NET_KEY");
  if (!key) return new Response(JSON.stringify({ error: "ODDS_API_NET_KEY is not configured" }), { status: 500, headers: { "content-type": "application/json" } });

  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "me";
  const allowed = new Set(["me","usage","sports","leagues","bookmakers","coverage","racing","racing_diagnostic","card","race","race_odds","events","event_odds"]);
  if (!allowed.has(action)) return new Response(JSON.stringify({ error: "Unsupported action" }), { status: 400, headers: { "content-type": "application/json" } });

  // Build one Australian thoroughbred day-card from Odds API race discovery + racecards.
  // We deliberately discover without race_country because some early AU races have historically
  // arrived with unresolved/missing country labels. Australian state + requested Perth date are
  // the safety filters; no bookmaker market is required for a race to exist.
  if (action === "card") {
    const date = url.searchParams.get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
      return new Response(JSON.stringify({error:"date=YYYY-MM-DD is required"}),{status:400,headers:{"content-type":"application/json","cache-control":"no-store"}});
    }
    const start=Math.floor(new Date(date+"T00:00:00+08:00").getTime()/1000), end=start+86400;
    const auStates=new Set(["WA","VIC","NSW","QLD","SA","TAS","ACT","NT"]);
    const perthDate=ts=>Number.isFinite(Number(ts))?new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Perth",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(Number(ts)*1000)):null;
    const list=[];
    let cursor=null,pages=0;
    try {
      do {
        const u=new URL(BASE+"/racing/events");
        u.searchParams.set("race_type","horse-racing");
        u.searchParams.set("start_from",String(start));
        u.searchParams.set("start_to",String(end));
        u.searchParams.set("limit","100");
        if(cursor)u.searchParams.set("cursor",cursor);
        const r=await fetch(u,{headers:{"X-API-Key":key,"Accept":"application/json"}});
        const p=await r.json().catch(()=>({}));
        if(!r.ok) return new Response(JSON.stringify({error:"Odds API race discovery failed",detail:p.error||("HTTP "+r.status)}),{status:r.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
        const rows=p.items||p.data?.items||p.data||[];
        if(Array.isArray(rows))list.push(...rows);
        cursor=p.next_cursor||p.data?.next_cursor||null; pages++;
      } while(cursor&&pages<20);
      const discovered=list.filter(r=>auStates.has(String(r.race_state||"").toUpperCase())&&perthDate(r.race_start_time)===date);
      const loadOne=async r=>{
        const id=r.event_id;
        const detailUrl=new URL(BASE+"/racing/events/"+encodeURIComponent(id));
        const oddsUrl=new URL(BASE+"/racing/events/"+encodeURIComponent(id)+"/odds");
        const headers={"X-API-Key":key,"Accept":"application/json"};
        const [detailRes,oddsRes]=await Promise.all([fetch(detailUrl,{headers}),fetch(oddsUrl,{headers})]);
        const detailPayload=await detailRes.json().catch(()=>({}));
        const oddsPayload=await oddsRes.json().catch(()=>({}));
        const d=detailPayload.data&&typeof detailPayload.data==="object"?{...detailPayload,...detailPayload.data}:detailPayload;
        const oddsItems=Array.isArray(oddsPayload.items)?oddsPayload.items:[];
        const sportsbet=oddsItems.find(x=>String(x.bookmaker_name||x.bookmaker||"").toLowerCase()==="sportsbet");
        const pricedField=sportsbet?.runners||sportsbet?.payload?.runners||oddsItems.find(x=>Array.isArray(x.runners)||Array.isArray(x.payload?.runners))?.runners||oddsItems.find(x=>Array.isArray(x.payload?.runners))?.payload?.runners||[];
        const rawRunners=d.runners||d.racecard?.runners||d.field||d.entries||pricedField||[];
        const runners=Array.isArray(rawRunners)?rawRunners.map(x=>({
          number:x.runner_number??x.number??x.saddlecloth,
          name:x.runner_name||x.name||x.horse_name||"Runner",
          jockey:x.jockey_name||x.jockey||"",
          trainer:x.trainer_name||x.trainer||"",
          barrier:x.barrier??x.draw??null,
          scratched:Boolean(x.is_scratched??x.scratched??String(x.runner_status||"").toLowerCase()==="scratched"),
          form:x.form||""
        })).filter(x=>x.number!=null):[];
        return {
          event_id:id,
          race_venue:d.race_venue||r.race_venue,
          race_number:d.race_number??r.race_number,
          race_start_time:d.race_start_time??r.race_start_time,
          race_distance:d.race_distance??r.race_distance??null,
          race_state:d.race_state||r.race_state,
          race_name:d.race_name||d.name||r.race_name||("Race "+(d.race_number??r.race_number??"")),
          status:d.status||r.status||null,
          active_runners:oddsPayload.active_runners??d.active_runners??r.active_runners??runners.filter(x=>!x.scratched).length,
          total_runners:oddsPayload.total_runners??d.total_runners??r.total_runners??runners.length,
          runner_count_complete:oddsPayload.runner_count_complete??d.runner_count_complete??r.runner_count_complete??(runners.length>0),
          runners
        };
      };
      const races=[];
      for(let i=0;i<discovered.length;i+=8) races.push(...await Promise.all(discovered.slice(i,i+8).map(loadOne)));
      return new Response(JSON.stringify({date,source:"odds-api-net",discovered_count:discovered.length,races}),{status:200,headers:{"content-type":"application/json","cache-control":"no-store"}});
    } catch(err) {
      return new Response(JSON.stringify({error:"Odds API card load failed",detail:String(err?.message||err)}),{status:502,headers:{"content-type":"application/json","cache-control":"no-store"}});
    }
  }

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
      const countries = [...new Set(safe.map(r=>r.race_country).filter(Boolean))].sort();
      const race_types = [...new Set(safe.map(r=>r.race_type).filter(Boolean))].sort();
      const statuses = [...new Set(safe.map(r=>r.status).filter(Boolean))].sort();
      const states = [...new Set(safe.map(r=>r.race_state).filter(Boolean))].sort();
      const auStateCodes = new Set(["WA","VIC","NSW","QLD","SA","TAS","ACT","NT"]);
      const likelyAu = safe.filter(r => auStateCodes.has(String(r.race_state || "").toUpperCase()));
      return { name, http_status:status, error, pages:page, count:safe.length, perth_dates:dates, selected_date_count:safe.filter(r=>perthDate(r.race_start_time)===date).length, countries, race_types, statuses, states, likely_au_by_state_count:likelyAu.length, likely_au_by_state:likelyAu.slice(0,30).map(r=>({venue:r.race_venue,state:r.race_state,country:r.race_country,type:r.race_type,start:r.race_start_time})) };
    };
    try {
      const results = await Promise.all(variants.map(fetchVariant));
      const labels = {
        exact_au_horse:"Exact AU horse racing",
        exact_horse_no_country:"Exact horse racing, any country",
        exact_au_no_type:"Exact AU racing, any type",
        exact_no_filters:"Exact date, no country/type filters",
        wide_au_horse:"72-hour AU horse racing",
        unbounded_au_horse:"Unbounded AU horse racing",
        unbounded_horse:"Unbounded horse racing, any country"
      };
      const esc = v => String(v ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
      const rows = results.map(r => `<tr><td><strong>${esc(labels[r.name] || r.name)}</strong></td><td>${r.http_status}</td><td>${r.pages}</td><td>${r.count}</td><td><strong>${r.selected_date_count}</strong></td><td>${esc(r.perth_dates.join(", ") || "—")}</td><td>${esc(r.countries.join(", ") || "—")}</td><td>${esc(r.race_types.join(", ") || "—")}</td><td>${esc(r.statuses.join(", ") || "—")}</td><td>${esc(r.states.join(", ") || "—")}</td><td>${r.likely_au_by_state_count}</td><td>${esc(r.error || "—")}</td></tr>`).join("");
      const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Racing Diagnostic</title><style>body{font-family:system-ui,-apple-system,sans-serif;margin:20px;color:#111}h1{font-size:22px}p{font-size:15px}.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:900px}th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}th{background:#f3f3f3}code{background:#f5f5f5;padding:2px 4px;border-radius:4px}</style></head><body><h1>FPSO Racing Catalogue Diagnostic</h1><p>Selected Perth date: <strong>${esc(date)}</strong></p><p>This page contains summary counts only. No API key or runner data is exposed.</p><p><strong>AU labelling check:</strong> exact unfiltered races with an Australian state code: <strong>${esc(results.find(r=>r.name==="exact_no_filters")?.likely_au_by_state_count ?? "—")}</strong></p><div class="wrap"><table><thead><tr><th>Probe</th><th>HTTP</th><th>Pages</th><th>Total</th><th>Selected date</th><th>Perth dates returned</th><th>Countries</th><th>Race types</th><th>Status</th><th>States</th><th>AU-by-state</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table></div></body></html>`;
      return new Response(html, { status:200, headers:{ "content-type":"text/html; charset=utf-8", "cache-control":"no-store" } });
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
