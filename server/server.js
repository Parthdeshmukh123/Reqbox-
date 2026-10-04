require("dotenv").config();
const express = require("express"), cors = require("cors"), mongoose = require("mongoose"), axios = require("axios");
const app = express();
app.use(cors({ origin: process.env.CLIENT_URL && process.env.CLIENT_URL !== "*" ? process.env.CLIENT_URL.split(",") : true }));
app.use(express.json({ limit: "5mb" }));

// ---- Models (flexible schemas) ----
const mk = (n, f) => mongoose.model(n, new mongoose.Schema(f, { timestamps: true, strict: false }));
const M = {
  collections: mk("Collection", { name: String, requests: Array }),
  environments: mk("Environment", { name: String, variables: Array }),
  history: mk("History", {}),
};

// ---- CRUD for collections / environments / history ----
const clean = ({ _id, __v, createdAt, updatedAt, ...b }) => b;
for (const [p, m] of Object.entries(M)) {
  app.get(`/api/${p}`, async (q, r) => r.json(await m.find().sort({ createdAt: -1 }).limit(p === "history" ? 50 : 200)));
  app.post(`/api/${p}`, async (q, r) => r.status(201).json(await m.create(clean(q.body))));
  app.put(`/api/${p}/:id`, async (q, r) => r.json(await m.findByIdAndUpdate(q.params.id, clean(q.body), { new: true })));
  app.delete(`/api/${p}/:id`, async (q, r) => { await m.findByIdAndDelete(q.params.id); r.json({ ok: true }); });
}
app.delete("/api/history", async (q, r) => { await M.history.deleteMany({}); r.json({ ok: true }); });

// ---- Proxy: executes the request server-side so browser CORS never applies ----
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1)/i;
app.post("/api/proxy", async (req, res) => {
  const { method = "GET", url, headers = {}, body } = req.body || {};
  let u; try { u = new URL(url); } catch { return res.status(400).json({ status: 0, statusText: "Invalid URL", headers: {}, body: "Invalid URL", time: 0, size: 0 }); }
  if (!/^https?:$/.test(u.protocol)) return res.status(400).json({ status: 0, statusText: "Only http/https allowed", headers: {}, body: "", time: 0, size: 0 });
  if (process.env.ALLOW_PRIVATE !== "true" && PRIVATE.test(u.hostname))
    return res.status(403).json({ status: 0, statusText: "Private addresses blocked", headers: {}, body: "Set ALLOW_PRIVATE=true to allow local targets.", time: 0, size: 0 });
  const t0 = Date.now();
  try {
    const r = await axios({ method, url: u.href, headers, data: body || undefined, timeout: 30000, validateStatus: () => true,
      responseType: "arraybuffer", maxContentLength: 10 * 1024 * 1024, transformResponse: x => x });
    const buf = Buffer.from(r.data);
    res.json({ status: r.status, statusText: r.statusText, headers: r.headers, body: buf.toString("utf8"), time: Date.now() - t0, size: buf.length });
  } catch (e) {
    res.json({ status: 0, statusText: "Request failed", headers: {}, body: e.message, time: Date.now() - t0, size: 0 });
  }
});

app.get("/", (q, r) => r.send("Reqbox API is running"));
mongoose.connect(process.env.MONGODB_URI).then(() => {
  app.listen(process.env.PORT || 5000, () => console.log("Reqbox server running"));
}).catch(e => { console.error("MongoDB connection failed:", e.message); process.exit(1); });
    
