// DDD — Fusion-seed backend: serves the sensor PWA, collects detection reports,
// coordinates SYNCHRONIZED recording sessions, and COLLECTS uploaded WAV files.
const express = require('express');
const path = require('path');
const fs = require('fs');
const dsp = require('./dsp.js');
const app = express();

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Persist uploads on a Railway Volume when attached (RAILWAY_VOLUME_MOUNT_PATH),
// otherwise fall back to local dir (ephemeral). Files survive redeploys with a volume.
const STORE = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const UP = path.join(STORE, 'uploads');
try { fs.mkdirSync(UP, { recursive: true }); } catch (e) {}
console.log('[DDD] uploads dir:', UP,
  process.env.RAILWAY_VOLUME_MOUNT_PATH ? '(persistent volume)' : '(EPHEMERAL — add a volume to persist)');

// ---- detection EVENTS (consecutive pings from a device = one event) ----
let events = [];
const EVENT_GAP = 12000; // ms; pings within this window extend the same event
app.post('/report', (req, res) => {
  const { f0, score, deviceId } = req.body || {};
  const now = Date.now();
  const dev = deviceId || null;
  let ev = events.find(e => e.deviceId === dev && now - e.last < EVENT_GAP);
  if (ev) {
    ev.last = now; ev.count++;
    ev.f0 = f0; ev.score = Math.max(ev.score, score || 0);
  } else {
    ev = { start: now, last: now, f0, score: score || 0, count: 1, deviceId: dev };
    events.push(ev);
  }
  if (events.length > 5000) events = events.slice(-5000);
  res.json({ ok: true, events: events.length });
});
app.get('/reports', (req, res) => res.json(events.slice(-500).map(e => ({
  t: e.last, start: e.start, f0: e.f0, score: e.score,
  dur: Math.round((e.last - e.start) / 100) / 10, count: e.count, deviceId: e.deviceId
}))));
app.get('/stats', (req, res) => {
  const now = Date.now(), day = 864e5, month = 30 * day;
  res.json({
    today: events.filter(e => now - e.start < day).length,
    month: events.filter(e => now - e.start < month).length,
    total: events.length
  });
});

// ---- precise TDOA fixes (computed from synchronized recordings) ----
let fixes = []; // { lat, lon, x, y, label, err, t }
app.post('/fix', (req, res) => {
  const b = req.body || {};
  if (typeof b.lat !== 'number' || typeof b.lon !== 'number')
    return res.status(400).json({ ok: false, error: 'lat/lon required (numbers)' });
  fixes.push({
    lat: b.lat, lon: b.lon,
    x: (typeof b.x === 'number') ? b.x : null,
    y: (typeof b.y === 'number') ? b.y : null,
    label: (b.label || '').toString().slice(0, 40),
    err: (typeof b.err === 'number') ? b.err : null,
    t: Date.now()
  });
  if (fixes.length > 200) fixes = fixes.slice(-200);
  res.json({ ok: true, count: fixes.length });
});
app.get('/fixes', (req, res) => {
  const now = Date.now(), keep = 10 * 60 * 1000; // last 10 minutes
  res.json(fixes.filter(f => now - f.t < keep));
});
app.post('/fixes/clear', (req, res) => { fixes = []; res.json({ ok: true }); });

// ---- sensor heartbeat / online roster ----
let sensors = {}; // deviceId -> { lastSeen, label, lat, lon }
app.post('/heartbeat', (req, res) => {
  const { deviceId, label, lat, lon } = req.body || {};
  if (deviceId) {
    const prev = sensors[deviceId] || {};
    sensors[deviceId] = {
      lastSeen: Date.now(),
      label: label || prev.label || null,
      lat: (typeof lat === 'number') ? lat : (prev.lat ?? null),
      lon: (typeof lon === 'number') ? lon : (prev.lon ?? null)
    };
  }
  res.json({ ok: true });
});
app.get('/sensors', (req, res) => {
  const now = Date.now();
  res.json(Object.entries(sensors)
    .filter(([k, v]) => now - v.lastSeen < 15000)
    .map(([k, v]) => ({ deviceId: k, label: v.label, lat: v.lat, lon: v.lon, lastSeen: v.lastSeen })));
});

// ---- synchronized recording session ----
let session = null; // { id, startAt, dur }
app.get('/cmd', (req, res) => res.json({ now: Date.now(), session }));
app.post('/cmd/start', (req, res) => {
  const dur = Math.min(300, Math.max(5, parseInt((req.body && req.body.dur) || 60, 10)));
  const nm = (req.body && req.body.name)
    ? String(req.body.name).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 24) : '';
  const id = (nm ? nm + '-' : '') + Date.now().toString(36).slice(-4);
  session = { id, startAt: Date.now() + 5000, dur, name: nm };
  res.json({ ok: true, session });
});
app.post('/cmd/stop', (req, res) => { session = null; res.json({ ok: true }); });

// ---- LIVE mode: in-memory rolling chunk buffer (NOT persisted) ----
// phones POST short audio chunks; the desktop processor pulls them, localizes, POSTs /fix.
let live = {};          // label -> [ { seq, t, buf } ]  (last few chunks)
let liveOn = false;     // a live session is active
const LIVE_KEEP = 6;    // chunks kept per label
// field geometry for on-server localization (set via /live/config)
let liveCfg = {
  mics: { "1": [0, 0], "2": [15, 0], "3": [7.5, 13] },
  clapPos: [7.5, 4], origin: [32.7940, 34.9896], bearing: 90,
  srcT0: 0.4, srcT1: 2.6
};
let liveCalib = null, liveProcessed = new Set();

app.post('/live/config', (req, res) => {
  const b = req.body || {};
  if (b.mics && typeof b.mics === 'object') liveCfg.mics = b.mics;
  if (Array.isArray(b.clapPos)) liveCfg.clapPos = b.clapPos;
  if (Array.isArray(b.origin)) liveCfg.origin = b.origin;
  if (typeof b.bearing === 'number') liveCfg.bearing = b.bearing;
  liveCalib = null; liveProcessed = new Set();
  res.json({ ok: true, cfg: liveCfg });
});
app.get('/live/config', (req, res) => res.json(liveCfg));

function liveProcess() {
  try {
    const labels = Object.keys(liveCfg.mics);
    if (!labels.every(l => live[l] && live[l].length)) return;
    // calibrate once from the clap in seq 0
    if (liveCalib === null) {
      if (!labels.every(l => live[l].some(c => c.seq === 0))) return;
      const calib = {}; let fsr;
      for (const l of labels) {
        const w = dsp.parseWav(live[l].find(c => c.seq === 0).buf);
        if (!w) return; calib[l] = w.samples; fsr = w.fs;
      }
      liveCalib = dsp.clockOffsets(labels, liveCfg.mics, liveCfg.clapPos, calib, fsr);
      console.log('[live] calibrated:', liveCalib.map(o => (1000 * o).toFixed(0) + 'ms').join(', '));
    }
    // newest common seq>0 not yet processed
    let common = null;
    for (const l of labels) {
      const s = new Set(live[l].map(c => c.seq));
      common = common ? new Set([...common].filter(x => s.has(x))) : s;
    }
    const cand = [...common].filter(s => s > 0 && !liveProcessed.has(s));
    if (!cand.length) return;
    const seq = Math.max(...cand);
    const src = {}; let fsr;
    for (const l of labels) {
      const w = dsp.parseWav(live[l].find(c => c.seq === seq).buf);
      if (!w) return; src[l] = w.samples; fsr = w.fs;
    }
    const est = dsp.localizeSource(labels, liveCfg.mics, src, fsr, liveCalib, liveCfg.srcT0, liveCfg.srcT1);
    const ll = dsp.toLatLon(est[0], est[1], liveCfg.origin, liveCfg.bearing);
    fixes.push({ lat: ll[0], lon: ll[1], x: est[0], y: est[1], label: 'live#' + seq, err: null, t: Date.now() });
    if (fixes.length > 200) fixes = fixes.slice(-200);
    liveProcessed.add(seq);
    console.log('[live] seq', seq, '-> (' + est[0].toFixed(1) + ',' + est[1].toFixed(1) + ')');
  } catch (e) { console.log('[live] err', e.message); }
}

app.post('/live/start', (req, res) => { live = {}; liveOn = true; liveCalib = null; liveProcessed = new Set(); res.json({ ok: true }); });
app.post('/live/stop',  (req, res) => { liveOn = false; res.json({ ok: true }); });
app.get('/live/status', (req, res) => res.json({ on: liveOn }));
app.post('/live/chunk', express.raw({ type: '*/*', limit: '12mb' }), (req, res) => {
  const label = (req.query.label || 'phone').toString().replace(/[^A-Za-z0-9_-]/g, '_');
  const seq = parseInt(req.query.seq || '0', 10);
  const t = parseInt(req.query.t || Date.now(), 10);
  (live[label] = live[label] || []).push({ seq, t, buf: req.body });
  if (live[label].length > LIVE_KEEP) live[label] = live[label].slice(-LIVE_KEEP);
  res.json({ ok: true, seq });
  setImmediate(liveProcess);
});
app.get('/live/state', (req, res) => {
  res.json(Object.entries(live).map(([label, arr]) => ({
    label, lastSeq: arr.length ? arr[arr.length - 1].seq : -1,
    seqs: arr.map(c => c.seq), lastT: arr.length ? arr[arr.length - 1].t : 0,
    bytes: arr.length ? arr[arr.length - 1].buf.length : 0
  })));
});
app.get('/live/chunk', (req, res) => {
  const label = (req.query.label || '').toString().replace(/[^A-Za-z0-9_-]/g, '_');
  const seq = parseInt(req.query.seq || '-1', 10);
  const c = (live[label] || []).find(x => x.seq === seq);
  if (!c) return res.status(404).json({ ok: false });
  res.set('Content-Type', 'application/octet-stream').send(c.buf);
});

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
<title>CyberDuck · קבצים שהועלו</title>
<style>body{font-family:'Segoe UI',system-ui,sans-serif;background:#0B1A2F;color:#E6EEF7;max-width:700px;margin:0 auto;padding:24px}
h1{color:#F08A24;font-size:20px}ul{list-style:none;padding:0}li{margin:10px 0;font-size:15px;padding:10px 12px;background:#11233D;border:1px solid #1E3A5C;border-radius:10px;display:flex;justify-content:space-between;align-items:center}
a{color:#34D399;text-decoration:none}span{color:#7E96B2;font-size:12px}.empty{color:#7E96B2}.r{margin-top:14px}.r a{color:#F08A24}</style></head>
<body><h1>קבצים שהועלו (${items.length})</h1>
<p style="font-size:13px;color:${process.env.RAILWAY_VOLUME_MOUNT_PATH ? '#34D399' : '#EF4444'}">
${process.env.RAILWAY_VOLUME_MOUNT_PATH ? '🟢 אחסון קבוע (Volume) — הקבצים נשמרים גם אחרי פריסה מחדש' : '🔴 אחסון זמני — הוסף Volume ב-Railway כדי לשמור לאורך זמן'}</p>
<ul>${rows || '<li class="empty">אין עדיין קבצים — הרץ סשן הקלטה</li>'}</ul>
<p class="r"><a href="/files">↻ רענן</a></p></body></html>`);
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('DDD backend listening on ' + PORT));
