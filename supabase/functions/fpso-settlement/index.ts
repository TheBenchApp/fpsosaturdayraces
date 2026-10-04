import { matchResult, resultPatch, preRaceFavourite, raceDate } from './engine.mjs';

const BASE='https://fpsosaturdayraces.netlify.app/.netlify/functions/puntersedge';
const URL_DB=Deno.env.get('SUPABASE_URL')!;
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function db(path:string, method='GET', body?:unknown) {
 const response=await fetch(URL_DB+'/rest/v1/'+path,{method,headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!response.ok) throw new Error('Database HTTP '+response.status);
 return response.status===204?null:response.json();
}
async function provider(params:Record<string,string>) {
 const response=await fetch(BASE+'?'+new URLSearchParams(params),{signal:AbortSignal.timeout(20000)});
 if(!response.ok) throw new Error('Provider HTTP '+response.status);
 return response.json();
}

Deno.serve(async request=>{
 if(request.method!=='POST') return new Response('POST required',{status:405});
 const token=request.headers.get('x-fpso-worker');
 if(!token || token.length!==64) return new Response('Unauthorized',{status:401});
 try {
  const authorized=await db('rpc/fpso_worker_claim','POST',{p_token:token});
  if(!authorized) return new Response('Unauthorized or lease busy',{status:401});
  const now=Date.now();
  const races=await db('races?select=*,runners(*),events!inner(status,card_published)&status=eq.open&events.status=eq.open&events.card_published=eq.true&race_time=lte.'+encodeURIComponent(new Date(now+360000).toISOString())+'&race_time=gt.'+encodeURIComponent(new Date(now-86400000).toISOString())+'&or='+encodeURIComponent('(next_provider_check.is.null,next_provider_check.lte.'+new Date(now).toISOString()+')'));
  const before=races.filter((r:any)=>new Date(r.race_time).getTime()>now);
  let live:any[]=[];
  if(before.length) {
   try{const p=await provider({action:'next_to_go',num_races:'200',categories:'horse',country:'AU',bookmakers:'sportsbet',include_unresolved:'true'});live=Array.isArray(p)?p:p.races||[];}
   catch{ /* Pre-race failure must never create a favourite from stale/post-race odds. */ }
  }
  const results=new Map<string,any>();
  const due=races.filter((r:any)=>new Date(r.race_time).getTime()<=now);
  for(const date of [...new Set(due.map((r:any)=>raceDate(r.race_time)))]) {
   try {
    const p=await provider({action:'results',date:String(date),categories:'horse',country:'AU',limit:'1000'});
    results.set(String(date),Array.isArray(p)?p:p.results||p.races||[]);
   } catch(error) {results.set(String(date),error);}
  }
  let checked=0;
  for(const race of races) {
   if(new Date(race.race_time).getTime()>now) {
    const f=preRaceFavourite(race,matchResult(race,live),Date.now());
    if(f) await db('races?id=eq.'+race.id+'&status=eq.open','PATCH',{pre_race_favourite:f,odds_snapshot_favourite:f,favourite_number:f.number,odds_as_of:now});
    continue;
   }
   const rows=results.get(raceDate(race.race_time));
   const result=Array.isArray(rows)?matchResult(race,rows):null;
   const patch=resultPatch(race,result,now);
   if(rows instanceof Error) patch.settlement_reason=rows.message+' — admin can investigate or settle manually after verifying FINAL.';
   // Preserve the original selections. Update only known scratching flags.
   const scratches=[...new Set([...(result?.runners||[]).filter((r:any)=>['scratched','late_scratching','reserve'].includes(r.status)),...(result?.deductions||[]).filter((r:any)=>r.scratched_at)].map((r:any)=>Number(r.number)).filter((n:number)=>Number.isInteger(n)&&n>0))];
   await db('rpc/fpso_worker_apply','POST',{p_race_id:race.id,p_patch:patch,p_scratches:scratches});
   checked++;
  }
  return Response.json({ok:true,checked,dividend_mode:'manual_sportsbet'});
 } catch(error) {console.error('Settlement worker failed:',String(error));return Response.json({ok:false,error:'Settlement check failed; admin fallback remains available'},{status:500});}
});
