const BASE = "https://api.puntersedge.online/v1";

const htmlEscape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));

export default async (request) => {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
    return new Response("date=YYYY-MM-DD is required", { status:400, headers:{"content-type":"text/plain"} });
  }

  const keyCandidates = ["PUNTERSEDGE_API_KEY","PUNTERS_EDGE_API_KEY","PUNTERSEDGE_KEY","PUNTERS_EDGE_KEY"];
  const keyName = keyCandidates.find(name => Netlify.env.get(name));
  const key = keyName ? Netlify.env.get(keyName) : null;
  if (!key) {
    return new Response(JSON.stringify({error:"PuntersEdge key not found",checked_environment_variable_names:keyCandidates}), {status:500,headers:{"content-type":"application/json","cache-control":"no-store"}});
  }

  const call = async (path, params={}) => {
    const u = new URL(BASE + path);
    Object.entries(params).forEach(([k,v]) => u.searchParams.set(k,String(v)));
    const r = await fetch(u,{headers:{"X-API-Key":key,"Accept":"application/json"}});
    const text = await r.text();
    let body; try { body=JSON.parse(text); } catch { body={raw:text.slice(0,500)}; }
    return {status:r.status,body,headers:{horizon:r.headers.get("X-Horizon-Hours"),used:r.headers.get("X-Horizon-Used-Hours")}};
  };

  try {
    const [acceptances, events, prices] = await Promise.all([
      call("/racing/acceptances",{date}),
      call("/racing/events",{date,categories:"horse",country:"AU",include_unresolved:"true"}),
      call("/racing/next-to-go",{num_races:200,categories:"horse",country:"AU",bookmakers:"sportsbet"})
    ]);

    const acc = acceptances.body || {};
    const meetings = Array.isArray(acc.meetings) ? acc.meetings : [];
    const accRaces = meetings.flatMap(m => Array.isArray(m.races) ? m.races.map(r=>({...r,_venue:m.venue})) : []);
    const eventRows = Array.isArray(events.body) ? events.body : (Array.isArray(events.body?.races) ? events.body.races : []);
    const priceRows = Array.isArray(prices.body) ? prices.body : (Array.isArray(prices.body?.races) ? prices.body.races : []);

    let sportsbetRaces=0, runners=0, win=0, place=0, both=0;
    for (const race of priceRows) {
      let raceHasSportsbet=false;
      for (const runner of (race.runners || [])) {
        runners++;
        const sb=(runner.bookmakers || []).find(b=>String(b.key || "").toLowerCase()==="sportsbet");
        if (!sb) continue;
        raceHasSportsbet=true;
        const hasWin=Number.isFinite(Number(sb.win_price));
        const hasPlace=Number.isFinite(Number(sb.place_price));
        if (hasWin) win++;
        if (hasPlace) place++;
        if (hasWin && hasPlace) both++;
      }
      if (raceHasSportsbet) sportsbetRaces++;
    }

    const meetingNames=meetings.map(m=>m.venue).filter(Boolean);
    const summary = [
      ["Environment key found", keyName],
      ["Acceptances HTTP", acceptances.status],
      ["Acceptance date/status", [acc.date,acc.date_status].filter(Boolean).join(" / ") || "—"],
      ["Acceptance meetings", acc.meeting_count ?? meetings.length],
      ["Acceptance races", acc.race_count ?? accRaces.length],
      ["Acceptance runners", acc.runner_count ?? "—"],
      ["Meetings", meetingNames.join(", ") || "—"],
      ["Events HTTP", events.status],
      ["Events returned", eventRows.length],
      ["Events horizon", events.headers.horizon ? events.headers.horizon+"h" : "—"],
      ["Sportsbet next-to-go HTTP", prices.status],
      ["Priced AU horse races returned", priceRows.length],
      ["Races with Sportsbet", sportsbetRaces],
      ["Runner rows checked", runners],
      ["Sportsbet WIN prices", win],
      ["Sportsbet PLACE prices", place],
      ["Sportsbet WIN + PLACE", both]
    ];

    const errorText = obj => obj.status >= 400 ? htmlEscape(JSON.stringify(obj.body).slice(0,1000)) : "—";
    const rows=summary.map(([a,b])=>`<tr><th>${htmlEscape(a)}</th><td>${htmlEscape(b)}</td></tr>`).join("");
    const page=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>PuntersEdge Diagnostic</title><style>body{font-family:system-ui,-apple-system,sans-serif;margin:20px;color:#111}h1{font-size:24px}table{border-collapse:collapse;width:100%;max-width:900px}th,td{border:1px solid #ccc;padding:9px;text-align:left;vertical-align:top}th{background:#f3f3f3;width:48%}.err{max-width:900px;overflow-wrap:anywhere;background:#fafafa;padding:10px}</style></head><body><h1>FPSO PuntersEdge Diagnostic</h1><p>Target AET meeting date: <strong>${htmlEscape(date)}</strong></p><p>Read-only provider test. No FPSO races, odds, selections or database records are changed.</p><table>${rows}</table><h2>Endpoint errors</h2><p><strong>Acceptances:</strong></p><div class="err">${errorText(acceptances)}</div><p><strong>Events:</strong></p><div class="err">${errorText(events)}</div><p><strong>Next-to-go:</strong></p><div class="err">${errorText(prices)}</div></body></html>`;
    return new Response(page,{status:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
  } catch (err) {
    return new Response(JSON.stringify({error:"PuntersEdge diagnostic failed",detail:String(err?.message || err)}),{status:502,headers:{"content-type":"application/json","cache-control":"no-store"}});
  }
};
