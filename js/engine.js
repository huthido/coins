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
  // avgL = 0 và avgG = 0 (giá đứng yên) phải là 50 trung tính, không phải 100 quá mua
  const rsiOf = (g, l) => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
  let avgG = gain / period, avgL = loss / period;
  out[period] = rsiOf(avgG, avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = rsiOf(avgG, avgL);
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

// OBV (On-Balance Volume) — xác nhận xu hướng bằng dòng khối lượng.
// Chuẩn hoá theo tổng khối lượng trong cửa sổ `look` → tỷ lệ mất cân bằng ròng trong [-1, 1]
// (không phụ thuộc điểm bắt đầu của chuỗi dữ liệu như cách chia cho mốc OBV tích luỹ)
function obvSlope(closes, volumes, look = 10) {
  const n = closes.length;
  if (n < look + 2) return 0;
  let d = 0, total = 0;
  for (let i = n - look; i < n; i++) {
    const v = volumes[i];
    if (!Number.isFinite(v)) continue;
    d += closes[i] > closes[i - 1] ? v : closes[i] < closes[i - 1] ? -v : 0;
    total += v;
  }
  return total > 0 ? d / total : 0; // >0: dòng tiền vào, <0: dòng tiền ra
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

// Vị trí giá trong biên độ `lookback` nến gần nhất: 0 = sát đáy, 1 = sát đỉnh
function pricePosition(highs, lows, last, lookback = 90) {
  const n = lows.length;
  const from = Math.max(0, n - lookback);
  let lo = Infinity, hi = -Infinity;
  for (let i = from; i < n; i++) {
    if (lows[i] < lo) lo = lows[i];
    if (highs[i] > hi) hi = highs[i];
  }
  if (!(hi > lo)) return 0.5;
  return Math.min(1, Math.max(0, (last - lo) / (hi - lo)));
}

// Đếm tín hiệu động lượng ngắn hạn đang quay đầu tăng/giảm (0-4 mỗi chiều)
// — dùng để xác nhận đảo chiều tại đáy/đỉnh trước khi đề xuất mua/bán
function reversalTurn(closes, rsiArr, hist, stArr) {
  const n = closes.length;
  const r1 = rsiArr[n - 1], r3 = rsiArr[n - 4];
  const h1 = hist[n - 1], h2 = hist[n - 2], h3 = hist[n - 3];
  const rsiUp = r1 != null && r3 != null && r1 > r3 + 1;
  const rsiDown = r1 != null && r3 != null && r1 < r3 - 1;
  const histUp = h1 != null && h2 != null && h3 != null && h1 > h2 && h2 >= h3;
  const histDown = h1 != null && h2 != null && h3 != null && h1 < h2 && h2 <= h3;
  const priceUp = closes[n - 4] != null && closes[n - 1] > closes[n - 4];
  const priceDown = closes[n - 4] != null && closes[n - 1] < closes[n - 4];
  const stUp = stArr[n - 1] === 1, stDown = stArr[n - 1] === -1;
  return {
    up: (rsiUp ? 1 : 0) + (histUp ? 1 : 0) + (priceUp ? 1 : 0) + (stUp ? 1 : 0),
    down: (rsiDown ? 1 : 0) + (histDown ? 1 : 0) + (priceDown ? 1 : 0) + (stDown ? 1 : 0),
  };
}

// Thống kê nhịp dao động lịch sử (zigzag trên close, ngưỡng đảo chiều thích ứng theo ATR):
// coin có "tỉ lệ tăng giảm giá cao" = nhiều nhịp tăng/giảm rộng → cơ hội mua đáy/bán đỉnh đáng giá.
// Trả về: count (số nhịp hoàn chỉnh), avgPct (biên độ trung bình mỗi nhịp, %), thresholdPct (ngưỡng dùng, %)
function swingStats(highs, lows, closes) {
  const n = closes.length;
  if (n < 30) return { count: 0, avgPct: 0, thresholdPct: 0 };
  const atr = atrSeries(highs, lows, closes);
  let s = 0, c = 0;
  for (let i = 0; i < n; i++) {
    if (atr[i] != null && closes[i] > 0) { s += atr[i] / closes[i]; c++; }
  }
  const th = Math.min(0.15, Math.max(0.04, (c ? s / c : 0.05) * 3)); // 3×ATR%, kẹp [4%, 15%]
  const swings = [];
  let pivot = closes[0], extreme = closes[0], dir = 0;
  for (let i = 1; i < n; i++) {
    const p = closes[i];
    if (dir === 0) {
      if (p >= pivot * (1 + th)) { dir = 1; extreme = p; }
      else if (p <= pivot * (1 - th)) { dir = -1; extreme = p; }
    } else if (dir === 1) {
      if (p > extreme) extreme = p;
      else if (p <= extreme * (1 - th)) {
        swings.push(extreme / pivot - 1); // nhịp tăng vừa kết thúc
        pivot = extreme; extreme = p; dir = -1;
      }
    } else {
      if (p < extreme) extreme = p;
      else if (p >= extreme * (1 + th)) {
        swings.push(extreme / pivot - 1); // nhịp giảm vừa kết thúc (giá trị âm)
        pivot = extreme; extreme = p; dir = 1;
      }
    }
  }
  if (dir !== 0 && Math.abs(extreme / pivot - 1) >= th) swings.push(extreme / pivot - 1); // nhịp đang mở
  const count = swings.length;
  const avgPct = count ? (swings.reduce((a, b) => a + Math.abs(b), 0) / count) * 100 : 0;
  return { count, avgPct, thresholdPct: th * 100 };
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
  const swing = swingStats(highs, lows, closes);

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
    for (let i = Math.max(0, n - 10); i < n; i++) {
      if (Number.isFinite(takerBuy[i]) && Number.isFinite(volumes[i])) { tb += takerBuy[i]; tv += volumes[i]; }
    }
    if (tv > 0) takerRatio = tb / tv;
  }

  let score = 0;
  const reasons = []; // {text, dir: +1|-1|0}
  const add = (pts, text) => { score += pts; reasons.push({ text, dir: Math.sign(pts) }); };

  // ==== Vị trí giá trong biên độ — cố vấn THỜI ĐIỂM vào/ra lệnh (không cộng điểm) ====
  // Backtest walk-forward 14 coin × khung 1d + 4h (2023-2026) cho thấy: cộng điểm mua ở đáy
  // làm GIẢM độ chính xác (bắt dao rơi — nhịp hồi 3 nến trong downtrend đa số thất bại),
  // trong khi chốt chặn cuối (không mua đuổi đỉnh / không bán tháo đáy) là phần tạo lợi thế.
  // Vì vậy vùng giá chỉ hiển thị làm lời khuyên thời điểm + làm chốt chặn ở cuối hàm.
  const pos = pricePosition(highs, lows, last, 90);
  const turn = reversalTurn(closes, rsiArr, hist, stArr);
  const posPct = Math.round(pos * 100);
  if (pos <= 0.30) {
    if (turn.up >= 3) reasons.push({ text: `🎯 Giá ở vùng ĐÁY (${posPct}% biên độ 90 nến) và động lượng đã quay đầu tăng (${turn.up}/4 tín hiệu) — thời điểm vào lệnh đẹp nếu tổng tín hiệu chuyển MUA`, dir: 1 });
    else if (turn.down >= 3) reasons.push({ text: `Giá ở vùng đáy (${posPct}% biên độ) nhưng vẫn đang rơi ("dao rơi") — CHỜ động lượng đảo chiều rồi hãy tính chuyện mua`, dir: 0 });
    else reasons.push({ text: `Giá ở vùng thấp (${posPct}% biên độ 90 nến) — đưa vào danh sách theo dõi, chờ động lượng xác nhận quay đầu tăng`, dir: 0 });
  } else if (pos >= 0.70) {
    if (turn.down >= 3) reasons.push({ text: `🎯 Giá ở vùng ĐỈNH (${posPct}% biên độ 90 nến) và động lượng đã quay đầu giảm (${turn.down}/4 tín hiệu) — thời điểm chốt lời đẹp nếu đang nắm giữ`, dir: -1 });
    else if (turn.up >= 3) reasons.push({ text: `Giá ở vùng đỉnh (${posPct}% biên độ) nhưng đà tăng còn mạnh — nắm giữ với trailing stop, KHÔNG mua đuổi thêm`, dir: 0 });
    else reasons.push({ text: `Giá ở vùng cao (${posPct}% biên độ 90 nến) — cân nhắc chốt lời dần, không mở vị thế mua mới`, dir: 0 });
  }

  // ==== Nguyên tắc dao động lịch sử — chỉ tư vấn & xếp hạng, KHÔNG cộng/nhân điểm ====
  // Backtest vòng 4-5 (14 coin × 1d + 4h): nhân điểm theo dao động làm tăng tín hiệu yếu vượt
  // ngưỡng → trung vị lợi nhuận sụp; event-study cho thấy tín hiệu BÁN trên coin dao động cao
  // đúng hướng 62% (vs 47% ở coin dao động thấp), nhưng tín hiệu MUA trên nhóm dao động cực cao
  // lại kém nhất — nên chỉ hiển thị làm lời khuyên và tiêu chí sắp xếp danh sách.
  if (swing.count >= 5 && swing.avgPct >= 2 * swing.thresholdPct) {
    reasons.push({ text: `Coin có tỉ lệ tăng giảm lịch sử CAO: ${swing.count} nhịp ±${swing.avgPct.toFixed(0)}%/nhịp trong ${n} nến — hợp lối mua đáy/bán đỉnh; tín hiệu BÁN nhóm này đáng tin, tín hiệu MUA nên vào lệnh từng phần`, dir: 0 });
  } else if (swing.count <= 2) {
    reasons.push({ text: `Lịch sử ít nhịp dao động lớn (${swing.count} nhịp ≥${swing.thresholdPct.toFixed(0)}% trong ${n} nến) — biên độ hẹp, cơ hội lướt nhịp mua đáy/bán đỉnh thấp`, dir: 0 });
  }

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
  if (obv > 0.15) add(1, 'OBV tăng — dòng khối lượng xác nhận lực mua');
  else if (obv < -0.15) add(-1, 'OBV giảm — dòng khối lượng xác nhận lực bán');
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

  // ==== Chốt chặn: không MUA ĐUỔI ở đỉnh, không BÁN THÁO ở đáy ====
  // Áp dụng vô điều kiện: mua chỉ đề xuất khi giá thấp, bán chỉ đề xuất khi giá cao —
  // kể cả khi động lượng cùng chiều còn mạnh (khi đó lời khuyên là nắm giữ/chờ, không đuổi lệnh).
  if (score > 0 && pos >= 0.70) {
    score *= 0.5;
    reasons.push({ text: `Điểm mua bị giảm 50% vì giá đã ở vùng cao (${posPct}% biên độ) — tránh mua đuổi đỉnh, chờ nhịp điều chỉnh`, dir: -1 });
  } else if (score < 0 && pos <= 0.30) {
    score *= 0.5;
    reasons.push({ text: `Điểm bán bị giảm 50% vì giá đã ở vùng đáy (${posPct}% biên độ) — tránh bán tháo ở đáy, khả năng hồi phục gần`, dir: 1 });
  }

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
    pricePos: pos, turnUp: turn.up, turnDown: turn.down, swing,
  };
}


/* ================= Quy tắc thông báo theo danh mục ================= */

// Ưu tiên cảnh báo theo danh mục: coin ĐANG GIỮ ưu tiên BÁN (bảo vệ vốn, báo cả BÁN thường),
// coin CHƯA GIỮ ưu tiên MUA (chỉ MUA MẠNH; BÁN coin không có là vô hành động).
//   cls: chuỗi cls của tín hiệu ('buy'|'buy strong'|'sell'|'sell strong'|'hold')
//   held: true/false theo danh mục, hoặc null nếu chưa có dữ liệu danh mục
//   watched: coin đang được ★ theo dõi đặc biệt
// Trả về mức ưu tiên 0-5 (0 = không báo; số càng lớn báo càng trước khi phải cắt bớt).
function alertPriority(cls, held, watched) {
  const isBuy = cls.startsWith('buy');
  const isSell = cls.startsWith('sell');
  if (!isBuy && !isSell) return 0;
  const strong = cls.includes('strong');
  if (held == null) return strong ? (isSell ? 2 : 1) : 0; // chưa kết nối API: hành vi cũ, chỉ tín hiệu MẠNH
  if (held) {
    if (isSell) return strong ? 5 : 4; // bảo vệ vốn: báo cả BÁN thường, không đợi BÁN MẠNH
    return strong ? 1 : 0;             // mua thêm coin đang giữ: ưu tiên thấp nhất
  }
  if (isBuy) return strong ? 3 : 0;    // cơ hội mua mới cho coin chưa có
  return strong && watched ? 2 : 0;    // BÁN coin chưa giữ: chỉ báo nếu đang ★ theo dõi
}

const HTF_MAP = { '15m': '1h', '1h': '4h', '4h': '1d', '1d': '1w', '1w': '1M' };

function parseKlines(raw) {
  return {
    times: raw.map(k => k[0]),
    // k[1..5]: open, high, low, close, volume · k[9]: taker buy base volume
    opens: raw.map(k => parseFloat(k[1])),
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
    pricePosition, reversalTurn, swingStats, alertPriority, buildSignal, parseKlines, HTF_MAP,
  };
}
