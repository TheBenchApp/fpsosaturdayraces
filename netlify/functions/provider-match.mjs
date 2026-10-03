const PE="https://api.puntersedge.online/v1",OA="https://api.odds-api.net/v1";
const e=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const n=s=>String(s??"").toLowerCase().replace(/[^a-z0-9]/g,"");
export default async req=>{
 const d=new URL(req.url).searchParams.get("date");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d||""))return new Response("date required",{status:400});
 const pk=Netlify.env.get("PUNTERSEDGE_API_KEY"),ok=Netlify.env.get("ODDS_API_NET_KEY");
 if(!pk||!ok)return new Response("provider key missing",{status:500});
 const get=async(base,path,key,q)=>{const u=new URL(base+path);Object.entries(q||{}).forEach(([k,v])=>u.searchParams.set(k,v));const r=await fetch(u,{headers:{"X-API-Key":key,Accept:"application/json"}});return {s:r.status,b:await r.json().catch(()=>({}))}};
 const st=Math.floor(new Date(d+"T00:00:00+08:00").getTime()/1000);
 const [p,o]=await Promise.all([get(PE,"/racing/acceptances",pk,{date:d}),get(OA,"/racing/events",ok,{race_type:"horse-racing",race_country:"AU",start_from:st,start_to:st+86400,limit:100})]);
 const pr=(p.b.meetings||[]).flatMap(m=>(m.races||[]).map(r=>({...r,v:m.venue||r.venue||""})));
 const or=o.b.items||o.b.data?.items||o.b.data||[];
 const rows=[];
 for(const r of pr){const no=String(r.race_number??r.number??"");const m=or.filter(x=>n(x.race_venue||x.venue)===n(r.v)&&String(x.race_number??x.number??"")===no);let wp="—";
  if(m.length===1&&rows.filter(x=>x.safe).length<10){const z=await get(OA,"/racing/events/"+encodeURIComponent(m[0].event_id)+"/odds",ok,{bookmakers:"sportsbet"});const a=z.b.items||z.b.data?.items||z.b.data||[];const sb=a.find(x=>String(x.bookmaker_name||x.name||x.bookmaker||"").toLowerCase()==="sportsbet")||a[0];const rr=sb?.runners||[];wp=rr.filter(x=>Number.isFinite(Number(x.win_odds))).length+"/"+rr.filter(x=>Number.isFinite(Number(x.place_odds))).length}
  rows.push({r,m,safe:m.length===1,wp});
 }
 const tr=rows.map(x=>"<tr><td>"+e(x.r.v)+" R"+e(x.r.race_number??x.r.number)+"</td><td>"+e(x.r.race_name||x.r.name||"—")+"</td><td>"+e(x.m.length===1?(x.m[0].race_venue+" R"+x.m[0].race_number):"—")+"</td><td>"+e(x.m.length===1?x.m[0].event_id:"—")+"</td><td>"+x.wp+"</td></tr>").join("");
 return new Response("<!doctype html><meta name=viewport content='width=device-width'><style>body{font-family:system-ui;margin:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px;text-align:left}th{background:#eee}</style><h1>FPSO Provider Match</h1><p><b>Read-only.</b> No FPSO/Supabase writes.</p><p>"+pr.length+" PuntersEdge races · "+or.length+" odds-api.net AU races · "+rows.filter(x=>x.safe).length+" unique venue/race matches.</p><table><tr><th>PuntersEdge</th><th>Race name</th><th>odds-api.net</th><th>event_id</th><th>Sportsbet W/P runners</th></tr>"+tr+"</table>",{headers:{"content-type":"text/html","cache-control":"no-store"}});
};