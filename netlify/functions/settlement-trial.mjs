const APP='https://fpsosaturdayraces.netlify.app';
const APP_DATE='2026-10-03';
export default async () => {
  try {
    const u=APP+'/.netlify/functions/puntersedge?action=results&date='+APP_DATE+'&categories=horse&country=AU&status=final';
    const res=await fetch(u,{headers:{accept:'application/json'}});
    const body=await res.json().catch(()=>({}));
    if(!res.ok) return Response.json({error:'Results request failed',status:res.status},{status:res.status});
    const results=Array.isArray(body)?body:(body.results||body.races||[]);
    const targets=[['Eagle Farm',2],['Gold Coast',1],['Murray Bridge',2],['Flemington',4],['Kalgoorlie',1],['Randwick',6],['Darwin',2],['Randwick',8],['Flemington',8],['Kalgoorlie',6]];
    const norm=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const races=targets.map(([venue,race_number])=>{
      const r=results.find(x=>norm(x.venue)===norm(venue)&&Number(x.race_number)===Number(race_number));
      if(!r) return {venue,race_number,matched:false};
      const ps=Array.isArray(r.placings)?r.placings:[];
      const take=pos=>{const p=ps.find(x=>Number(x.position)===pos);return p?{number:Number(p.number??p.runner_number),name:p.name??p.runner_name??null,win_price:p.win_price??null,place_price:p.place_price??null}:null};
      return {venue,race_number,matched:true,status:r.status,first:take(1),second:take(2),third:take(3)};
    });
    return Response.json({read_only:true,date:APP_DATE,races});
  } catch(e) { return Response.json({error:String(e?.message||e)},{status:500}); }
};