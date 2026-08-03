const http = require("http");
const fs = require("fs");
const CLIENT_ID = "B421424299B64C1188D2C3E92EA60219";
const CLIENT_SECRET = "jyonRzS3OPpq7PcooWQax4ZjtV3hpgDISCMGYFT661Q_NM3Q";
const OUT = __dirname + "/_xero2-tokens.json";
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:5555");
  if (url.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
  const code = url.searchParams.get("code");
  if (!code) { res.writeHead(400); res.end("no code"); return; }
  try {
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
    const tr = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: "http://localhost:5555/callback" }),
    });
    const tok = await tr.json();
    if (!tok.access_token) throw new Error(JSON.stringify(tok));
    const cr = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${tok.access_token}` } });
    const conns = await cr.json();
    const biofuel = conns.find((c) => /biofuel/i.test(c.tenantName || "")) || conns[0];
    fs.writeFileSync(OUT, JSON.stringify({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
      accessToken: tok.access_token, refreshToken: tok.refresh_token,
      expiresAt: Date.now() + tok.expires_in * 1000,
      tenantId: biofuel?.tenantId, tenantName: biofuel?.tenantName,
    }, null, 2));
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2>Connected: ${biofuel?.tenantName || "?"} — you can close this tab.</h2>`);
    console.log(`TOKENS SAVED · tenant=${biofuel?.tenantName} (${biofuel?.tenantId})`);
    setTimeout(() => process.exit(0), 500);
  } catch (e) { res.writeHead(500); res.end(String(e.message)); console.error("EXCHANGE FAILED", e.message); }
});
server.listen(5555, () => console.log("listening on :5555"));
setTimeout(() => { console.log("timeout, exiting"); process.exit(1); }, 15 * 60 * 1000);
