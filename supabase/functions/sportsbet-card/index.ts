const SPORTSBET_BASE = "https://www.sportsbet.com.au/apigw/sportsbook-racing/Sportsbook/Racing";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "GET, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
});

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

function validateRace(race: any) {
  const errors: string[] = [];
  if (!Number.isInteger(race?.race_number) || race.race_number < 1 || race.race_number > 20) errors.push("invalid_race_number");
  if (!/^\d+$/.test(String(race?.sportsbet_race_id || ""))) errors.push("invalid_sportsbet_race_id");
  if (!clean(race?.venue)) errors.push("missing_venue");
  if (!race?.start_time || Number.isNaN(new Date(race.start_time).getTime())) errors.push("missing_or_invalid_start_time");
  if (!race?.distance || race.distance < 500 || race.distance > 5000) errors.push("missing_or_invalid_distance");
  if (!clean(race?.race_name)) errors.push("missing_race_name");
  if (!Array.isArray(race?.runners) || race.runners.length < 2) errors.push("runner_count_too_low");
  const nums = new Set<number>(), names = new Set<string>();
  for (const r of race?.runners || []) {
    if (!Number.isInteger(r.runner_number) || r.runner_number < 1 || r.runner_number > 30) errors.push("invalid_runner_number");
    if (nums.has(r.runner_number)) errors.push("duplicate_runner_number");
    nums.add(r.runner_number);
    const name = clean(r.horse_name).toLowerCase();
    if (!name) errors.push("missing_horse_name");
    if (name && names.has(name)) errors.push("duplicate_horse_name");
    if (name) names.add(name);
  }
  return [...new Set(errors)];
}

function validateMeeting(meeting: any) {
  const errors: string[] = [];
  const races = Array.isArray(meeting?.races) ? meeting.races : [];
  if (!clean(meeting?.venue)) errors.push("missing_meeting_venue");
  if (!races.length) errors.push("meeting_has_no_races");
  const nums = new Set<number>(), ids = new Set<string>();
  for (const race of races) {
    for (const e of validateRace(race)) errors.push(`R${race?.race_number ?? "?"}:${e}`);
    if (nums.has(race.race_number)) errors.push("duplicate_race_number");
    nums.add(race.race_number);
    if (ids.has(race.sportsbet_race_id)) errors.push("duplicate_sportsbet_race_id");
    ids.add(race.sportsbet_race_id);
  }
  if (races.length) {
    const max = Math.max(...nums);
    for (let n = 1; n <= max; n++) if (!nums.has(n)) errors.push(`missing_race_${n}`);
  }
  const expected = Number(meeting?.expected_race_count);
  if (Number.isInteger(expected) && expected > 0 && races.length !== expected) errors.push(`race_count_mismatch_expected_${expected}_got_${races.length}`);
  const unique = [...new Set(errors)];
  return { ok: unique.length === 0, status: unique.length ? "AU CARD INCOMPLETE" : "OK", auto_generate_enabled: unique.length === 0, errors: unique };
}

async function sportsbet(path: string) {
  const res = await fetch(SPORTSBET_BASE + path, {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 (compatible; FPSO-RaceCard/1.0)",
      "origin": "https://www.sportsbet.com.au",
      "referer": "https://www.sportsbet.com.au/",
    },
  });
  if (!res.ok) throw new Error(`Sportsbet ${res.status} ${res.statusText}: ${path}`);
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const date = url.searchParams.get("date") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: "Valid YYYY-MM-DD date required" }, 400);

  try {
    const payload: any = await sportsbet(`/AllRacing/${date}`);
    const meetings: any[] = [];
    for (const dateBlock of payload?.dates || []) {
      for (const section of dateBlock?.sections || []) {
        if (String(section?.raceType || "").toLowerCase() !== "horse" && String(section?.displayName || "").toLowerCase() !== "horses") continue;
        for (const m of section?.meetings || []) {
          if (m?.isInternational || String(m?.regionName || "").toLowerCase() !== "australia") continue;
          const meeting: any = {
            venue: clean(m.name),
            sportsbet_competition_id: String(m.id ?? ""),
            expected_race_count: Array.isArray(m.events) ? m.events.length : 0,
            races: [],
          };
          for (const e of (m.events || []).sort((a: any,b: any)=>Number(a.raceNumber)-Number(b.raceNumber))) {
            const race: any = {
              source: "sportsbet-api",
              venue: clean(m.name),
              race_number: Number(e.raceNumber),
              sportsbet_race_id: String(e.id ?? ""),
              sportsbet_competition_id: String(m.id ?? ""),
              race_name: clean(e.name).replace(/^R\d+\s*/i, ""),
              distance: Number.parseInt(e.distance, 10) || null,
              start_time: Number.isFinite(Number(e.startTime)) ? new Date(Number(e.startTime) * 1000).toISOString() : null,
              runners: [],
            };
            try {
              const card: any = await sportsbet(`/Events/${race.sportsbet_race_id}/Racecard`);
              const event = card?.racecardEvent || card;
              if (!event || Number(event.id) !== Number(race.sportsbet_race_id)) {
                race.racecard_error = "event_id_mismatch";
              } else {
                const market = (event.markets || []).find((x: any)=>String(x?.name||"").toLowerCase()==="win or place") ||
                  (event.markets || []).find((x: any)=>Array.isArray(x?.selections));
                race.runners = (market?.selections || []).map((s: any)=>({
                  runner_number: Number(s.runnerNumber),
                  horse_name: clean(s.name),
                  barrier: Number.isFinite(Number(s.drawNumber)) ? Number(s.drawNumber) : null,
                  jockey: clean(s.jockey),
                  trainer: clean(s.trainer),
                  scratched: Boolean(s.isOut) || String(s.statusCode || "").toUpperCase() === "S",
                })).sort((a:any,b:any)=>a.runner_number-b.runner_number);
              }
            } catch (e) {
              race.racecard_error = String(e instanceof Error ? e.message : e);
            }
            meeting.races.push(race);
          }
          meeting.validation = validateMeeting(meeting);
          meetings.push(meeting);
        }
      }
    }

    const errors = meetings.filter(m=>!m.validation.ok);
    return json({
      ok: errors.length === 0,
      provider: "Sportsbet",
      source_date: date,
      execution_region: Deno.env.get("SB_REGION") || null,
      status: errors.length ? "AU CARD INCOMPLETE" : "OK",
      auto_generate_enabled: errors.length === 0,
      meetings,
      diagnostics: {
        meeting_count: meetings.length,
        race_count: meetings.reduce((n,m)=>n+m.races.length,0),
        invalid_meetings: errors.map(m=>({ venue:m.venue, errors:m.validation.errors })),
      },
    }, errors.length ? 422 : 200);
  } catch (e) {
    return json({ ok:false, provider:"Sportsbet", status:"AU CARD INCOMPLETE", auto_generate_enabled:false, error:String(e instanceof Error ? e.message : e), execution_region:Deno.env.get("SB_REGION") || null }, 502);
  }
});
