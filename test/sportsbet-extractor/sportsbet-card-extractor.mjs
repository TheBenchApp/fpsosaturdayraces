// Isolated Sportsbet card parser/validator. NOT wired to production.
const clean=s=>String(s??"").replace(/\s+/g," ").trim();
const int=v=>{const n=Number.parseInt(String(v??"").replace(/\D/g,""),10);return Number.isFinite(n)?n:null};
const decode=s=>clean(String(s??"").replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,"<").replace(/&gt;/g,">"));


export function extractSportsbetAllRacing(payload, wantedDate){
  const meetings=[];
  const dates=Array.isArray(payload?.dates)?payload.dates:[];
  for(const dateBlock of dates){
    for(const section of dateBlock?.sections||[]){
      if(String(section?.raceType||"").toLowerCase()!=="horse" && String(section?.displayName||"").toLowerCase()!=="horses") continue;
      for(const m of section?.meetings||[]){
        if(m?.isInternational || String(m?.regionName||"").toLowerCase()!=="australia") continue;
        const races=(m?.events||[]).map(e=>({
          source:"sportsbet-api",
          venue:clean(m.name),
          race_number:Number(e.raceNumber),
          sportsbet_race_id:String(e.id??""),
          sportsbet_url:e.httpLink?new URL(String(e.httpLink).replace(/^\/+/, ""), "https://www.sportsbet.com.au/").href:"",
          race_name:clean(e.name).replace(/^R\d+\s*/i,""),
          distance:Number.parseInt(e.distance,10)||null,
          start_time:Number.isFinite(Number(e.startTime))?new Date(Number(e.startTime)*1000).toISOString():null,
          runners:[],
          sportsbet_competition_id:String(m.id??""),
          source_date:wantedDate||null
        })).sort((a,b)=>a.race_number-b.race_number);
        meetings.push({venue:clean(m.name),sportsbet_competition_id:String(m.id??""),expected_race_count:races.length,races});
      }
    }
  }
  return meetings;
}

export function attachSportsbetRacecard(race, payload){
  const event=payload?.racecardEvent||payload;
  if(!event || Number(event.id)!==Number(race?.sportsbet_race_id)) return {...race,runners:[],racecard_error:"event_id_mismatch"};
  const market=(event.markets||[]).find(m=>String(m?.name||"").toLowerCase()==="win or place") || (event.markets||[]).find(m=>Array.isArray(m?.selections));
  const runners=(market?.selections||[]).map(s=>({
    runner_number:Number(s.runnerNumber),
    horse_name:clean(s.name),
    barrier:Number.isFinite(Number(s.drawNumber))?Number(s.drawNumber):null,
    jockey:clean(s.jockey),
    trainer:clean(s.trainer),
    scratched:Boolean(s.isOut)||String(s.statusCode||"").toUpperCase()==="S"
  })).sort((a,b)=>a.runner_number-b.runner_number);
  return {
    ...race,
    race_name:clean(event.name||race.race_name).replace(/^R\d+\s*/i,""),
    distance:Number.parseInt(event.distance,10)||race.distance,
    start_time:Number.isFinite(Number(event.startTime))?new Date(Number(event.startTime)*1000).toISOString():race.start_time,
    runners
  };
}

export function perthDisplayTime(iso){
  if(!iso) return null;
  return new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Perth",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(iso));
}

export function extractMeetingRaceLinks(html, baseUrl="https://www.sportsbet.com.au"){
  const out=new Map();
  const re=/href=["']([^"']*\/horse-racing\/australia-nz\/[^"']*\/race-(\d+)-(\d+)[^"']*)["']/gi;
  let m; while((m=re.exec(html||""))){
    const raceNumber=Number(m[2]), raceId=m[3];
    const url=new URL(decode(m[1]),baseUrl).href;
    if(!out.has(raceNumber)) out.set(raceNumber,{race_number:raceNumber,sportsbet_race_id:raceId,url});
  }
  return [...out.values()].sort((a,b)=>a.race_number-b.race_number);
}

function textAround(html,label,max=220){
  const i=String(html||"").toLowerCase().indexOf(String(label).toLowerCase());
  return i<0?"":decode(String(html).slice(i, i+max).replace(/<[^>]*>/g," "));
}

export function extractRacePage(html,url=""){
  const source=String(html||"");
  const u=String(url||"");
  const um=u.match(/\/([^/]+)\/race-(\d+)-(\d+)/i);
  const venue=um?um[1].replace(/-/g," "):"";
  const raceNumber=um?Number(um[2]):null;
  const raceId=um?um[3]:"";
  const title=(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"";
  const distanceMatch=source.match(/\b(\d{3,4})m\b/i);
  const runnerMap=new Map();

  // Prefer semantic Sportsbet automation attributes; fallback scans runner-like text blocks.
  const blocks=[...source.matchAll(/<[^>]+data-automation-id=["'][^"']*(?:runner|selection)[^"']*["'][^>]*>[\s\S]{0,5000}?(?=<[^>]+data-automation-id=["'][^"']*(?:runner|selection)|$)/gi)].map(x=>x[0]);
  const candidates=blocks.length?blocks:[...source.matchAll(/(?:runner|selection)[\s\S]{0,1800}/gi)].map(x=>x[0]);
  for(const block of candidates){
    const plain=decode(block.replace(/<[^>]*>/g," "));
    const nm=plain.match(/(?:^|\s)(\d{1,2})\.?\s+([A-Z][A-Za-z0-9'’(). -]{1,60}?)(?=\s+(?:\(|Barrier|Jockey|Trainer|Scratched|SCR|\$|$))/i);
    if(!nm) continue;
    const number=Number(nm[1]); if(!number||number>30) continue;
    const name=clean(nm[2]);
    const barrier=(plain.match(/(?:Barrier|Bar)\s*[:#]?\s*(\d{1,2})/i)||[])[1]||null;
    const jockey=(plain.match(/Jockey\s*:?\s*([A-Za-z .'-]{2,50})/i)||[])[1]||"";
    const trainer=(plain.match(/Trainer\s*:?\s*([A-Za-z .'-]{2,50})/i)||[])[1]||"";
    const scratched=/\b(scratched|scr)\b/i.test(plain);
    if(!runnerMap.has(number)) runnerMap.set(number,{runner_number:number,horse_name:name,barrier:barrier?Number(barrier):null,jockey:clean(jockey),trainer:clean(trainer),scratched});
  }

  return {
    source:"sportsbet", venue:decode(venue), race_number:raceNumber,
    sportsbet_race_id:raceId, sportsbet_url:u,
    race_name:decode(title).replace(/\s*\|.*$/,"").trim(),
    distance:distanceMatch?Number(distanceMatch[1]):null,
    start_time:null, runners:[...runnerMap.values()].sort((a,b)=>a.runner_number-b.runner_number),
    diagnostics:{semantic_blocks:blocks.length,title:decode(title),time_hint:textAround(source,"start")}
  };
}

export function validateRace(race){
  const errors=[], warnings=[];
  if(!race||typeof race!=="object") return {ok:false,errors:["race_missing"],warnings};
  if(!Number.isInteger(race.race_number)||race.race_number<1||race.race_number>20) errors.push("invalid_race_number");
  if(!/^\d+$/.test(String(race.sportsbet_race_id||""))) errors.push("invalid_sportsbet_race_id");
  if(!clean(race.venue)) errors.push("missing_venue");
  if(!Array.isArray(race.runners)||race.runners.length<2) errors.push("runner_count_too_low");
  const nums=new Set(), names=new Set();
  for(const r of race.runners||[]){
    if(!Number.isInteger(r.runner_number)||r.runner_number<1||r.runner_number>30) errors.push("invalid_runner_number");
    if(nums.has(r.runner_number)) errors.push("duplicate_runner_number"); nums.add(r.runner_number);
    const n=clean(r.horse_name).toLowerCase();
    if(!n) errors.push("missing_horse_name");
    if(n&&names.has(n)) errors.push("duplicate_horse_name"); if(n) names.add(n);
  }
  if(!race.start_time) warnings.push("start_time_unresolved");
  if(!race.distance) warnings.push("distance_unresolved");
  return {ok:errors.length===0,errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
}

export function validateMeeting(meeting){
  const errors=[],warnings=[];
  const races=Array.isArray(meeting?.races)?meeting.races:[];
  if(!clean(meeting?.venue)) errors.push("missing_meeting_venue");
  if(!races.length) errors.push("meeting_has_no_races");
  const nums=new Set(), ids=new Set();
  for(const race of races){
    const v=validateRace(race);
    if(!v.ok) errors.push(...v.errors.map(e=>`R${race?.race_number??"?"}:${e}`));
    warnings.push(...v.warnings.map(e=>`R${race?.race_number??"?"}:${e}`));
    if(nums.has(race.race_number)) errors.push("duplicate_race_number"); nums.add(race.race_number);
    if(ids.has(race.sportsbet_race_id)) errors.push("duplicate_sportsbet_race_id"); ids.add(race.sportsbet_race_id);
  }
  if(races.length){
    const sorted=[...nums].sort((a,b)=>a-b);
    for(let n=1;n<=sorted[sorted.length-1];n++) if(!nums.has(n)) errors.push(`missing_race_${n}`);
  }
  const expected=Number(meeting?.expected_race_count);
  if(Number.isInteger(expected)&&expected>0&&races.length!==expected) errors.push(`race_count_mismatch_expected_${expected}_got_${races.length}`);
  return {ok:errors.length===0,status:errors.length?"AU CARD INCOMPLETE":"OK",auto_generate_enabled:errors.length===0,errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
}

export function reconcileIdentity(primary, secondary){
  const norm=s=>clean(s).toLowerCase().replace(/[^a-z0-9]/g,"");
  if(Number(primary?.runner_number)!==Number(secondary?.runner_number)) return {ok:false,reason:"runner_number_mismatch"};
  if(norm(primary?.horse_name)!==norm(secondary?.horse_name)) return {ok:false,reason:"horse_identity_conflict"};
  return {ok:true};
}
