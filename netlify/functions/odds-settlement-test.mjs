const BASE="https://api.odds-api.net/v1";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const perthDate=ts=>new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Perth",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(Number(ts)*1000));
export default async request=>{
 const key=Netlify.env.get("ODDS_API_NET_KEY"); if(!key)return new Response("ODDS_API_NET_KEY missing",{status:500});
 const u=new URL(request.url),date=u.searchParams.get("date"),venue=u.searchParams.get("venue")||"Eagle Farm",race=Number(u.searchParams.get("race")||2);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||""))return new Response("date=YYYY-MM-DD required",{status:400});
 const start=Math.floor(new Date(date+"T00:00:00+08:00").getTime()/1000),end=start+86400;
 let cursor=null,events=[];
 do{const q=new URL(BASE+"/racing/events");q.searchParams.set("race_type","horse-racing");q.searchParams.set("race_country","AU");q.searchParams.set("start_from",start);q.searchParams.set("start_to",end);q.searchParams.set("limit","100");if(cursor)q.searchParams.set("cursor",cursor);
 const r=await fetch(q,{headers:{"X-API-Key":key,Accept:"application/json"}}),p=await r.json();if(!r.ok)return new Response(JSON.stringify(p,null,2),{status:r.status,headers:{"content-type":"application/json"}});
 const rows=p.items||p.data?.items||p.data||[];if(Array.isArray(rows))events.push(...rows);cursor=p.next_cursor||p.data?.next_cursor||null;}while(cursor);
 const targetTs=Math.floor(new Date(date+"T02:13:00Z").getTime()/1000);
 const nearby=events.map(e=>({...e,time_diff_seconds:Math.abs(Number(e.race_start_time)-targetTs)}))
   .filter(e=>e.time_diff_seconds<=45*60).sort((a,b)=>Number(a.race_start_time)-Number(b.race_start_time));
 const display=nearby.map(e=>({event_id:e.event_id,venue:e.race_venue||e.venue||null,race_number:e.race_number??null,state:e.race_state??null,status:e.status??null,start_unix:e.race_start_time,start_utc:Number.isFinite(Number(e.race_start_time))?new Date(Number(e.race_start_time)*1000).toISOString():null,start_awst:Number.isFinite(Number(e.race_start_time))?new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Perth",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(Number(e.race_start_time)*1000)):null,diff_minutes:Math.round(e.time_diff_seconds/6)/10}));
 const body=JSON.stringify({target:{venue,race,target_utc:date+"T02:13:00Z",target_awst:"10:13",expected_runners:["Captain Maverick","Taravia","Demarcay"]},events_returned:events.length,nearby_event_count:display.length,nearby_events:display},null,2);
 return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Odds API Settlement Test</title><style>body{font-family:system-ui;margin:24px;max-width:1200px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:16px;border-radius:8px}</style><h1>FPSO odds-api.net Post-Race Sportsbet Test</h1><p><strong>Read-only.</strong> No database writes.</p><p>Target Sportsbet: #3 WIN 2.50 / PLACE 1.25 · #6 PLACE 1.40 · #5 PLACE 2.00</p><p>Query: ${esc(date)} · ${esc(venue)} R${race}</p><pre>${esc(body)}</pre>`,{status:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
};