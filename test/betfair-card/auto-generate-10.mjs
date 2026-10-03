const GROUP_SCORE={1:300,2:200,3:100};
const perthMinutes=iso=>{const d=new Date(iso);if(Number.isNaN(d.getTime()))return null;const p=new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Perth",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(d);return Number(p.find(x=>x.type==="hour").value)*60+Number(p.find(x=>x.type==="minute").value)};
export function groupLevel(name=""){const m=String(name).match(/(?:group|grp|g)\s*([123])\b/i);return m?Number(m[1]):null}
export function autoGenerate10(meetings,{minGapMinutes=12,startMinutes=570,endMinutes=960}={}){
 const all=[];
 for(const m of meetings||[]){if(m?.validation&&!m.validation.ok)continue;for(const r of m?.races||[]){const t=perthMinutes(r.start_time);if(t==null||t<startMinutes||t>endMinutes)continue;all.push({...r,group_level:r.group_level||groupLevel(r.race_name),perth_minutes:t})}}
 if(all.length<10)return{ok:false,status:"AU CARD INCOMPLETE",auto_generate_enabled:false,error:"fewer_than_10_eligible_races",selected:[]};
 all.sort((a,b)=>a.perth_minutes-b.perth_minutes);
 const chosen=[];
 // First reserve Group races, highest grade first, while respecting spacing.
 const groups=all.filter(r=>r.group_level).sort((a,b)=>(GROUP_SCORE[b.group_level]-GROUP_SCORE[a.group_level])||a.perth_minutes-b.perth_minutes);
 const canAdd=r=>chosen.every(x=>Math.abs(x.perth_minutes-r.perth_minutes)>=minGapMinutes);
 for(const r of groups)if(chosen.length<10&&canAdd(r))chosen.push(r);
 // Fill remaining slots by repeatedly choosing the race furthest from already selected times and ideal evenly-spaced target slots.
 const targets=Array.from({length:10},(_,i)=>startMinutes+i*(endMinutes-startMinutes)/9);
 while(chosen.length<10){
  const candidates=all.filter(r=>!chosen.some(x=>x.betfair_market_id===r.betfair_market_id)&&canAdd(r));
  if(!candidates.length)break;
  const target=targets[chosen.length];
  candidates.sort((a,b)=>Math.abs(a.perth_minutes-target)-Math.abs(b.perth_minutes-target)||a.perth_minutes-b.perth_minutes);
  chosen.push(candidates[0]);
 }
 chosen.sort((a,b)=>a.perth_minutes-b.perth_minutes);
 if(chosen.length!==10)return{ok:false,status:"AU CARD INCOMPLETE",auto_generate_enabled:false,error:"unable_to_select_10_with_spacing",selected:chosen};
 return{ok:true,status:"OK",auto_generate_enabled:true,selected:chosen};
}
