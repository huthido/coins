/* Engine phân tích kỹ thuật của Coins — dùng chung cho trình duyệt (script tag)
 * và server Node (require) để tín hiệu web push khớp 100% với tín hiệu trong app. */
'use strict';

// định dạng % cục bộ (tách khỏi UI của app.js)
const pctS = (x) => (x > 0 ? '+' : '') + x.toFixed(2) + '%';

/* ================= Chỉ báo kỹ thuật ================= */

function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += values[j];
      prev = sum / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

// RSI theo phương pháp Wilder
function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgG = gain / period, avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

function macdSeries(closes, fast = 12, slow = 26, signal = 9) {
  const emaF = emaSeries(closes, fast);
  const emaS = emaSeries(closes, slow);
  const macd = closes.map((_, i) => (emaF[i] != null && emaS[i] != null) ? emaF[i] - emaS[i] : null);
  const valid = macd.filter(v => v != null);
  const sigValid = emaSeries(valid, signal);
  const sig = new Array(closes.length).fill(null);
  let vi = 0;
  for (let i = 0; i < macd.length; i++) {
    if (macd[i] != null) { sig[i] = sigValid[vi]; vi++; }
  }
  const hist = macd.map((v, i) => (v != null && sig[i] != null) ? v - sig[i] : null);
  return { macd, signal: sig, hist };
}

// ATR (Average True Range) — làm mượt kiểu Wilder
function atrSeries(highs, lows, closes, period = 14) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (n <= period) return out;
  const tr = [0];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  out[period] = sum / period;
  for (let i = period + 1; i < n; i++) out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  return out;
}

// ADX — đo SỨC MẠNH xu hướng (>25: xu hướng rõ; <20: sideway, tín hiệu trend kém tin cậy)
function adxSeries(highs, lows, closes, period = 14) {
  const n = closes.length;
  const adx = new Array(n).fill(null);
  if (n <= period * 2) return { adx, pdi: null, mdi: null };
  const plusDM = [0], minusDM = [0], tr = [0];
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const wilder = (arr) => {
    const s = new Array(n).fill(null);
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += arr[i];
    s[period] = sum;
    for (let i = period + 1; i < n; i++) s[i] = s[i - 1] - s[i - 1] / period + arr[i];
    return s;
  };
  const trS = wilder(tr), pS = wilder(plusDM), mS = wilder(minusDM);
  const dx = new Array(n).fill(null);
  let lastPdi = null, lastMdi = null;
  for (let i = period; i < n; i++) {
    if (!trS[i]) continue;
    const pdi = 100 * pS[i] / trS[i];
    const mdi = 100 * mS[i] / trS[i];
    lastPdi = pdi; lastMdi = mdi;
    const s = pdi + mdi;
    dx[i] = s ? 100 * Math.abs(pdi - mdi) / s : 0;
  }
  let sum2 = 0;
  for (let i = period; i < period * 2; i++) sum2 += dx[i];
  adx[period * 2 - 1] = sum2 / period;
  for (let i = period * 2; i < n; i++) adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
  return { adx, pdi: lastPdi, mdi: lastMdi };
}

// SuperTrend (ATR-based) — trả về hướng từng nến: 1 tăng, -1 giảm
function supertrendDir(highs, lows, closes, period = 10, mult = 3) {
  const atr = atrSeries(highs, lows, closes, period);
  const n = closes.length;
  const dir = new Array(n).fill(null);
  let fub = null, flb = null, trend = 1;
  for (let i = 0; i < n; i++) {
    if (atr[i] == null) continue;
    const mid = (highs[i] + lows[i]) / 2;
    const bub = mid + mult * atr[i];
    const blb = mid - mult * atr[i];
    fub = (fub == null || bub < fub || closes[i - 1] > fub) ? bub : fub;
    flb = (flb == null || blb > flb || closes[i - 1] < flb) ? blb : flb;
    if (closes[i] > fub) trend = 1;
    else if (closes[i] < flb) trend = -1;
    dir[i] = trend;
  }
  return dir;
}

// Bollinger Bands (20, 2): vị trí giá trong băng (%B) + độ rộng băng (bandwidth)
function bollingerLast(closes, period = 20, k = 2) {
  const n = closes.length;
  if (n < period + 50) return null;
  const bw = [];
  let last = null;
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const mid = sum / period;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (closes[j] - mid) ** 2;
    const sd = Math.sqrt(v / period);
    const upper = mid + k * sd, lower = mid - k * sd;
    bw.push(mid ? (upper - lower) / mid : 0);
    if (i === n - 1) {
      last = {
        upper, lower, mid,
        pctB: upper > lower ? (closes[i] - lower) / (upper - lower) : 0.5,
        bandwidth: bw[bw.length - 1],
        squeeze: bw[bw.length - 1] <= Math.min(...bw.slice(-50)) * 1.05, // băng đang bó chặt nhất ~50 nến
      };
    }
  }
  return last;
}

// OBV (On-Balance Volume) — xác nhận xu hướng bằng dòng khối lượng
function obvSlope(closes, volumes, look = 10) {
  const n = closes.length;
  let obv = 0;
  const series = [0];
  for (let i = 1; i < n; i++) {
    obv += closes[i] > closes[i - 1] ? volumes[i] : closes[i] < closes[i - 1] ? -volumes[i] : 0;
    series.push(obv);
  }
  if (n < look + 2) return 0;
  const d = series[n - 1] - series[n - 1 - look];
  const scale = Math.abs(series[n - 1 - look]) || 1;
  return d / scale; // >0: dòng tiền vào, <0: dòng tiền ra
}

// Phân kỳ RSI ~40 nến gần nhất (đáy giá thấp hơn nhưng RSI cao hơn → phân kỳ tăng, và ngược lại)
function findDivergence(closes, rsiArr, lookback = 40) {
  const n = closes.length;
  const lows = [], highs = [];
  for (let i = Math.max(2, n - lookback); i < n - 2; i++) {
    if (closes[i] < closes[i - 1] && closes[i] < closes[i - 2] && closes[i] < closes[i + 1] && closes[i] < closes[i + 2]) lows.push(i);
    if (closes[i] > closes[i - 1] && closes[i] > closes[i - 2] && closes[i] > closes[i + 1] && closes[i] > closes[i + 2]) highs.push(i);
  }
  let bull = false, bear = false;
  if (lows.length >= 2) {
    const a = lows[lows.length - 2], b = lows[lows.length - 1];
    if (closes[b] < closes[a] && rsiArr[a] != null && rsiArr[b] != null && rsiArr[b] > rsiArr[a] + 1 && rsiArr[b] < 45) bull = true;
  }
  if (highs.length >= 2) {
    const a = highs[highs.length - 2], b = highs[highs.length - 1];
    if (closes[b] > closes[a] && rsiArr[a] != null && rsiArr[b] != null && rsiArr[b] < rsiArr[a] - 1 && rsiArr[b] > 55) bear = true;
  }
  return { bull, bear };
}

/* ================= Chấm điểm & đề xuất ================= */

function crossedWithin(a, b, lookback) {
  // a vượt lên trên b trong `lookback` nến gần nhất?
  const n = a.length;
  for (let i = n - lookback; i < n; i++) {
    if (i < 1 || a[i] == null || b[i] == null || a[i - 1] == null || b[i - 1] == null) continue;
    if (a[i - 1] <= b[i - 1] && a[i] > b[i]) return true;
  }
  return false;
}

// Mảng vừa chuyển từ ≤0 sang >0 trong `lookback` nến gần nhất và hiện vẫn dương?
function turnedPositiveWithin(arr, lookback) {
  const n = arr.length;
  if (arr[n - 1] == null || arr[n - 1] <= 0) return false;
  for (let i = n - lookback; i < n; i++) {
    if (i < 1 || arr[i] == null || arr[i - 1] == null) continue;
    if (arr[i - 1] <= 0 && arr[i] > 0) return true;
  }
  return false;
}

function buildSignal(d, dH, ticker) {
  const { closes, highs, lows, volumes, takerBuy } = d;
  const n = closes.length;
  const last = closes[n - 1];
  const rsiArr = rsiSeries(closes);
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const { macd, signal, hist } = macdSeries(closes);

  const rsi = rsiArr[n - 1];
  const e20 = ema20[n - 1], e50 = ema50[n - 1];
  const h = hist[n - 1], hPrev = hist[n - 2];

  // Chỉ báo v2
  const atrArr = atrSeries(highs, lows, closes);
  const atr = atrArr[n - 1];
  const { adx: adxArr } = adxSeries(highs, lows, closes);
  const adx = adxArr[n - 1];
  const trending = adx != null && adx >= 20; // ADX<20: sideway — tín hiệu xu hướng kém tin cậy
  const stArr = supertrendDir(highs, lows, closes);
  const st = stArr[n - 1];
  const stPrev = stArr[n - 2];
  const boll = bollingerLast(closes);
  const obv = obvSlope(closes, volumes);
  const div = findDivergence(closes, rsiArr);

  // Xu hướng khung thời gian lớn hơn (hợp lưu đa khung — lọc 40-60% tín hiệu nhiễu)
  let htf = 0;
  if (dH && dH.closes.length > 60) {
    const hEma20 = emaSeries(dH.closes, 20), hEma50 = emaSeries(dH.closes, 50);
    const hSt = supertrendDir(dH.highs, dH.lows, dH.closes);
    const m = dH.closes.length - 1;
    const emaUp = hEma20[m] != null && hEma50[m] != null && hEma20[m] > hEma50[m];
    const stUp = hSt[m] === 1;
    htf = emaUp && stUp ? 1 : !emaUp && !stUp ? -1 : 0;
  }

  // Tỷ lệ chủ động mua (taker buy) 10 nến gần nhất
  let takerRatio = null;
  if (takerBuy && volumes) {
    let tb = 0, tv = 0;
    for (let i = Math.max(0, n - 10); i < n; i++) { tb += takerBuy[i]; tv += volumes[i]; }
    if (tv > 0) takerRatio = tb / tv;
  }

  let score = 0;
  const reasons = []; // {text, dir: +1|-1|0}
  const add = (pts, text) => { score += pts; reasons.push({ text, dir: Math.sign(pts) }); };

  // ==== Sức mạnh xu hướng (ADX) — cổng lọc ====
  if (adx != null) {
    if (!trending) reasons.push({ text: `ADX ${adx.toFixed(0)} — thị trường sideway, tín hiệu xu hướng giảm trọng số`, dir: 0 });
    else if (adx >= 30) reasons.push({ text: `ADX ${adx.toFixed(0)} — xu hướng đang rất mạnh`, dir: 0 });
  }
  const w = trending ? 1 : 0.5; // trọng số tín hiệu trend khi sideway

  // ==== SuperTrend ====
  if (st != null) {
    if (st === 1 && stPrev === -1) add(2 * w, 'SuperTrend vừa ĐẢO CHIỀU TĂNG — tín hiệu vào lệnh sớm');
    else if (st === -1 && stPrev === 1) add(-2 * w, 'SuperTrend vừa ĐẢO CHIỀU GIẢM — tín hiệu thoát sớm');
    else if (st === 1) add(1.5 * w, 'SuperTrend (10,3) đang ở chiều tăng');
    else add(-1.5 * w, 'SuperTrend (10,3) đang ở chiều giảm');
  }

  // ==== Hợp lưu khung thời gian lớn ====
  if (htf === 1) add(1.5, 'Khung thời gian lớn hơn cũng đang xu hướng tăng (hợp lưu đa khung)');
  else if (htf === -1) add(-1.5, 'Khung thời gian lớn hơn cũng đang xu hướng giảm (hợp lưu đa khung)');

  // ==== Phân kỳ RSI (tín hiệu đảo chiều mạnh) ====
  if (div.bull) add(2, 'PHÂN KỲ TĂNG: giá tạo đáy thấp hơn nhưng RSI tạo đáy cao hơn — lực bán đang cạn');
  if (div.bear) add(-2, 'PHÂN KỲ GIẢM: giá tạo đỉnh cao hơn nhưng RSI tạo đỉnh thấp hơn — lực mua đang yếu');

  // ==== Dòng tiền (OBV + taker buy) ====
  if (obv > 0.02) add(1, 'OBV tăng — dòng khối lượng xác nhận lực mua');
  else if (obv < -0.02) add(-1, 'OBV giảm — dòng khối lượng xác nhận lực bán');
  if (takerRatio != null) {
    if (takerRatio >= 0.55) add(1, `Bên mua chủ động chiếm ${(takerRatio * 100).toFixed(0)}% khối lượng 10 nến gần nhất`);
    else if (takerRatio <= 0.45) add(-1, `Bên bán chủ động chiếm ${((1 - takerRatio) * 100).toFixed(0)}% khối lượng 10 nến gần nhất`);
  }

  // ==== Bollinger Bands ====
  if (boll) {
    if (boll.squeeze) reasons.push({ text: 'Bollinger đang bó chặt (squeeze) — sắp có biến động mạnh, chờ hướng phá vỡ', dir: 0 });
    if (boll.pctB <= 0.05 && rsi != null && rsi < 35) add(1, 'Giá chạm/thủng băng Bollinger dưới kèm RSI thấp — quá bán căng');
    else if (boll.pctB >= 0.95 && rsi != null && rsi > 65) add(-1, 'Giá chạm/vượt băng Bollinger trên kèm RSI cao — quá mua căng');
  }

  // RSI
  if (rsi != null) {
    if (rsi < 30) add(2, `RSI ${rsi.toFixed(1)} — vùng quá bán sâu, giá có thể hồi phục`);
    else if (rsi < 40) add(1, `RSI ${rsi.toFixed(1)} — gần vùng quá bán`);
    else if (rsi > 70) add(-2, `RSI ${rsi.toFixed(1)} — vùng quá mua, rủi ro điều chỉnh cao`);
    else if (rsi > 60) add(-1, `RSI ${rsi.toFixed(1)} — hơi nóng, cân nhắc chốt lời một phần`);
    else reasons.push({ text: `RSI ${rsi.toFixed(1)} — vùng trung tính`, dir: 0 });
  }

  // Xu hướng EMA
  if (e20 != null && e50 != null) {
    if (e20 > e50) {
      add(1 * w, 'EMA20 nằm trên EMA50 — xu hướng ngắn hạn tăng');
      if (crossedWithin(ema20, ema50, 5)) add(1, 'EMA20 vừa cắt lên EMA50 (golden cross) trong vài nến gần đây');
    } else {
      add(-1 * w, 'EMA20 nằm dưới EMA50 — xu hướng ngắn hạn giảm');
      if (crossedWithin(ema50, ema20, 5)) add(-1, 'EMA20 vừa cắt xuống EMA50 (death cross) trong vài nến gần đây');
    }
    if (last > e20 && last > e50) add(0.5 * w, 'Giá đang đứng trên cả EMA20 và EMA50');
    else if (last < e20 && last < e50) add(-0.5 * w, 'Giá đang nằm dưới cả EMA20 và EMA50');
  }

  // MACD
  if (h != null && hPrev != null) {
    if (h > 0 && hPrev <= 0) add(1, 'MACD vừa cắt lên đường tín hiệu — động lượng chuyển sang tích cực');
    else if (h < 0 && hPrev >= 0) add(-1, 'MACD vừa cắt xuống đường tín hiệu — động lượng chuyển sang tiêu cực');
    else if (h > 0) add(0.5 * w, 'Histogram MACD dương — động lượng tăng vẫn duy trì');
    else add(-0.5 * w, 'Histogram MACD âm — động lượng giảm vẫn duy trì');
  }

  // Đà mới hình thành: động lượng vừa đảo chiều trong ~6 nến gần nhất
  const LOOK = 6;
  const negHist = hist.map(v => (v == null ? null : -v));
  const histUpNew = turnedPositiveWithin(hist, LOOK);
  const histDownNew = turnedPositiveWithin(negHist, LOOK);
  const goldenNew = crossedWithin(ema20, ema50, LOOK);
  const deathNew = crossedWithin(ema50, ema20, LOOK);
  const ref = closes[n - 4]; // so với 3 nến trước
  const priceRising = ref != null && last > ref;
  const momoUp = (histUpNew || goldenNew) && priceRising && rsi != null && rsi < 70;
  const momoDown = (histDownNew || deathNew) && !priceRising && rsi != null && rsi > 30;
  if (momoUp) add(1, `Đà tăng MỚI hình thành — động lượng vừa đảo chiều tăng trong ${LOOK} nến gần nhất, có thể vào sớm`);
  if (momoDown) add(-1, `Đà giảm MỚI hình thành — động lượng vừa đảo chiều giảm, cân nhắc bán trước khi giá giảm sâu hơn`);

  // Biến động 24h kết hợp RSI
  const chg = ticker.changePct;
  if (chg <= -6 && rsi != null && rsi < 38) add(1, `Giảm ${pctS(chg)} trong 24h kèm RSI thấp — cơ hội bắt đáy ngắn hạn (rủi ro cao)`);
  if (chg >= 9 && rsi != null && rsi > 65) add(-1, `Tăng ${pctS(chg)} trong 24h kèm RSI cao — dễ có nhịp chốt lời`);

  score = Math.round(score * 10) / 10;
  let verdict, cls;
  if (score >= 6)       { verdict = 'MUA MẠNH'; cls = 'buy strong'; }
  else if (score >= 3)  { verdict = 'MUA';      cls = 'buy'; }
  else if (score <= -6) { verdict = 'BÁN MẠNH'; cls = 'sell strong'; }
  else if (score <= -3) { verdict = 'BÁN';      cls = 'sell'; }
  else                  { verdict = 'GIỮ / THEO DÕI'; cls = 'hold'; }

  const trend = (e20 != null && e50 != null)
    ? (e20 > e50 ? (last > e20 ? 'Tăng ↗' : 'Tăng, đang điều chỉnh') : (last < e20 ? 'Giảm ↘' : 'Giảm, đang hồi'))
    : '—';

  // Gợi ý quản trị rủi ro theo ATR (tham khảo)
  const risk = atr != null ? {
    atrPct: (atr / last) * 100,
    longSL: last - 1.5 * atr,
    longTP: last + 2.5 * atr,
    shortSL: last + 1.5 * atr,
    shortTP: last - 2.5 * atr,
  } : null;

  return {
    score, verdict, cls, reasons, trend, rsi, ema20, ema50,
    macdObj: { macd, signal, hist }, rsiArr, momoUp, momoDown,
    adx, st, boll, htf, div, takerRatio, risk,
  };
}


const HTF_MAP = { '15m': '1h', '1h': '4h', '4h': '1d', '1d': '1w' };

function parseKlines(raw) {
  return {
    times: raw.map(k => k[0]),
    // k[1..5]: open, high, low, close, volume · k[9]: taker buy base volume
    highs: raw.map(k => parseFloat(k[2])),
    lows: raw.map(k => parseFloat(k[3])),
    closes: raw.map(k => parseFloat(k[4])),
    volumes: raw.map(k => parseFloat(k[5])),
    takerBuy: raw.map(k => parseFloat(k[9])),
  };
}


// Xuất cho Node (trình duyệt: các hàm ở scope script, app.js dùng trực tiếp)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    emaSeries, rsiSeries, macdSeries, atrSeries, adxSeries, supertrendDir,
    bollingerLast, obvSlope, findDivergence, crossedWithin, turnedPositiveWithin,
    buildSignal, parseKlines, HTF_MAP,
  };
}
