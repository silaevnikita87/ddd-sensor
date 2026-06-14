// DDD — minimal Fusion-seed backend: serves the sensor PWA and collects detection reports.
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

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('DDD backend listening on ' + PORT));
