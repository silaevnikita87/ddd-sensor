// DDD — Fusion-seed backend: serves the sensor PWA, collects detection reports,
// coordinates SYNCHRONIZED recording sessions, and COLLECTS uploaded WAV files.
const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const UP = path.join(__dirname, 'uploads');
try { fs.mkdirSync(UP, { recursive: true }); } catch (e) {}

// ---- detection reports ----
let reports = [];
app.post('/report', (req, res) => {
  const { f0, score, dur, geohash, deviceId } = req.body || {};
  reports.push({ t: Date.now(), f0, score, dur, geohash: geohash || null, deviceId: deviceId || null });
  if (reports.length > 50000) reports = reports.slice(-50000);
  res.json({ ok: true, stored: reports.length });
});
app.get('/reports', (req, res) => res.json(reports.slice(-500)));
app.get('/stats', (req, res) => {
  const now = Date.now(), day = 864e5, month = 30 * day;
  res.json({
    today: reports.filter(r => now - r.t < day).length,
    month: reports.filter(r => now - r.t < month).length,
    total: reports.length
  });
});

// ---- sensor heartbeat / online roster ----
let sensors = {}; // deviceId -> { lastSeen, label }
app.post('/heartbeat', (req, res) => {
  const { deviceId, label } = req.body || {};
  if (deviceId) sensors[deviceId] = { lastSeen: Date.now(), label: label || null };
  res.json({ ok: true });
});
app.get('/sensors', (req, res) => {
  const now = Date.now();
  res.json(Object.entries(sensors)
    .filter(([k, v]) => now - v.lastSeen < 15000)
    .map(([k, v]) => ({ deviceId: k, label: v.label, lastSeen: v.lastSeen })));
});

// ---- synchronized recording session ----
let session = null; // { id, startAt, dur }
app.get('/cmd', (req, res) => res.json({ now: Date.now(), session }));
app.post('/cmd/start', (req, res) => {
  const dur = Math.min(300, Math.max(5, parseInt((req.body && req.body.dur) || 60, 10)));
  session = { id: Date.now().toString(36), startAt: Date.now() + 5000, dur };
  res.json({ ok: true, session });
});
app.post('/cmd/stop', (req, res) => { session = null; res.json({ ok: true }); });

// ---- WAV upload collection ----
const clean = s => (s || '').toString().replace(/[^A-Za-z0-9_-]/g, '_');
app.post('/upload', express.raw({ type: '*/*', limit: '60mb' }), (req, res) => {
  const label = clean(req.query.label) || 'phone';
  const ses = clean(req.query.session) || Date.now().toString(36);
  const name = `ddd_${label}_${ses}.wav`;
  try {
    fs.writeFileSync(path.join(UP, name), req.body);
    res.json({ ok: true, name, bytes: req.body ? req.body.length : 0 });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});
app.use('/uploads', express.static(UP));
app.get('/files', (req, res) => {
  let items = [];
  try { items = fs.readdirSync(UP).filter(f => f.endsWith('.wav')); } catch (e) {}
  items.sort();
  const rows = items.map(f => {
    let size = 0; try { size = fs.statSync(path.join(UP, f)).size; } catch (e) {}
    return `<li><a href="/uploads/${encodeURIComponent(f)}" download>${f}</a> <span>${(size/1048576).toFixed(1)} MB</span></li>`;
  }).join('');
  res.send(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DDD · קבצים שהועלו</title>
<style>body{font-family:'Segoe UI',system-ui,sans-serif;background:#0B1A2F;color:#E6EEF7;max-width:700px;margin:0 auto;padding:24px}
h1{color:#F08A24;font-size:20px}ul{list-style:none;padding:0}li{margin:10px 0;font-size:15px;padding:10px 12px;background:#11233D;border:1px solid #1E3A5C;border-radius:10px;display:flex;justify-content:space-between;align-items:center}
a{color:#34D399;text-decoration:none}span{color:#7E96B2;font-size:12px}.empty{color:#7E96B2}.r{margin-top:14px}.r a{color:#F08A24}</style></head>
<body><h1>קבצים שהועלו (${items.length})</h1><ul>${rows || '<li class="empty">אין עדיין קבצים — הרץ סשן הקלטה</li>'}</ul>
<p class="r"><a href="/files">↻ רענן</a></p>
<p style="color:#7E96B2;font-size:12px">הקבצים נמחקים בעת פריסה מחדש של השרת. הורד אותם מיד אחרי הסשן.</p></body></html>`);
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('DDD backend listening on ' + PORT));
