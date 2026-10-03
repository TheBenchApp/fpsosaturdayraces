const BASE = "https://api.puntersedge.online/v1";
const keyNames = ["PUNTERSEDGE_API_KEY","PUNTERS_EDGE_API_KEY","PUNTERSEDGE_KEY","PUNTERS_EDGE_KEY"];

const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));

export default async (request) => {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue") || "Eagle Farm";
  const raceNumber = Number(url.searchParams.get("race") || 2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return new Response("Use ?date=YYYY-MM-DD&venue=Eagle%20Farm&race=2",{status:400});
  const keyName = keyNames.find(name => Netlify.env.get(name));
  const key = keyName ? Netlify.env.get(keyName) : null;
  if (!key) return new Response("PuntersEdge key not configured",{status:500});

  const upstream = new URL(BASE + "/racing/results");
  upstream.searchParams.set("date",date);
  upstream.searchParams.set("categories","horse");
  upstream.searchParams.set("country","AU");
  upstream.searchParams.set("status","final");
  const res = await fetch(upstream,{headers:{"X-API-Key":key,"Accept":"application/json"}});
  const raw = await res.text();
  if (!res.ok) return new Response("PuntersEdge HTTP "+res.status+"\n\n"+raw,{status:res.status,headers:{"content-type":"text/plain","cache-control":"no-store"}});

  let payload;
  try { payload=JSON.parse(raw); } catch { return new Response("Invalid JSON from PuntersEdge",{status:502}); }
  const results = Array.isArray(payload) ? payload : (payload.results || payload.races || []);
  const norm = v => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g,"");
  const matches = results.filter(r => norm(r.venue) === norm(venue) && Number(r.race_number) === raceNumber);
  const selected = matches[0] || null;
  const body = selected ? JSON.stringify(selected,null,2) : JSON.stringify({message:"No exact match",searched:{date,venue,raceNumber},resultCount:results.length,sample:results.slice(0,3)},null,2);
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>FPSO Result Payload</title>
  <style>body{font-family:system-ui;margin:24px;max-width:1100px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:16px;border-radius:8px}code{font-size:13px}.ok{font-weight:700}</style>
  <h1>FPSO PuntersEdge Result Payload</h1><p><strong>Read-only.</strong> No Supabase writes.</p>
  <p>Query: ${esc(date)} · ${esc(venue)} R${raceNumber} · HTTP ${res.status} · exact matches: ${matches.length}</p>
  <p class="ok">Inspect placings, dividends, prices and bookmaker/source labels below.</p><pre><code>${esc(body)}</code></pre>`;
  return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
};
