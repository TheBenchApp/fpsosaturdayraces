export default async (request) => {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "content-type": "application/json" } });
  }

  const apiKey = Netlify.env.get("ODDSPRO_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ ok: false, error: "ODDSPRO_API_KEY is not configured" }), { status: 500, headers: { "content-type": "application/json" } });
  }

  try {
    const upstream = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(apiKey)}&all=true`);
    const data = await upstream.json();

    if (!upstream.ok) {
      return new Response(JSON.stringify({ ok: false, status: upstream.status, error: data?.message || data?.error_code || "The Odds API request failed" }), {
        status: upstream.status,
        headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    }

    const racing = Array.isArray(data)
      ? data.filter(s => /horse|racing|thoroughbred/i.test(`${s.key} ${s.group} ${s.title} ${s.description}`))
      : [];

    return new Response(JSON.stringify({
      ok: true,
      configured: true,
      apiConnected: true,
      totalSports: Array.isArray(data) ? data.length : 0,
      racing
    }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: "Unable to reach The Odds API" }), {
      status: 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }
};
