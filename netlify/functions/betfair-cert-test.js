const https = require("https");

const required = ["BETFAIR_USERNAME","BETFAIR_PASSWORD","BETFAIR_APP_KEY","BETFAIR_CLIENT_CERT","BETFAIR_CLIENT_KEY"];
function response(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) };
}
function postWithClientCert({ hostname, path, headers, body, cert, key }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, port: 443, path, method: "POST", cert, key,
      headers: { ...headers, "Content-Length": Buffer.byteLength(body) }
    }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
exports.handler = async function () {
  try {
    const missing = required.filter(k => !process.env[k]);
    if (missing.length) return response(500, { ok:false, status:"BETFAIR_SECRETS_MISSING", missing, auto_generate_enabled:false });

    const body = new URLSearchParams({
      username: process.env.BETFAIR_USERNAME,
      password: process.env.BETFAIR_PASSWORD
    }).toString();

    const login = await postWithClientCert({
      hostname: "identitysso-cert.betfair.com.au",
      path: "/api/certlogin",
      headers: { "X-Application": process.env.BETFAIR_APP_KEY, "Content-Type":"application/x-www-form-urlencoded" },
      body,
      cert: process.env.BETFAIR_CLIENT_CERT,
      key: process.env.BETFAIR_CLIENT_KEY
    });

    let parsed = {};
    try { parsed = JSON.parse(login.body); } catch {}
    const ok = login.status === 200 && parsed.loginStatus === "SUCCESS" && !!parsed.sessionToken;
    return response(ok ? 200 : 502, {
      ok,
      status: ok ? "BETFAIR_NETLIFY_CERT_LOGIN_OK" : "BETFAIR_NETLIFY_CERT_LOGIN_FAILED",
      http_status: login.status,
      login_status: parsed.loginStatus || null,
      session_token_received: !!parsed.sessionToken,
      auto_generate_enabled: false,
      note: "Isolated diagnostic only. Session token is never returned."
    });
  } catch (err) {
    return response(500, { ok:false, status:"BETFAIR_NETLIFY_CERT_ERROR", error:String(err && err.message || err), auto_generate_enabled:false });
  }
};
