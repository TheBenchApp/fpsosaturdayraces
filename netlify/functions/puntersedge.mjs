const BASE = "https://api.puntersedge.online/v1";
const keyNames = ["PUNTERSEDGE_API_KEY","PUNTERS_EDGE_API_KEY","PUNTERSEDGE_KEY","PUNTERS_EDGE_KEY"];

export default async (request) => {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const keyName = keyNames.find(name => Netlify.env.get(name));
  const key = keyName ? Netlify.env.get(keyName) : null;
  if (!key) return new Response(JSON.stringify({error:"PuntersEdge API key is not configured"}),{status:500,headers:{"content-type":"application/json","cache-control":"no-store"}});

  let path;
  if (action === "acceptances") path = "/racing/acceptances";
  else if (action === "next_to_go") path = "/racing/next-to-go";
  else return new Response(JSON.stringify({error:"Unsupported PuntersEdge action"}),{status:400,headers:{"content-type":"application/json","cache-control":"no-store"}});

  const upstream = new URL(BASE + path);
  for (const [k,v] of url.searchParams.entries()) if (k !== "action") upstream.searchParams.append(k,v);
  if (action === "next_to_go") {
    if (!upstream.searchParams.has("num_races")) upstream.searchParams.set("num_races","200");
    if (!upstream.searchParams.has("categories")) upstream.searchParams.set("categories","horse");
    if (!upstream.searchParams.has("bookmakers")) upstream.searchParams.set("bookmakers","sportsbet");
    if (!upstream.searchParams.has("include_unresolved")) upstream.searchParams.set("include_unresolved","true");
  }

  try {
    const res = await fetch(upstream,{headers:{"X-API-Key":key,"Accept":"application/json"}});
    const body = await res.text();
    return new Response(body,{status:res.status,headers:{"content-type":res.headers.get("content-type") || "application/json","cache-control":"no-store"}});
  } catch (err) {
    return new Response(JSON.stringify({error:"PuntersEdge request failed",detail:String(err?.message || err)}),{status:502,headers:{"content-type":"application/json","cache-control":"no-store"}});
  }
};
