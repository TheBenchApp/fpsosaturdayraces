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
    const accRunnerRows = accRaces.flatMap(r => Array.isArray(r.runners) ? r.runners.map(x=>({...x,_race_id:r.race_id,_venue:r._venue,_race_number:r.race_number})) : []);
    const eventRows = Array.isArray(events.body) ? events.body : (Array.isArray(events.body?.races) ? events.body.races : []);
    const priceRows = Array.isArray(prices.body) ? prices.body : (Array.isArray(prices.body?.races) ? prices.body.races : []);

    const liveByRaceId = new Map(priceRows.filter(r=>r.race_id).map(r=>[String(r.race_id),r]));
    const acceptanceRaceIds = accRaces.map(r=>String(r.race_id || "")).filter(Boolean);
    const matchedRaceIds = acceptanceRaceIds.filter(id=>liveByRaceId.has(id));
    const acceptanceRunnerRefs = new Set(accRunnerRows.map(r=>String(r.runner_ref || "")).filter(Boolean));
    const liveRunnerRefs = new Set(priceRows.flatMap(r=>r.runners || []).map(r=>String(r.runner_ref || "")).filter(Boolean));
    const matchedRunnerRefs = [...acceptanceRunnerRefs].filter(ref=>liveRunnerRefs.has(ref));

    const norm = v => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g,"");
    const liveRaceByRunnerRef = new Map();
    for (const race of priceRows) {
      for (const runner of (race.runners || [])) {
        if (runner.runner_ref) liveRaceByRunnerRef.set(String(runner.runner_ref), race);
      }
    }
    const reconciliation = accRaces.map(race => {
      const refs=(race.runners || []).map(x=>String(x.runner_ref || "")).filter(Boolean);
      const candidates=new Map();
      for (const ref of refs) {
        const live=liveRaceByRunnerRef.get(ref);
        if (live) candidates.set(String(live.race_id || live.id || ""),live);
      }
      const live=[...candidates.values()][0] || null;
      const liveRefs=new Set((live?.runners || []).map(x=>String(x.runner_ref || "")).filter(Boolean));
      const refMatches=refs.filter(ref=>liveRefs.has(ref)).length;
      const sbBoth=(live?.runners || []).filter(r=>{
        const sb=(r.bookmakers || []).find(b=>String(b.key || "").toLowerCase()==="sportsbet");
        return sb && Number.isFinite(Number(sb.win_price)) && Number.isFinite(Number(sb.place_price));
      }).length;
      return {
        venue:race._venue || race.venue || "",
        race_number:race.race_number ?? race.number ?? "",
        acceptance_runners:refs.length,
        candidate_live_races:candidates.size,
        matched:!!live,
        live_race_id:live?.race_id || live?.id || "",
        live_venue:live?.venue || "",
        live_race_number:live?.race_number ?? live?.number ?? "",
        runner_ref_matches:refMatches,
        live_runner_refs:liveRefs.size,
        sportsbet_both:sbBoth,
        venue_agrees:live ? norm(race._venue || race.venue)===norm(live.venue) : false,
        number_agrees:live ? String(race.race_number ?? race.number ?? "")===String(live.race_number ?? live.number ?? "") : false
      };
    });
    const reconciled=reconciliation.filter(x=>x.matched);
    const exactVenueNumber=reconciled.filter(x=>x.venue_agrees && x.number_agrees);
    const unambiguous=reconciled.filter(x=>x.candidate_live_races===1);
    const fullRefCoverage=reconciled.filter(x=>x.acceptance_runners>0 && x.runner_ref_matches===x.acceptance_runners);
    const reconciledSportsbetBoth=reconciled.reduce((n,x)=>n+x.sportsbet_both,0);

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
      ["Acceptance races (API top-level)", acc.race_count ?? "—"],
      ["Acceptance races parsed", accRaces.length],
      ["Acceptance runners (API top-level)", acc.runner_count ?? "—"],
      ["Acceptance runners parsed", accRunnerRows.length],
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
      ["Sportsbet WIN + PLACE", both],
      ["Acceptance race IDs present", acceptanceRaceIds.length],
      ["Acceptance race IDs already in live prices", matchedRaceIds.length],
      ["Acceptance runner_refs present", acceptanceRunnerRefs.size],
      ["Acceptance runner_refs already in live prices", matchedRunnerRefs.length],
      ["Acceptance races reconciled to a live race", reconciled.length + " / " + accRaces.length],
      ["Reconciled races with exactly 1 candidate", unambiguous.length + " / " + reconciled.length],
      ["Reconciled races where venue + race no. agree", exactVenueNumber.length + " / " + reconciled.length],
      ["Reconciled races with 100% acceptance runner_ref coverage", fullRefCoverage.length + " / " + reconciled.length],
      ["Sportsbet WIN+PLACE runner rows on reconciled races", reconciledSportsbetBoth],
      ["Identity strategy", "Acceptances runner_ref -> live race; verify venue/race number; then persist live race_id"]
    ];

    const errorText = obj => obj.status >= 400 ? htmlEscape(JSON.stringify(obj.body).slice(0,1000)) : "—";
    const rows=summary.map(([a,b])=>`<tr><th>${htmlEscape(a)}</th><td>${htmlEscape(b)}</td></tr>`).join("");
    const matchRows=reconciliation.map(x=>`<tr><td>${htmlEscape(x.venue)}</td><td>${htmlEscape(x.race_number)}</td><td>${x.acceptance_runners}</td><td>${x.candidate_live_races}</td><td>${htmlEscape(x.live_race_id || "—")}</td><td>${x.runner_ref_matches}/${x.acceptance_runners}</td><td>${x.sportsbet_both}</td><td>${x.venue_agrees && x.number_agrees ? "YES" : (x.matched ? "CHECK" : "—")}</td></tr>`).join("");
    const page=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>PuntersEdge Diagnostic</title><style>body{font-family:system-ui,-apple-system,sans-serif;margin:20px;color:#111}h1{font-size:24px}table{border-collapse:collapse;width:100%;max-width:900px}th,td{border:1px solid #ccc;padding:9px;text-align:left;vertical-align:top}th{background:#f3f3f3;width:48%}.err{max-width:900px;overflow-wrap:anywhere;background:#fafafa;padding:10px}</style></head><body><h1>FPSO PuntersEdge Diagnostic</h1><p>Target AET meeting date: <strong>${htmlEscape(date)}</strong></p><p>Read-only provider test. No FPSO races, odds, selections or database records are changed.</p><table>${rows}</table><h2>Race reconciliation</h2><table><tr><th>Acceptance race</th><th>No.</th><th>Acc refs</th><th>Live candidates</th><th>Live race_id</th><th>Ref matches</th><th>SB W+P</th><th>Venue/no.</th></tr>${matchRows}</table><h2>Endpoint errors</h2><p><strong>Acceptances:</strong></p><div class="err">${errorText(acceptances)}</div><p><strong>Events:</strong></p><div class="err">${errorText(events)}</div><p><strong>Next-to-go:</strong></p><div class="err">${errorText(prices)}</div></body></html>`;
    return new Response(page,{status:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
  } catch (err) {
    return new Response(JSON.stringify({error:"PuntersEdge diagnostic failed",detail:String(err?.message || err)}),{status:502,headers:{"content-type":"application/json","cache-control":"no-store"}});
  }
};
