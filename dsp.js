// CyberDuck — server-side DSP for LIVE TDOA (no laptop needed).
// Parses WAV chunks, finds the calibration clap, cross-correlates the source
// across mics (FFT), and localizes in 2D. Pure JS, no native deps.
'use strict';
const C = 343.0;

// ---- WAV (PCM16 / float32) -> mono Float64Array ----
function parseWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  let p = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const sz = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(p + 8),
        channels: buf.readUInt16LE(p + 10),
        sampleRate: buf.readUInt32LE(p + 12),
        bits: buf.readUInt16LE(p + 22)
      };
    } else if (id === 'data') { dataOff = p + 8; dataLen = sz; }
    p += 8 + sz + (sz & 1);
  }
  if (!fmt || dataOff < 0) return null;
  const ch = fmt.channels || 1, bytes = fmt.bits / 8;
  const frames = Math.floor(Math.min(dataLen, buf.length - dataOff) / (bytes * ch));
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < ch; c++) {
      const o = dataOff + (i * ch + c) * bytes;
      if (fmt.audioFormat === 3 && bytes === 4) acc += buf.readFloatLE(o);
      else if (bytes === 2) acc += buf.readInt16LE(o) / 32768;
      else if (bytes === 4) acc += buf.readInt32LE(o) / 2147483648;
      else if (bytes === 1) acc += (buf.readUInt8(o) - 128) / 128;
    }
    out[i] = acc / ch;
  }
  return { samples: out, fs: fmt.sampleRate };
}

// ---- iterative radix-2 FFT (in-place) ----
function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inv ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cwr - im[b] * cwi, ti = re[b] * cwi + im[b] * cwr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = ncwr;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function nextPow2(x) { let n = 1; while (n < x) n <<= 1; return n; }

// cross-correlation lag (seconds) of a vs ref: positive => a delayed vs ref.
// matches scipy.signal.correlate(a, ref) argmax convention.
function xcorrLag(a, ref, fs) {
  const L = a.length, N = nextPow2(2 * L);
  const ar = new Float64Array(N), ai = new Float64Array(N);
  const br = new Float64Array(N), bi = new Float64Array(N);
  for (let i = 0; i < L; i++) { ar[i] = a[i]; br[i] = ref[i]; }
  fft(ar, ai, false); fft(br, bi, false);
  // A * conj(B)
  const cr = new Float64Array(N), ci = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    cr[i] = ar[i] * br[i] + ai[i] * bi[i];
    ci[i] = ai[i] * br[i] - ar[i] * bi[i];
  }
  fft(cr, ci, true);
  // find peak magnitude; circular index -> signed lag
  let best = -1, bk = 0;
  for (let k = 0; k < N; k++) {
    const m = cr[k] * cr[k] + ci[k] * ci[k];
    if (m > best) { best = m; bk = k; }
  }
  let lag = bk <= N / 2 ? bk : bk - N;
  return lag / fs;
}

function mean(x, a, b) { let s = 0; for (let i = a; i < b; i++) s += x[i]; return s / (b - a); }

// crude high-pass (first difference) then argmax|.| within first `win` seconds.
function clapTime(x, fs, win) {
  const n = Math.min(x.length, Math.floor(win * fs));
  let best = -1, bi = 0;
  for (let i = 1; i < n; i++) {
    const d = Math.abs(x[i] - x[i - 1]);
    if (d > best) { best = d; bi = i; }
  }
  return bi / fs;
}

// ---- 2D TDOA localization (Gauss-Newton), tdoa in SECONDS vs mic ref(0) ----
function localize(P, tdoa) {
  const n = P.length;
  // initial guess: centroid
  let x = 0, y = 0;
  for (const p of P) { x += p[0]; y += p[1]; }
  x /= n; y /= n;
  const rd = tdoa.map(t => t * C); // measured range differences (m) vs ref
  for (let it = 0; it < 30; it++) {
    // residuals r_i = (|P_i - S| - |P_0 - S|) - rd_i, for i=1..n-1
    const d = P.map(p => Math.hypot(p[0] - x, p[1] - y) + 1e-9);
    // build normal equations J^T J a = -J^T r  (2x2)
    let JTJ = [[0, 0], [0, 0]], JTr = [0, 0];
    const g0x = (x - P[0][0]) / d[0], g0y = (y - P[0][1]) / d[0];
    for (let i = 1; i < n; i++) {
      const gix = (x - P[i][0]) / d[i], giy = (y - P[i][1]) / d[i];
      const jx = gix - g0x, jy = giy - g0y;
      const r = (d[i] - d[0]) - rd[i];
      JTJ[0][0] += jx * jx; JTJ[0][1] += jx * jy;
      JTJ[1][0] += jy * jx; JTJ[1][1] += jy * jy;
      JTr[0] += jx * r; JTr[1] += jy * r;
    }
    const det = JTJ[0][0] * JTJ[1][1] - JTJ[0][1] * JTJ[1][0];
    if (Math.abs(det) < 1e-12) break;
    const dx = -(JTr[0] * JTJ[1][1] - JTr[1] * JTJ[0][1]) / det;
    const dy = -(JTJ[0][0] * JTr[1] - JTJ[1][0] * JTr[0]) / det;
    x += dx; y += dy;
    if (Math.hypot(dx, dy) < 1e-4) break;
  }
  return [x, y];
}

function toLatLon(x, y, origin, bearingDeg) {
  const [lat0, lon0] = origin, th = bearingDeg * Math.PI / 180;
  const dE = x * Math.sin(th) - y * Math.cos(th);
  const dN = x * Math.cos(th) + y * Math.sin(th);
  return [lat0 + dN / 111320, lon0 + dE / (111320 * Math.cos(lat0 * Math.PI / 180))];
}

// ---- high level ----
// labels: order; mics: {label:[x,y]}; calib/src: {label: Float64Array}; fs.
function clockOffsets(labels, mics, clapPos, calib, fs) {
  const ct = {}; labels.forEach(l => ct[l] = clapTime(calib[l], fs, 0.6));
  const ref = labels[0];
  const g = labels.map(l => Math.hypot(mics[l][0] - clapPos[0], mics[l][1] - clapPos[1]) / C);
  return labels.map((l, i) => (ct[l] - ct[ref]) - (g[i] - g[0]));
}

function localizeSource(labels, mics, src, fs, clockB, t0, t1) {
  const a = Math.floor(t0 * fs), b = Math.floor(t1 * fs);
  const ref = labels[0];
  const refSeg = src[ref].slice(a, b);
  const rm = mean(refSeg, 0, refSeg.length);
  for (let i = 0; i < refSeg.length; i++) refSeg[i] -= rm;
  const raw = labels.map(l => {
    const seg = src[l].slice(a, b);
    const m = mean(seg, 0, seg.length);
    for (let i = 0; i < seg.length; i++) seg[i] -= m;
    return xcorrLag(seg, refSeg, fs);
  });
  const tdoa = raw.map((v, i) => v - clockB[i]);
  const P = labels.map(l => mics[l]);
  return localize(P, tdoa);
}

module.exports = { C, parseWav, fft, xcorrLag, clapTime, localize, toLatLon, clockOffsets, localizeSource };
