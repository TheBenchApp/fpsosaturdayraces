import {extractSportsbetAllRacing,attachSportsbetRacecard,validateMeeting,perthDisplayTime} from "./sportsbet-card-extractor.mjs";

const BASE="https://www.sportsbet.com.au/apigw/sportsbook-racing/Sportsbook/Racing";
const DATE="2026-10-04";
const WANTED=new Set(["northam","townsville","port lincoln"]);
const get=async url=>{
  const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0","accept":"application/json","origin":"https://www.sportsbet.com.au","referer":"https://www.sportsbet.com.au/"}});
  if(!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} for ${url}`);
  return r.json();
};
try{
  const all=await get(`${BASE}/AllRacing/${DATE}`);
  const meetings=extractSportsbetAllRacing(all,DATE).filter(m=>WANTED.has(m.venue.toLowerCase()));
  if(meetings.length!==3) throw new Error(`Expected 3 proof meetings, got ${meetings.map(m=>m.venue).join(", ")||"none"}`);
  let failed=false;
  for(const meeting of meetings){
    const full=[];
    for(const race of meeting.races){
      const card=await get(`${BASE}/Events/${race.sportsbet_race_id}/Racecard`);
      full.push(attachSportsbetRacecard(race,card));
    }
    const completed={...meeting,races:full};
    const v=validateMeeting(completed);
    console.log(JSON.stringify({
      venue:meeting.venue,races:full.length,
      first_perth:perthDisplayTime(full[0]?.start_time),
      last_perth:perthDisplayTime(full.at(-1)?.start_time),
      runners:full.map(r=>r.runners.length),
      status:v.status,auto_generate_enabled:v.auto_generate_enabled,
      errors:v.errors,warnings:v.warnings
    }));
    if(!v.ok) failed=true;
  }
  if(failed) process.exit(2);
}catch(e){
  console.error("LIVE_PROBE_ERROR",e?.stack||e);
  process.exit(3);
}
