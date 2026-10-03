const https = require("https");
const required=["BETFAIR_USERNAME","BETFAIR_PASSWORD","BETFAIR_APP_KEY","BETFAIR_CLIENT_CERT","BETFAIR_CLIENT_KEY"];
const clean=v=>String(v??"").replace(/\s+/g," ").trim();
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const reply=(statusCode,body)=>({statusCode,headers:{"content-type":"application/json","cache-control":"no-store"},body:JSON.stringify(body)});
function post(hostname,path,headers,body,cert,key){
 return new Promise((resolve,reject)=>{const q=https.request({hostname,port:443,path,method:"POST",cert,key,headers:{...headers,"Content-Length":Buffer.byteLength(body)}},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>resolve({status:r.statusCode||0,body:d}))});q.on("error",reject);q.write(body);q.end()});
}
async function betfair(path,payload,app,token){
 const body=JSON.stringify(payload); const r=await post("api.betfair.com","/exchange/betting/rest/v1.0"+path,{"X-Application":app,"X-Authentication":token,"Content-Type":"application/json","Accept":"application/json"},body);
 if(r.status!==200) throw new Error("Betfair API HTTP "+r.status+": "+r.body.slice(0,160));
 return JSON.parse(r.body);
}
function normalize(catalogue){
 const by=new Map();
 for(const m of Array.isArray(catalogue)?catalogue:[]){
  const eventId=String(m?.event?.id??""); const venue=clean(m?.event?.venue||m?.event?.name).replace(/\s*\(AUS\).*$/i,"");
  const rm=clean(m?.marketName).match(/^R(\d+)\s+(\d{3,4})m\b/i); if(!eventId||!venue||!rm)continue;
  const runners=(m.runners||[]).map(r=>{const x=clean(r.runnerName).match(/^(\d+)\.\s*(.+)$/);const md=r.metadata||{};return{runner_number:x?Number(x[1]):num(md.CLOTH_NUMBER),horse_name:x?clean(x[2]):clean(r.runnerName),barrier:num(md.STALL_DRAW),jockey:clean(md.JOCKEY_NAME),trainer:clean(md.TRAINER_NAME),betfair_selection_id:String(r.selectionId??"")}}).sort((a,b)=>a.runner_number-b.runner_number);
  const race={source:"betfair",betfair_event_id:eventId,betfair_market_id:String(m.marketId??""),venue,race_number:Number(rm[1]),distance:Number(rm[2]),race_name:clean(m.marketName),start_time:m.marketStartTime||null,runners};
  if(!by.has(eventId))by.set(eventId,{venue,betfair_event_id:eventId,races:[]});by.get(eventId).races.push(race);
 }
 return [...by.values()].map(x=>({...x,races:x.races.sort((a,b)=>a.race_number-b.race_number)}));
}
function validate(meeting){
 const e=[],races=meeting?.races||[],nums=new Set(),ids=new Set(); if(!clean(meeting?.venue))e.push("missing_meeting_venue");if(!races.length)e.push("meeting_has_no_races");
 for(const r of races){if(!Number.isInteger(r.race_number)||r.race_number<1)e.push("invalid_race_number");if(nums.has(r.race_number))e.push("duplicate_race_number");nums.add(r.race_number);if(!r.betfair_market_id||ids.has(r.betfair_market_id))e.push("invalid_or_duplicate_market_id");ids.add(r.betfair_market_id);if(!r.start_time||Number.isNaN(new Date(r.start_time).getTime()))e.push("missing_start_time");if(!r.distance||r.distance<500||r.distance>5000)e.push("invalid_distance");if(!Array.isArray(r.runners)||r.runners.length<2)e.push("runner_count_too_low");const rn=new Set();for(const x of r.runners||[]){if(!Number.isInteger(x.runner_number)||rn.has(x.runner_number))e.push("invalid_or_duplicate_runner_number");rn.add(x.runner_number);if(!clean(x.horse_name))e.push("missing_horse_name");if(!clean(x.jockey))e.push("missing_jockey");if(!clean(x.trainer))e.push("missing_trainer");if(!Number.isInteger(x.barrier)||x.barrier<1)e.push("missing_barrier")}}
 if(nums.size){const max=Math.max(...nums);for(let i=1;i<=max;i++)if(!nums.has(i))e.push("missing_race_"+i)}
 return{ok:e.length===0,errors:[...new Set(e)]};
}
exports.handler=async event=>{
 try{
  const missing=required.filter(k=>!process.env[k]);if(missing.length)return reply(500,{ok:false,status:"BETFAIR_SECRETS_MISSING",missing,auto_generate_enabled:false});
  const date=event?.queryStringParameters?.date;if(!/^\d{4}-\d{2}-\d{2}$/.test(date||""))return reply(400,{ok:false,status:"DATE_REQUIRED",message:"Use ?date=YYYY-MM-DD",auto_generate_enabled:false});
  const app=process.env.BETFAIR_APP_KEY;const loginBody=new URLSearchParams({username:process.env.BETFAIR_USERNAME,password:process.env.BETFAIR_PASSWORD}).toString();
  const login=await post("identitysso-cert.betfair.com.au","/api/certlogin",{"X-Application":app,"Content-Type":"application/x-www-form-urlencoded"},loginBody,process.env.BETFAIR_CLIENT_CERT,process.env.BETFAIR_CLIENT_KEY);
  let lj={};try{lj=JSON.parse(login.body)}catch{};if(login.status!==200||lj.loginStatus!=="SUCCESS"||!lj.sessionToken)return reply(502,{ok:false,status:"BETFAIR_LOGIN_FAILED",http_status:login.status,login_status:lj.loginStatus||null,auto_generate_enabled:false});
  const token=lj.sessionToken;\n  // Perth is UTC+8 year-round: a Perth calendar day begins 16:00Z on the previous UTC date.\n  const perthStart=new Date(date+"T00:00:00+08:00");\n  const perthEnd=new Date(perthStart.getTime()+24*60*60*1000-1);\n  const from=perthStart.toISOString(),to=perthEnd.toISOString();
  const events=await betfair("/listEvents/",{filter:{eventTypeIds:["7"],marketCountries:["AU"],marketStartTime:{from,to}}},app,token);
  const ids=events.map(x=>x.event?.id).filter(Boolean);
  const catalogue=ids.length?await betfair("/listMarketCatalogue/",{filter:{eventTypeIds:["7"],eventIds:ids,marketCountries:["AU"],marketTypeCodes:["WIN"]},marketProjection:["EVENT","MARKET_DESCRIPTION","RUNNER_DESCRIPTION","RUNNER_METADATA","MARKET_START_TIME"],sort:"FIRST_TO_START",maxResults:"1000"},app,token):[];
  const meetings=normalize(catalogue).map(m=>({...m,validation:validate(m)}));const bad=meetings.filter(m=>!m.validation.ok);
  return reply(bad.length?422:200,{ok:bad.length===0,status:bad.length?"AU CARD INCOMPLETE":"BETFAIR_CARD_VALID",date,event_count:events.length,meeting_count:meetings.length,race_count:meetings.reduce((n,m)=>n+m.races.length,0),auto_generate_enabled:false,meetings,note:"Diagnostic branch only; production Auto Generate remains disabled."});
 }catch(err){return reply(500,{ok:false,status:"BETFAIR_CARD_ERROR",error:String(err?.message||err),auto_generate_enabled:false})}
};