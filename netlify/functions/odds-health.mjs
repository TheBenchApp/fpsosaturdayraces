export default async (request) => {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "content-type": "application/json" } });
  }

  const apiKey = Netlify.env.get("PUNTERSEDGE_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ ok: false, error: "PUNTERSEDGE_API_KEY is not configured" }), { status: 500, headers: { "content-type": "application/json" } });
  }

  // Health check only: confirms the racing key is available server-side without
  // exposing it. The first PuntersEdge racing request will be added next.
  return new Response(JSON.stringify({
    ok: true,
    configured: true,
    provider: "PuntersEdge"
  }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
};
