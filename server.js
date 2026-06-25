// DDD — Fusion-seed backend: serves the sensor PWA, collects detection reports,
// and coordinates SYNCHRONIZED multi-phone recording sessions (admin trigger).
const express = require('express');
const path = require('path');
const app = express();

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store (resets on redeploy). Swap for Postgres later for persistence.
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

// ---- synchronized recording session coordination ----
// Admin sets a session; all phones poll /cmd and start recording together.
let session = null; // { id, startAt, dur }

app.get('/cmd', (req, res) => res.json({ now: Date.now(), session }));

app.post('/cmd/start', (req, res) => {
  const dur = Math.min(300, Math.max(5, parseInt((req.body && req.body.dur) || 60, 10)));
  const lead = 5000; // 5s in the future so every phone can schedule the same start
  session = { id: Date.now().toString(36), startAt: Date.now() + lead, dur };
  res.json({ ok: true, session });
});

app.post('/cmd/stop', (req, res) => { session = null; res.json({ ok: true }); });

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('DDD backend listening on ' + PORT));
