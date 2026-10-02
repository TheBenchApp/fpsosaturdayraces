export default async (request) => {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "content-type": "application/json" } });
  }

  const apiKey = Netlify.env.get("ODDSPRO_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ ok: false, error: "ODDSPRO_API_KEY is not configured" }), { status: 500, headers: { "content-type": "application/json" } });
  }

  // Deliberately do not return the secret. This endpoint only confirms the
  // server-side environment is wired correctly before racing API calls are added.
  return new Response(JSON.stringify({ ok: true, configured: true }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
};
