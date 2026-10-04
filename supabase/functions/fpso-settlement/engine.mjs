// Capability audit 2026-10-04: PuntersEdge final straight dividends have no
// Sportsbet provenance. Odds API historical diagnostic returned no races.
// Never treat win_price, place_price, SP or FIXED as official Sportsbet dividends.
export const SPORTSBet_DIVIDENDS_VERIFIED = false;
export const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');
export const raceDate = v => new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));

export function matchResult(race, rows) {
  const sameDay = rows.filter(r => r.start_time && raceDate(r.start_time) === raceDate(race.race_time));
  if (race.api_id) {
    const exact = sameDay.filter(r => String(r.race_id) === String(race.api_id));
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
  }
  const matches = sameDay.filter(r => norm(r.venue) === norm(race.track) && Number(r.race_number) === Number(race.race_number));
  return matches.length === 1 ? matches[0] : null;
}

export function resultPatch(race, result, now = Date.now()) {
  if (race.status === 'settled') return null;
  const delay = now - new Date(race.race_time).getTime();
  const patch = {provider_checked_at:new Date(now).toISOString(),next_provider_check:new Date(now+(delay>3600000?900000:180000)).toISOString()};
  if (!result) return {...patch, result_state:race.result_state==='protest'?'protest':race.result_state==='final'?'final':delay<180000?'running':'awaiting_final',settlement_reason:'Matching FINAL result not available. Admin can investigate the official result.'};
  const status = String(result.status ?? '').toLowerCase();
  const note = String(result.status_note ?? '');
  const protest = /protest|inquiry|enquiry|objection/i.test(status+' '+note) && !(/dismissed|resolved|upheld/i.test(note) && status==='final');
  if (protest) return {...patch,result_state:'protest',settlement_reason:'PROTEST / RESULT NOT FINAL — settlement blocked.'};
  if (status !== 'final') return {...patch,result_state:race.result_state==='protest'?'protest':'awaiting_final',settlement_reason:status==='abandoned'?'Race abandoned/postponed — admin investigation required.':'RESULT NOT FINAL — awaiting official FINAL result.'};
  const placings = result.placings || [];
  const podium = [1,2,3].map(pos => placings.filter(p=>Number(p.position)===pos));
  const nums = podium.map(p=>p.length===1?Number(p[0].number):null);
  if (podium[0].length!==1 || podium[1].length!==1 || podium[2].length>1 ||
      (result.runners||[]).some(r=>r.dead_heat) || nums.some(n=>n!==null && (!Number.isInteger(n)||n<=0)) ||
      new Set(nums.filter(n=>n!==null)).size!==nums.filter(n=>n!==null).length ||
      nums.some(n=>n!==null && !(race.runners||[]).some(r=>Number(r.number)===n))) {
    return {...patch,result_state:'awaiting_final',settlement_reason:'FINAL payload has incomplete, conflicting or dead-heat placings — manual investigation required.'};
  }
  return {...patch,result_state:'final',result_1st:nums[0],result_2nd:nums[1],result_3rd:nums[2],
    // Stop re-fetching this confirmed final payload. Manual Sportsbet dividends are required.
    next_provider_check:'infinity',settlement_reason:'FINAL placings captured. Official Sportsbet WIN/PLACE dividends are not verified from these providers; enter them manually.'};
}

export function preRaceFavourite(race, live, now=Date.now()) {
  const jump=new Date(race.race_time).getTime();
  if (race.status==='settled'||now>jump||jump-now>600000||!live) return null;
  const runners=(live.runners||[]).map(r=>({number:Number(r.number??r.runner_number),name:r.name,odds:(r.bookmakers||[]).find(b=>b.key==='sportsbet')?.win_price,scratched:r.scratched||r.status==='scratched'}));
  // Only the documented Sportsbet bookmaker field may supply capture prices.
  const priced=runners.filter(r=>!r.scratched && Number(r.odds)>0);
  priced.sort((a,b)=>Number(a.odds)-Number(b.odds)||a.number-b.number);
  const f=priced[0];
  return f?{number:f.number,name:f.name,win_odds:Number(f.odds),captured_at:now}:null;
}
