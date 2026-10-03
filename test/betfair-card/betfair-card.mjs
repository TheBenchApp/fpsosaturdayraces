// Isolated Betfair race-card normaliser/validator. Not wired to production.
const clean=v=>String(v??"").replace(/\s+/g," ").trim();
const n=v=>Number.isFinite(Number(v))?Number(v):null;

export function normalizeBetfairCatalogue(catalogue){
  const byEvent=new Map();
  for(const market of Array.isArray(catalogue)?catalogue:[]){
    const eventId=String(market?.event?.id??"");
    const venue=clean(market?.event?.venue||market?.event?.name).replace(/\s*\(AUS\).*$/i,"");
    const raceMatch=clean(market?.marketName).match(/^R(\d+)\s+(\d{3,4})m\b/i);
    if(!eventId||!venue||!raceMatch) continue;
    const raceNumber=Number(raceMatch[1]);
    const distance=Number(raceMatch[2]);
    const runners=(market.runners||[]).map(r=>{
      const rm=clean(r.runnerName).match(/^(\d+)\.\s*(.+)$/);
      const md=r.metadata||{};
      return {
        runner_number:rm?Number(rm[1]):n(md.CLOTH_NUMBER),
        horse_name:rm?clean(rm[2]):clean(r.runnerName),
        barrier:n(md.STALL_DRAW),
        jockey:clean(md.JOCKEY_NAME),
        trainer:clean(md.TRAINER_NAME),
        betfair_selection_id:String(r.selectionId??"")
      };
    }).sort((a,b)=>a.runner_number-b.runner_number);
    const race={
      source:"betfair",
      betfair_event_id:eventId,
      betfair_market_id:String(market.marketId??""),
      venue,race_number:raceNumber,distance,
      race_name:clean(market.marketName),
      start_time:market.marketStartTime||null,
      runners
    };
    if(!byEvent.has(eventId)) byEvent.set(eventId,{venue,betfair_event_id:eventId,races:[]});
    byEvent.get(eventId).races.push(race);
  }
  return [...byEvent.values()].map(m=>({...m,races:m.races.sort((a,b)=>a.race_number-b.race_number)}));
}

export function validateBetfairMeeting(meeting){
  const errors=[];
  const races=Array.isArray(meeting?.races)?meeting.races:[];
  if(!clean(meeting?.venue)) errors.push("missing_meeting_venue");
  if(!races.length) errors.push("meeting_has_no_races");
  const nums=new Set(), ids=new Set();
  for(const r of races){
    if(!Number.isInteger(r.race_number)||r.race_number<1) errors.push("invalid_race_number");
    if(nums.has(r.race_number)) errors.push("duplicate_race_number"); nums.add(r.race_number);
    if(!r.betfair_market_id||ids.has(r.betfair_market_id)) errors.push("invalid_or_duplicate_market_id"); ids.add(r.betfair_market_id);
    if(!r.start_time||Number.isNaN(new Date(r.start_time).getTime())) errors.push("missing_start_time");
    if(!r.distance||r.distance<500||r.distance>5000) errors.push("invalid_distance");
    if(!Array.isArray(r.runners)||r.runners.length<2) errors.push("runner_count_too_low");
    const runnerNums=new Set();
    for(const x of r.runners||[]){
      if(!Number.isInteger(x.runner_number)||runnerNums.has(x.runner_number)) errors.push("invalid_or_duplicate_runner_number");
      runnerNums.add(x.runner_number);
      if(!clean(x.horse_name)) errors.push("missing_horse_name");
      if(!clean(x.jockey)) errors.push("missing_jockey");
      if(!clean(x.trainer)) errors.push("missing_trainer");
      if(!Number.isInteger(x.barrier)||x.barrier<1) errors.push("missing_barrier");
    }
  }
  if(nums.size){
    const max=Math.max(...nums);
    for(let i=1;i<=max;i++) if(!nums.has(i)) errors.push("missing_race_"+i);
  }
  return {ok:errors.length===0,status:errors.length?"AU CARD INCOMPLETE":"OK",auto_generate_enabled:errors.length===0,errors:[...new Set(errors)]};
}


export function validateAustralianCard(meetings){
  const errors=[];
  if(!Array.isArray(meetings)||!meetings.length) errors.push("no_australian_meetings");
  for(const m of meetings||[]){const v=validateBetfairMeeting(m);if(!v.ok)errors.push(...v.errors.map(e=>clean(m?.venue||"unknown")+":"+e))}
  return {ok:errors.length===0,status:errors.length?"AU CARD INCOMPLETE":"OK",auto_generate_enabled:errors.length===0,errors};
}
