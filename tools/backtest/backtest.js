'use strict';
/* Vòng 3 — kiểm tra độ bền của T+G: quét ngưỡng mua/bán, trọng số vùng giá,
 * phân bố lợi nhuận theo từng coin (tránh kết luận từ trung bình bị 1-2 coin kéo). */
const fs = require('fs');
const path = require('path');
const E = require('../../js/engine.js');
const DIR = path.join(__dirname, 'data');
const FEE = 0.001;

function scoreCfg(d, dH, ticker, cfg) {
  const { closes, highs, lows, volumes, takerBuy } = d;
  const n = closes.length;
  const last = closes[n - 1];
  const rsiArr = E.rsiSeries(closes);
  const ema20 = E.emaSeries(closes, 20);
  const ema50 = E.emaSeries(closes, 50);
  const { hist } = E.macdSeries(closes);
  const rsi = rsiArr[n - 1];
  const e20 = ema20[n - 1], e50 = ema50[n - 1];
  const h = hist[n - 1], hPrev = hist[n - 2];
  const { adx: adxArr } = E.adxSeries(highs, lows, closes);
  const adx = adxArr[n - 1];
  const trending = adx != null && adx >= 20;
  const stArr = E.supertrendDir(highs, lows, closes);
  const st = stArr[n - 1], stPrev = stArr[n - 2];
  const boll = E.bollingerLast(closes);
  const obv = E.obvSlope(closes, volumes);
  const div = E.findDivergence(closes, rsiArr);
  let htf = 0;
  if (dH && dH.closes.length > 60) {
    const hE20 = E.emaSeries(dH.closes, 20), hE50 = E.emaSeries(dH.closes, 50);
    const hSt = E.supertrendDir(dH.highs, dH.lows, dH.closes);
    const m = dH.closes.length - 1;
    const emaUp = hE20[m] != null && hE50[m] != null && hE20[m] > hE50[m];
    const stUp = hSt[m] === 1;
    htf = emaUp && stUp ? 1 : !emaUp && !stUp ? -1 : 0;
  }
  let takerRatio = null;
  {
    let tb = 0, tv = 0;
    for (let i = Math.max(0, n - 10); i < n; i++) {
      if (Number.isFinite(takerBuy[i]) && Number.isFinite(volumes[i])) { tb += takerBuy[i]; tv += volumes[i]; }
    }
    if (tv > 0) takerRatio = tb / tv;
  }
  let score = 0;
  const add = (p) => { score += p; };
  const pos = E.pricePosition(highs, lows, last, 90);
  const turn = E.reversalTurn(closes, rsiArr, hist, stArr);
  const zw = cfg.zoneW || 0;
  if (zw > 0) {
    if (pos <= 0.30) {
      if (turn.up >= 3) add(3 * zw);
      else if (turn.down < 3) add(1 * zw);
    } else if (pos >= 0.70) {
      if (turn.down >= 3) add(-3 * zw);
      else if (turn.up < 3) add(-1 * zw);
    }
  }
  const w = trending ? 1 : 0.5;
  if (st != null) {
    if (st === 1 && stPrev === -1) add(2 * w);
    else if (st === -1 && stPrev === 1) add(-2 * w);
    else if (st === 1) add(1.5 * w); else add(-1.5 * w);
  }
  if (htf === 1) add(1.5); else if (htf === -1) add(-1.5);
  if (div.bull) add(2); if (div.bear) add(-2);
  if (obv > 0.15) add(1); else if (obv < -0.15) add(-1);
  if (takerRatio != null) { if (takerRatio >= 0.55) add(1); else if (takerRatio <= 0.45) add(-1); }
  if (boll) {
    if (boll.pctB <= 0.05 && rsi != null && rsi < 35) add(1);
    else if (boll.pctB >= 0.95 && rsi != null && rsi > 65) add(-1);
  }
  if (rsi != null) {
    if (rsi < 30) add(2); else if (rsi < 40) add(1);
    else if (rsi > 70) add(-2); else if (rsi > 60) add(-1);
  }
  if (e20 != null && e50 != null) {
    if (e20 > e50) { add(1 * w); if (E.crossedWithin(ema20, ema50, 5)) add(1); }
    else { add(-1 * w); if (E.crossedWithin(ema50, ema20, 5)) add(-1); }
    if (last > e20 && last > e50) add(0.5 * w);
    else if (last < e20 && last < e50) add(-0.5 * w);
  }
  if (h != null && hPrev != null) {
    if (h > 0 && hPrev <= 0) add(1);
    else if (h < 0 && hPrev >= 0) add(-1);
    else if (h > 0) add(0.5 * w); else add(-0.5 * w);
  }
  const LOOK = 6;
  const negHist = hist.map(v => (v == null ? null : -v));
  const priceRising = closes[n - 4] != null && last > closes[n - 4];
  if ((E.turnedPositiveWithin(hist, LOOK) || E.crossedWithin(ema20, ema50, LOOK)) && priceRising && rsi != null && rsi < 70) add(1);
  if ((E.turnedPositiveWithin(negHist, LOOK) || E.crossedWithin(ema50, ema20, LOOK)) && !priceRising && rsi != null && rsi > 30) add(-1);
  const chg = ticker.changePct;
  if (chg <= -6 && rsi != null && rsi < 38) add(1);
  if (chg >= 9 && rsi != null && rsi > 65) add(-1);
  if (cfg.gate) {
    if (score > 0 && pos >= 0.70) score *= 0.5;
    else if (score < 0 && pos <= 0.30) score *= 0.5;
  }
  return Math.round(score * 10) / 10;
}

function resampleHTF(d, upto, group) {
  const out = { closes: [], highs: [], lows: [], volumes: [], takerBuy: [] };
  const start = (upto + 1) % group;
  for (let i = start; i <= upto; i += group) {
    const j = Math.min(i + group - 1, upto);
    let hi = -Infinity, lo = Infinity, vol = 0, tb = 0;
    for (let k = i; k <= j; k++) {
      if (d.highs[k] > hi) hi = d.highs[k];
      if (d.lows[k] < lo) lo = d.lows[k];
      vol += d.volumes[k]; tb += d.takerBuy[k];
    }
    out.closes.push(d.closes[j]); out.highs.push(hi); out.lows.push(lo);
    out.volumes.push(vol); out.takerBuy.push(tb);
  }
  for (const k of Object.keys(out)) out[k] = out[k].slice(-120);
  return out;
}
function slice(d, from, to) {
  return {
    closes: d.closes.slice(from, to), highs: d.highs.slice(from, to),
    lows: d.lows.slice(from, to), volumes: d.volumes.slice(from, to),
    takerBuy: d.takerBuy.slice(from, to),
  };
}

const CONFIGS = [
  { name: 'T+G th3',        cfg: { gate: true },            buy: 3,   sell: -3 },
  { name: 'T+G th2.5',      cfg: { gate: true },            buy: 2.5, sell: -2.5 },
  { name: 'T+G th4',        cfg: { gate: true },            buy: 4,   sell: -4 },
  { name: 'T+G+Z0.5 th3',   cfg: { gate: true, zoneW: 0.5 }, buy: 3,  sell: -3 },
  { name: 'V1(Z1+G) th3',   cfg: { gate: true, zoneW: 1 },  buy: 3,   sell: -3 },
];

const stats = {};
for (const tf of ['1d', '4h']) {
  stats[tf] = {};
  for (const c of CONFIGS) stats[tf][c.name] = { perCoin: [], bh: [], trades: [], dd: [] };
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
for (const f of files) {
  const sym = f.split('-')[0];
  const tf = f.split('-')[1].replace('.json', '');
  const d = E.parseKlines(JSON.parse(fs.readFileSync(path.join(DIR, f))));
  const n = d.closes.length;
  const group = tf === '1d' ? 7 : 6;
  const chgBack = tf === '1d' ? 1 : 6;
  const start = 250, end = n - 21;
  const sim = {};
  for (const c of CONFIGS) sim[c.name] = { pos: 0, entry: 0, eq: 1, peak: 1, dd: 0, trades: [] };
  for (let t = start; t < end; t++) {
    const win = slice(d, t - 199, t + 1);
    const dH = resampleHTF(d, t, group);
    const tk = { changePct: (d.closes[t] / d.closes[t - chgBack] - 1) * 100 };
    for (const c of CONFIGS) {
      const s = scoreCfg(win, dH, tk, c.cfg);
      const m = sim[c.name];
      const px = d.closes[t];
      if (m.pos === 0 && s >= c.buy) { m.pos = 1; m.entry = px * (1 + FEE); }
      else if (m.pos === 1 && s <= c.sell) {
        const ret = (px * (1 - FEE)) / m.entry - 1;
        m.trades.push(ret); m.eq *= 1 + ret; m.pos = 0;
      }
      const eqNow = m.pos === 1 ? m.eq * (px / m.entry) : m.eq;
      if (eqNow > m.peak) m.peak = eqNow;
      m.dd = Math.max(m.dd, 1 - eqNow / m.peak);
    }
  }
  const lastPx = d.closes[end - 1];
  for (const c of CONFIGS) {
    const m = sim[c.name];
    if (m.pos === 1) { const ret = (lastPx * (1 - FEE)) / m.entry - 1; m.trades.push(ret); m.eq *= 1 + ret; }
    const S = stats[tf][c.name];
    S.perCoin.push({ sym, ret: m.eq - 1, bh: lastPx / d.closes[start] - 1 });
    S.trades.push(...m.trades); S.dd.push(m.dd);
  }
}

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pctPos = a => (a.length ? a.filter(x => x > 0).length / a.length : NaN);
const fp = x => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—');
for (const tf of ['1d', '4h']) {
  console.log(`\n======== KHUNG ${tf} ========`);
  console.log('Cấu hình      | LN TB | LN trung vị | Coin thắng B&H | Lệnh TB | Thắng lệnh | DDmax TB');
  for (const c of CONFIGS) {
    const S = stats[tf][c.name];
    const rets = S.perCoin.map(x => x.ret);
    const beat = S.perCoin.filter(x => x.ret > x.bh).length;
    console.log(`${c.name.padEnd(13)} | ${fp(mean(rets)).padStart(6)} | ${fp(median(rets)).padStart(6)} | ${beat}/${S.perCoin.length} | ${(S.trades.length / S.perCoin.length).toFixed(1).padStart(5)} | ${fp(pctPos(S.trades)).padStart(6)} | ${fp(mean(S.dd))}`);
  }
}
console.log('\n--- Chi tiết từng coin: T+G th3, khung 1d (kiểm tra không bị 1-2 coin kéo) ---');
for (const x of stats['1d']['T+G th3'].perCoin.sort((a, b) => b.ret - a.ret)) {
  console.log(`${x.sym.padEnd(10)} engine ${fp(x.ret).padStart(7)}   vs B&H ${fp(x.bh).padStart(7)}   ${x.ret > x.bh ? '✓ thắng' : '✗ thua'}`);
}
