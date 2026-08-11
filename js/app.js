/* Coins — theo dõi thị trường crypto & đề xuất mua/bán (tham khảo)
 * Dữ liệu: Binance public API (không cần API key). Tỷ giá: open.er-api.com.
 */
'use strict';

const BINANCE = 'https://api.binance.com/api/v3';
const RATE_API = 'https://open.er-api.com/v6/latest/USD';
const FALLBACK_VND = 26300;           // dùng khi không lấy được tỷ giá
const TOP_N = 30;                     // số coin theo dõi (theo khối lượng 24h)
const TICKER_REFRESH_MS = 30_000;     // làm mới giá 30s
const ANALYSIS_REFRESH_MS = 5 * 60_000; // phân tích lại mỗi 5 phút
const KLINE_LIMIT = 200;

// Các cặp không phải "coin" thực sự (stablecoin, token đòn bẩy, tiền pháp định)
// Loại stablecoin (kể cả mọi base kết thúc bằng USD), tiền pháp định và token vàng
const EXCLUDE_BASE = /^(FDUSD|TUSD|BUSD|DAI|EUR|GBP|AEUR|EURI|PAXG|XAUT|WBTC)$|^USD|USD$/;
const EXCLUDE_SUFFIX = /(UP|DOWN|BULL|BEAR)$/;

const state = {
  rate: FALLBACK_VND,
  rateLive: false,
  interval: '1h',
  tickers: [],          // [{symbol, base, price, changePct, quoteVolume}]
  analysis: new Map(),  // symbol -> {score, verdict, reasons, rsi, ema20, ema50, macd, closes, times, klineIv}
  selected: null,
  search: '',
  sort: 'strength',   // strength | name | price | change | volume | rsi | score
  sortDir: 'desc',
  filter: 'all',
  watch: new Set(JSON.parse(localStorage.getItem('watchlist') || '[]')),
  extras: new Set(),   // coin người dùng tự nhập để phân tích (giữ trong phiên làm việc)
  scanning: false,
};

const $ = (id) => document.getElementById(id);

function saveWatch() {
  localStorage.setItem('watchlist', JSON.stringify([...state.watch]));
}

function toggleWatch(sym) {
  if (state.watch.has(sym)) state.watch.delete(sym);
  else state.watch.add(sym);
  saveWatch();
  renderTable();
  if (state.selected) renderDetail(state.selected);
}

// Escape chuỗi từ nguồn ngoài trước khi chèn vào innerHTML (chống XSS)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ================= Tiện ích định dạng ================= */

const nfVi = new Intl.NumberFormat('vi-VN');

function fmtUsd(p) {
  if (!isFinite(p)) return '—';
  let digits;
  if (p >= 1000) digits = 2;
  else if (p >= 1) digits = p >= 100 ? 2 : 4;
  else digits = Math.min(8, Math.max(4, 2 - Math.floor(Math.log10(p || 1e-8))));
  return p.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function fmtVnd(usd) {
  const v = usd * state.rate;
  if (!isFinite(v)) return '—';
  if (v >= 1e9) return nfVi.format(Math.round(v / 1e6) / 1e3) + ' tỷ ₫';
  if (v >= 1e6) return nfVi.format(Math.round(v / 1e3) / 1e3) + ' tr ₫';
  if (v >= 1000) return nfVi.format(Math.round(v)) + ' ₫';
  return v.toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' ₫';
}

function fmtCompactUsd(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

function fmtPct(x) {
  const s = x > 0 ? '+' : '';
  return s + x.toFixed(2) + '%';
}

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

function buildSignal(closes, ticker) {
  const n = closes.length;
  const last = closes[n - 1];
  const rsiArr = rsiSeries(closes);
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const { macd, signal, hist } = macdSeries(closes);

  const rsi = rsiArr[n - 1];
  const e20 = ema20[n - 1], e50 = ema50[n - 1];
  const h = hist[n - 1], hPrev = hist[n - 2];

  let score = 0;
  const reasons = []; // {text, dir: +1|-1|0}
  const add = (pts, text) => { score += pts; reasons.push({ text, dir: Math.sign(pts) }); };

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
      add(1, 'EMA20 nằm trên EMA50 — xu hướng ngắn hạn tăng');
      if (crossedWithin(ema20, ema50, 5)) add(1, 'EMA20 vừa cắt lên EMA50 (golden cross) trong vài nến gần đây');
    } else {
      add(-1, 'EMA20 nằm dưới EMA50 — xu hướng ngắn hạn giảm');
      if (crossedWithin(ema50, ema20, 5)) add(-1, 'EMA20 vừa cắt xuống EMA50 (death cross) trong vài nến gần đây');
    }
    if (last > e20 && last > e50) add(1, 'Giá đang đứng trên cả EMA20 và EMA50');
    else if (last < e20 && last < e50) add(-1, 'Giá đang nằm dưới cả EMA20 và EMA50');
  }

  // MACD
  if (h != null && hPrev != null) {
    if (h > 0 && hPrev <= 0) add(1, 'MACD vừa cắt lên đường tín hiệu — động lượng chuyển sang tích cực');
    else if (h < 0 && hPrev >= 0) add(-1, 'MACD vừa cắt xuống đường tín hiệu — động lượng chuyển sang tiêu cực');
    else if (h > 0) add(1, 'Histogram MACD dương — động lượng tăng vẫn duy trì');
    else add(-1, 'Histogram MACD âm — động lượng giảm vẫn duy trì');
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
  if (chg <= -6 && rsi != null && rsi < 38) add(1, `Giảm ${fmtPct(chg)} trong 24h kèm RSI thấp — cơ hội bắt đáy ngắn hạn (rủi ro cao)`);
  if (chg >= 9 && rsi != null && rsi > 65) add(-1, `Tăng ${fmtPct(chg)} trong 24h kèm RSI cao — dễ có nhịp chốt lời`);

  let verdict, cls;
  if (score >= 4)       { verdict = 'MUA MẠNH'; cls = 'buy strong'; }
  else if (score >= 2)  { verdict = 'MUA';      cls = 'buy'; }
  else if (score <= -4) { verdict = 'BÁN MẠNH'; cls = 'sell strong'; }
  else if (score <= -2) { verdict = 'BÁN';      cls = 'sell'; }
  else                  { verdict = 'GIỮ / THEO DÕI'; cls = 'hold'; }

  const trend = (e20 != null && e50 != null)
    ? (e20 > e50 ? (last > e20 ? 'Tăng ↗' : 'Tăng, đang điều chỉnh') : (last < e20 ? 'Giảm ↘' : 'Giảm, đang hồi'))
    : '—';

  return { score, verdict, cls, reasons, trend, rsi, ema20, ema50, macdObj: { macd, signal, hist }, rsiArr, momoUp, momoDown };
}

/* ================= Gọi API ================= */

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} khi gọi ${url}`);
  return res.json();
}

async function loadRate() {
  try {
    const cached = JSON.parse(localStorage.getItem('usdVnd') || 'null');
    if (cached && Date.now() - cached.t < 60 * 60_000) {
      state.rate = cached.v; state.rateLive = true;
    } else {
      const data = await fetchJson(RATE_API);
      if (data && data.rates && data.rates.VND) {
        state.rate = data.rates.VND;
        state.rateLive = true;
        localStorage.setItem('usdVnd', JSON.stringify({ v: state.rate, t: Date.now() }));
      }
    }
  } catch {
    state.rateLive = false; // giữ FALLBACK_VND
  }
  $('usdVndRate').textContent = nfVi.format(Math.round(state.rate)) + (state.rateLive ? '' : ' (ước tính)');
}

function mapTicker(t) {
  return {
    symbol: t.symbol,
    base: t.symbol.slice(0, -4),
    price: parseFloat(t.lastPrice),
    changePct: parseFloat(t.priceChangePercent),
    quoteVolume: parseFloat(t.quoteVolume),
    high: parseFloat(t.highPrice),
    low: parseFloat(t.lowPrice),
  };
}

async function loadTickers() {
  const data = await fetchJson(`${BINANCE}/ticker/24hr`);
  state.tickers = data
    .filter(t => t.symbol.endsWith('USDT'))
    .map(mapTicker)
    .filter(t => t.price > 0 && !EXCLUDE_BASE.test(t.base) && !EXCLUDE_SUFFIX.test(t.base))
    .sort((a, b) => b.quoteVolume - a.quoteVolume);
  const top = state.tickers.slice(0, TOP_N);
  // Coin theo dõi đặc biệt / coin người dùng tự nhập luôn được giữ lại kể cả khi ngoài top khối lượng
  for (const sym of new Set([...state.watch, ...state.extras])) {
    if (!top.some(t => t.symbol === sym)) {
      const extra = state.tickers.find(t => t.symbol === sym);
      if (extra) top.push(extra);
    }
  }
  state.tickers = top;
  $('lastUpdate').textContent = 'Cập nhật ' + new Date().toLocaleTimeString('vi-VN');
}

async function analyzeSymbol(sym) {
  const iv = state.interval;
  const raw = await fetchJson(`${BINANCE}/klines?symbol=${sym}&interval=${iv}&limit=${KLINE_LIMIT}`);
  const closes = raw.map(k => parseFloat(k[4]));
  const times = raw.map(k => k[0]);
  const ticker = state.tickers.find(t => t.symbol === sym) || { changePct: 0 };
  const sig = buildSignal(closes, ticker);
  state.analysis.set(sym, { ...sig, closes, times, klineIv: iv });
}

async function runAnalysis() {
  if (state.scanning) return;
  state.scanning = true;
  const syms = state.tickers.map(t => t.symbol);
  let done = 0;
  const workers = Array.from({ length: 5 }, async () => {
    while (syms.length) {
      const sym = syms.shift();
      try { await analyzeSymbol(sym); } catch { /* bỏ qua coin lỗi */ }
      done++;
      $('scanStatus').textContent = `Đang phân tích ${done}/${state.tickers.length}…`;
      if (done % 5 === 0) renderTable();
    }
  });
  await Promise.all(workers);
  state.scanning = false;
  $('scanStatus').textContent = `Đã phân tích ${state.analysis.size} coin · khung ${state.interval}`;
  renderTable();
  if (state.selected) renderDetail(state.selected);
}

// Nhập tên coin bất kỳ → tra cứu trên Binance, phân tích và hiển thị đánh giá
async function lookupCoin(qRaw) {
  const q = String(qRaw || '').trim().toUpperCase();
  if (!q) return;
  const sym = q.endsWith('USDT') ? q : q + 'USDT';
  let t = state.tickers.find(x => x.symbol === sym);
  if (!t) {
    $('scanStatus').textContent = `Đang tra cứu ${sym}…`;
    try {
      const d = await fetchJson(`${BINANCE}/ticker/24hr?symbol=${encodeURIComponent(sym)}`);
      t = mapTicker(d);
      state.tickers.push(t);
      state.extras.add(sym);
    } catch {
      $('scanStatus').textContent = `Không tìm thấy cặp ${sym} trên Binance — kiểm tra lại tên coin.`;
      return;
    }
  }
  state.selected = sym;
  renderTable();
  renderDetail(sym); // hiện giá ngay, chỉ báo hiện "đang phân tích"
  try {
    await analyzeSymbol(sym);
    $('scanStatus').textContent = `Đã phân tích ${sym} · khung ${state.interval}`;
  } catch {
    $('scanStatus').textContent = `Không tải được dữ liệu nến của ${sym}.`;
  }
  renderTable();
  renderDetail(sym);
}

/* ================= Bảng coin ================= */

function visibleTickers() {
  let list = state.tickers.slice();
  if (state.search) {
    const q = state.search.toUpperCase();
    list = list.filter(t => t.base.includes(q) || t.symbol.includes(q));
  }
  if (state.filter !== 'all') {
    list = list.filter(t => {
      const a = state.analysis.get(t.symbol);
      if (!a) return false;
      switch (state.filter) {
        case 'momoUp':   return a.momoUp;
        case 'momoDown': return a.momoDown;
        case 'buy':      return a.cls.startsWith('buy');
        case 'sell':     return a.cls.startsWith('sell');
        default:         return true;
      }
    });
  }
  if (state.filter === 'watch') {
    // riêng bộ lọc theo dõi không cần chờ phân tích xong
    list = state.tickers.filter(t => state.watch.has(t.symbol))
      .filter(t => !state.search || t.base.includes(state.search.toUpperCase()));
  }
  const keyVal = (t) => {
    const a = state.analysis.get(t.symbol);
    switch (state.sort) {
      case 'strength': return a ? Math.abs(a.score) : null;
      case 'name':     return t.base;
      case 'price':    return t.price;
      case 'change':   return t.changePct;
      case 'volume':   return t.quoteVolume;
      case 'rsi':      return a && a.rsi != null ? a.rsi : null;
      case 'score':    return a ? a.score : null;
      default:         return t.quoteVolume;
    }
  };
  const dir = state.sortDir === 'asc' ? 1 : -1;
  list.sort((x, y) => {
    const vx = keyVal(x), vy = keyVal(y);
    if (vx == null && vy == null) return y.quoteVolume - x.quoteVolume;
    if (vx == null) return 1;  // thiếu dữ liệu luôn xếp cuối
    if (vy == null) return -1;
    const cmp = typeof vx === 'string' ? vx.localeCompare(vy) : vx - vy;
    return cmp !== 0 ? dir * cmp : y.quoteVolume - x.quoteVolume;
  });
  // Coin theo dõi đặc biệt luôn ghim lên đầu (giữ nguyên thứ tự sắp xếp trong từng nhóm)
  return [...list.filter(t => state.watch.has(t.symbol)), ...list.filter(t => !state.watch.has(t.symbol))];
}

function badgeHtml(a) {
  if (!a) return '<span class="badge badge-hold"><span class="dot"></span>…</span>';
  const kind = a.cls.startsWith('buy') ? 'buy' : a.cls.startsWith('sell') ? 'sell' : 'hold';
  const strong = a.cls.includes('strong') ? ' badge-strong' : '';
  const icon = kind === 'buy' ? '▲' : kind === 'sell' ? '▼' : '•';
  return `<span class="badge badge-${kind}${strong}"><span class="dot"></span>${icon} ${a.verdict}</span>`;
}

function renderTable() {
  const rows = visibleTickers().map(t => {
    const a = state.analysis.get(t.symbol);
    const chgCls = t.changePct >= 0 ? 'chg-up' : 'chg-down';
    const sel = state.selected === t.symbol ? ' class="selected"' : '';
    const watched = state.watch.has(t.symbol);
    return `<tr data-sym="${esc(t.symbol)}"${sel}>
      <td><div class="coin-cell-row"><span class="star${watched ? ' on' : ''}" data-star="${esc(t.symbol)}" title="${watched ? 'Bỏ theo dõi đặc biệt' : 'Theo dõi đặc biệt'}">${watched ? '★' : '☆'}</span><div class="coin-cell"><span class="coin-sym">${esc(t.base)}</span><span class="coin-pair">${esc(t.symbol)}</span></div></div></td>
      <td class="num">${fmtUsd(t.price)}</td>
      <td class="num vnd-cell">${fmtVnd(t.price)}</td>
      <td class="num ${chgCls}">${fmtPct(t.changePct)}</td>
      <td class="num dim">${fmtCompactUsd(t.quoteVolume)}</td>
      <td class="num">${a && a.rsi != null ? a.rsi.toFixed(0) : '—'}</td>
      <td class="trend-cell">${a ? a.trend : '—'}${a && a.momoUp ? ' <span class="momo momo-up">MỚI ↗</span>' : ''}${a && a.momoDown ? ' <span class="momo momo-down">MỚI ↘</span>' : ''}</td>
      <td>${badgeHtml(a)}${a && a.momoUp ? ' <span class="momo momo-up momo-sm">↗</span>' : ''}${a && a.momoDown ? ' <span class="momo momo-down momo-sm">↘</span>' : ''}</td>
    </tr>`;
  }).join('');
  updateSortIndicators();
  const emptyMsg = state.filter === 'watch'
    ? 'Chưa có coin nào được đánh dấu ★. Bấm vào dấu ☆ cạnh tên coin để theo dõi đặc biệt.'
    : state.filter !== 'all' && !state.scanning
      ? 'Hiện chưa có coin nào khớp bộ lọc này. Đà thị trường thay đổi liên tục — hệ thống sẽ tự quét lại mỗi 5 phút.'
      : 'Không tìm thấy coin phù hợp.';
  $('coinRows').innerHTML = rows || `<tr><td colspan="8" class="loading-cell">${emptyMsg}</td></tr>`;
}

function updateSortIndicators() {
  document.querySelectorAll('#headRow th.sortable').forEach(th => {
    const ind = th.querySelector('.sort-ind');
    if (!ind) return;
    ind.textContent = th.dataset.key === state.sort ? (state.sortDir === 'asc' ? '▲' : '▼') : '';
  });
}

/* ================= Panel chi tiết ================= */

function renderDetail(sym) {
  const t = state.tickers.find(x => x.symbol === sym);
  const a = state.analysis.get(sym);
  if (!t) return;
  $('detailEmpty').hidden = true;
  $('detailBody').hidden = false;

  $('dName').textContent = `${t.base} / USDT`;
  const wb = $('dWatchBtn');
  const watched = state.watch.has(sym);
  wb.textContent = watched ? '★' : '☆';
  wb.className = 'star-btn' + (watched ? ' on' : '');
  $('dPriceUsd').textContent = fmtUsd(t.price) + ' USDT';
  $('dPriceVnd').textContent = '≈ ' + fmtVnd(t.price);
  const chgEl = $('dChange');
  chgEl.textContent = fmtPct(t.changePct) + ' (24h)';
  chgEl.className = 'chg ' + (t.changePct >= 0 ? 'chg-up' : 'chg-down');

  const v = $('dVerdict');
  if (a) {
    const kind = a.cls.startsWith('buy') ? 'buy' : a.cls.startsWith('sell') ? 'sell' : 'hold';
    v.className = 'verdict verdict-' + kind;
    v.innerHTML = `${a.verdict}<small>điểm tín hiệu: ${a.score > 0 ? '+' : ''}${a.score} · khung ${a.klineIv}</small>`;
  } else {
    v.className = 'verdict verdict-hold';
    v.textContent = 'Đang phân tích…';
  }

  const ul = $('dReasons');
  ul.innerHTML = a
    ? a.reasons.map(r => `<li class="${r.dir > 0 ? 'pos' : r.dir < 0 ? 'neg' : ''}">${r.text}</li>`).join('')
    : '<li>Đang tải dữ liệu nến…</li>';

  const grid = $('dIndicators');
  if (a) {
    const n = a.closes.length;
    const tiles = [
      ['RSI 14', a.rsi != null ? a.rsi.toFixed(1) : '—'],
      ['EMA 20', a.ema20[n - 1] != null ? fmtUsd(a.ema20[n - 1]) : '—'],
      ['EMA 50', a.ema50[n - 1] != null ? fmtUsd(a.ema50[n - 1]) : '—'],
      ['MACD hist', a.macdObj.hist[n - 1] != null ? a.macdObj.hist[n - 1].toPrecision(3) : '—'],
      ['Cao 24h', fmtUsd(t.high)],
      ['Thấp 24h', fmtUsd(t.low)],
    ];
    grid.innerHTML = tiles.map(([k, val]) => `<div class="ind-tile"><div class="k">${k}</div><div class="v">${val}</div></div>`).join('');
  } else grid.innerHTML = '';

  renderLegend();
  if (a) { drawPriceChart(a); drawRsiChart(a); }
  updateTradeUI();
}

function renderLegend() {
  $('priceLegend').innerHTML = [
    ['--series-1', 'Giá đóng nến'],
    ['--series-2', 'EMA 20'],
    ['--series-3', 'EMA 50'],
  ].map(([v, label]) => `<span class="key"><span class="swatch" style="background:var(${v})"></span>${label}</span>`).join('');
}

/* ================= Vẽ biểu đồ (canvas) ================= */

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

const PAD = { l: 8, r: 62, t: 10, b: 22 };
let hoverIdx = null;

function chartGeom(a, w, h) {
  const xs = a.times, n = xs.length;
  const series = [a.closes, a.ema20, a.ema50];
  let min = Infinity, max = -Infinity;
  for (const s of series) for (const v of s) if (v != null) { if (v < min) min = v; if (v > max) max = v; }
  const pad = (max - min) * 0.05 || max * 0.01;
  min -= pad; max += pad;
  const X = (i) => PAD.l + (i / (n - 1)) * (w - PAD.l - PAD.r);
  const Y = (v) => PAD.t + (1 - (v - min) / (max - min)) * (h - PAD.t - PAD.b);
  return { X, Y, min, max, n };
}

function drawLine(ctx, arr, X, Y, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null) continue;
    if (!started) { ctx.moveTo(X(i), Y(arr[i])); started = true; }
    else ctx.lineTo(X(i), Y(arr[i]));
  }
  ctx.stroke();
}

function drawPriceChart(a) {
  const canvas = $('priceChart');
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const { X, Y, min, max, n } = chartGeom(a, w, h);

  // lưới ngang + nhãn giá
  ctx.strokeStyle = cssVar('--grid');
  ctx.fillStyle = cssVar('--ink-muted');
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.lineWidth = 1;
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const v = min + (i / steps) * (max - min);
    const y = Math.round(Y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
    ctx.fillText(fmtUsd(v), w - PAD.r + 6, y + 3.5);
  }

  // nhãn thời gian (đầu / giữa / cuối)
  ctx.textAlign = 'center';
  const fmtT = (ms) => {
    const d = new Date(ms);
    return a.klineIv === '1d'
      ? d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
      : d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };
  [0, Math.floor(n / 2), n - 1].forEach((i, k) => {
    ctx.textAlign = k === 0 ? 'left' : k === 2 ? 'right' : 'center';
    ctx.fillText(fmtT(a.times[i]), X(i), h - 6);
  });

  drawLine(ctx, a.ema50, X, Y, cssVar('--series-3'));
  drawLine(ctx, a.ema20, X, Y, cssVar('--series-2'));
  drawLine(ctx, a.closes, X, Y, cssVar('--series-1'));

  // crosshair
  if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < n) {
    const x = Math.round(X(hoverIdx)) + 0.5;
    ctx.strokeStyle = cssVar('--axis');
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, h - PAD.b); ctx.stroke();
    ctx.setLineDash([]);
    const cv = a.closes[hoverIdx];
    if (cv != null) {
      ctx.fillStyle = cssVar('--series-1');
      ctx.beginPath(); ctx.arc(X(hoverIdx), Y(cv), 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = cssVar('--surface-1');
      ctx.lineWidth = 2; ctx.stroke();
    }
  }
}

function drawRsiChart(a) {
  const canvas = $('rsiChart');
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const n = a.times.length;
  const X = (i) => PAD.l + (i / (n - 1)) * (w - PAD.l - PAD.r);
  const Y = (v) => 4 + (1 - v / 100) * (h - 8);

  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.lineWidth = 1;
  for (const lv of [70, 50, 30]) {
    const y = Math.round(Y(lv)) + 0.5;
    ctx.strokeStyle = lv === 50 ? cssVar('--grid') : cssVar('--axis');
    ctx.setLineDash(lv === 50 ? [] : [4, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
    ctx.fillStyle = cssVar('--ink-muted');
    ctx.fillText(String(lv), w - PAD.r + 6, y + 3.5);
  }
  ctx.setLineDash([]);
  drawLine(ctx, a.rsiArr.map(v => v == null ? null : v), X, Y, cssVar('--series-1'));
}

function redrawCharts() {
  const a = state.selected && state.analysis.get(state.selected);
  if (a) { drawPriceChart(a); drawRsiChart(a); }
}

/* ==== Thanh kéo chia đôi màn hình (màn hình lớn) ==== */

function initSplitter() {
  const layout = document.querySelector('.layout');
  const sp = $('splitter');
  if (!layout || !sp) return;

  const saved = parseFloat(localStorage.getItem('splitPct'));
  if (saved >= 30 && saved <= 72) layout.style.setProperty('--split', saved + '%');

  const pctFromEvent = (e) => {
    const r = layout.getBoundingClientRect();
    return Math.max(30, Math.min(72, ((e.clientX - r.left) / r.width) * 100));
  };

  let dragging = false;
  sp.addEventListener('pointerdown', (e) => {
    dragging = true;
    sp.classList.add('dragging');
    sp.setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
  });
  sp.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    layout.style.setProperty('--split', pctFromEvent(e) + '%');
    requestAnimationFrame(redrawCharts);
  });
  sp.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    sp.classList.remove('dragging');
    document.body.style.userSelect = '';
    localStorage.setItem('splitPct', pctFromEvent(e).toFixed(1));
    redrawCharts();
  });
  sp.addEventListener('dblclick', () => {
    layout.style.removeProperty('--split');
    localStorage.removeItem('splitPct');
    redrawCharts();
  });
}

/* ==== Tooltip / crosshair cho biểu đồ giá ==== */

function bindChartHover() {
  const canvas = $('priceChart');
  const tip = $('chartTip');
  const holder = canvas.parentElement;

  canvas.addEventListener('mousemove', (e) => {
    const a = state.selected && state.analysis.get(state.selected);
    if (!a) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const n = a.times.length;
    const frac = (x - PAD.l) / (rect.width - PAD.l - PAD.r);
    const idx = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
    if (idx !== hoverIdx) {
      hoverIdx = idx;
      drawPriceChart(a);
    }
    const d = new Date(a.times[idx]);
    const timeStr = d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const row = (color, label, val) =>
      `<div class="tt-row"><span class="k"><span class="swatch" style="display:inline-block;width:10px;height:2px;background:${cssVar(color)}"></span>${label}</span><span>${val}</span></div>`;
    tip.innerHTML =
      `<div class="tt-time">${timeStr}</div>` +
      row('--series-1', 'Giá', fmtUsd(a.closes[idx])) +
      (a.ema20[idx] != null ? row('--series-2', 'EMA20', fmtUsd(a.ema20[idx])) : '') +
      (a.ema50[idx] != null ? row('--series-3', 'EMA50', fmtUsd(a.ema50[idx])) : '') +
      `<div class="tt-row"><span class="k">VND</span><span>${fmtVnd(a.closes[idx])}</span></div>`;
    tip.hidden = false;
    const tipW = tip.offsetWidth;
    const px = x + 14 + tipW > rect.width ? x - tipW - 14 : x + 14;
    tip.style.left = px + 'px';
    tip.style.top = '12px';
  });

  holder.addEventListener('mouseleave', () => {
    tip.hidden = true;
    const a = state.selected && state.analysis.get(state.selected);
    hoverIdx = null;
    if (a) drawPriceChart(a);
  });
}

/* ================= Giao dịch Binance (API key phía client) ================= */
/* Khóa API chỉ lưu localStorage của trình duyệt; lệnh ký HMAC-SHA256 bằng Web Crypto
 * và gửi thẳng tới Binance — không đi qua bất kỳ server trung gian nào. */

const trade = {
  side: 'BUY',
  confirming: false,
  confirmTimer: null,
  timeOffset: 0,
  filters: new Map(), // symbol -> {stepSize, minQty}
  balances: null,     // {USDT: n, <base>: n}
};

function getTradeCfg() {
  try { return JSON.parse(localStorage.getItem('binanceApi') || 'null'); }
  catch { return null; }
}

function tradeBase(cfg) {
  return cfg && cfg.testnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
}

async function hmacHex(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function syncServerTime(cfg) {
  try {
    const d = await fetchJson(`${tradeBase(cfg)}/api/v3/time`);
    trade.timeOffset = d.serverTime - Date.now();
  } catch { trade.timeOffset = 0; }
}

async function signedFetch(path, params = {}, method = 'GET') {
  const cfg = getTradeCfg();
  if (!cfg) throw new Error('Chưa cấu hình API');
  const q = new URLSearchParams({ ...params, recvWindow: 10000, timestamp: Date.now() + trade.timeOffset }).toString();
  const sig = await hmacHex(cfg.secret, q);
  const res = await fetch(`${tradeBase(cfg)}${path}?${q}&signature=${sig}`, {
    method,
    headers: { 'X-MBX-APIKEY': cfg.key },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || `Lỗi HTTP ${res.status}`);
  return data;
}

async function loadBalances(sym) {
  const base = sym.slice(0, -4);
  const acc = await signedFetch('/api/v3/account', { omitZeroBalances: 'true' });
  const out = { USDT: 0, [base]: 0 };
  for (const b of acc.balances || []) {
    if (b.asset === 'USDT') out.USDT = parseFloat(b.free);
    if (b.asset === base) out[base] = parseFloat(b.free);
  }
  trade.balances = out;
  return out;
}

async function getSymbolFilter(sym) {
  if (trade.filters.has(sym)) return trade.filters.get(sym);
  const cfg = getTradeCfg();
  const d = await fetchJson(`${tradeBase(cfg)}/api/v3/exchangeInfo?symbol=${encodeURIComponent(sym)}`);
  const lot = ((d.symbols && d.symbols[0] && d.symbols[0].filters) || []).find(f => f.filterType === 'LOT_SIZE') || {};
  const f = { stepSize: parseFloat(lot.stepSize) || 0, minQty: parseFloat(lot.minQty) || 0 };
  trade.filters.set(sym, f);
  return f;
}

function roundToStep(qty, step) {
  if (!step) return qty;
  const rounded = Math.floor(qty / step) * step;
  const decimals = Math.max(0, (String(step).split('.')[1] || '').replace(/0+$/, '').length);
  return parseFloat(rounded.toFixed(decimals));
}

function resetConfirm() {
  trade.confirming = false;
  clearTimeout(trade.confirmTimer);
  updateTradeButton();
}

function updateTradeButton() {
  const btn = $('tradeSubmit');
  const isBuy = trade.side === 'BUY';
  btn.className = 'btn trade-submit ' + (isBuy ? 'buy' : 'sell') + (trade.confirming ? ' confirming' : '');
  if (trade.confirming) {
    const amt = $('tradeAmount').value;
    const unit = isBuy ? 'USDT' : (state.selected || '').slice(0, -4);
    btn.textContent = `⚠ Bấm lần nữa để XÁC NHẬN ${isBuy ? 'MUA' : 'BÁN'} ${amt} ${unit}`;
  } else {
    btn.textContent = `Đặt lệnh ${isBuy ? 'MUA' : 'BÁN'} (market)`;
  }
}

function updateTradeUI() {
  const cfg = getTradeCfg();
  const box = $('tradeBox');
  const hint = $('tradeHint');
  if (!cfg || !state.selected) {
    box.hidden = true;
    hint.hidden = !state.selected;
    return;
  }
  box.hidden = false;
  hint.hidden = true;
  $('tradeEnv').textContent = cfg.testnet ? 'TESTNET' : 'TIỀN THẬT';
  $('tradeAmount').placeholder = trade.side === 'BUY' ? 'Số USDT muốn chi' : 'Số coin muốn bán';
  $('tradeUnit').textContent = trade.side === 'BUY' ? 'USDT' : state.selected.slice(0, -4);
  updateTradeButton();
  refreshBalances();
}

async function refreshBalances(force = false) {
  const sym = state.selected;
  if (!sym || !getTradeCfg()) return;
  // renderDetail chạy mỗi 30s — chỉ tải lại số dư khi đổi coin, sau lệnh, hoặc quá 60s
  if (!force && trade.lastBalanceSym === sym && Date.now() - trade.lastBalanceAt < 60_000) return;
  trade.lastBalanceSym = sym;
  trade.lastBalanceAt = Date.now();
  const base = sym.slice(0, -4);
  $('tradeBalances').textContent = 'Đang tải số dư…';
  try {
    const b = await loadBalances(sym);
    if (state.selected !== sym) return; // người dùng đã chọn coin khác
    $('tradeBalances').textContent = `Khả dụng: ${b.USDT.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT · ${b[base].toLocaleString('en-US', { maximumFractionDigits: 8 })} ${base}`;
  } catch (e) {
    $('tradeBalances').textContent = 'Không tải được số dư: ' + e.message;
  }
}

async function submitTrade() {
  const sym = state.selected;
  const cfg = getTradeCfg();
  if (!sym || !cfg) return;
  const amt = parseFloat($('tradeAmount').value);
  const out = $('tradeResult');
  out.className = 'trade-result';
  if (!(amt > 0)) { out.textContent = 'Nhập số lượng hợp lệ trước.'; return; }

  // Bước 1: yêu cầu xác nhận; tự hủy sau 6 giây
  if (!trade.confirming) {
    trade.confirming = true;
    updateTradeButton();
    clearTimeout(trade.confirmTimer);
    trade.confirmTimer = setTimeout(resetConfirm, 6000);
    return;
  }
  resetConfirm();

  const btn = $('tradeSubmit');
  btn.disabled = true;
  out.textContent = 'Đang gửi lệnh…';
  try {
    const params = { symbol: sym, side: trade.side, type: 'MARKET' };
    if (trade.side === 'BUY') {
      params.quoteOrderQty = amt;
    } else {
      const f = await getSymbolFilter(sym);
      const qty = roundToStep(amt, f.stepSize);
      if (!(qty > 0) || qty < f.minQty) throw new Error(`Số lượng quá nhỏ (tối thiểu ${f.minQty})`);
      params.quantity = qty;
    }
    const r = await signedFetch('/api/v3/order', params, 'POST');
    const spent = parseFloat(r.cummulativeQuoteQty || 0);
    const got = parseFloat(r.executedQty || 0);
    out.className = 'trade-result ok';
    out.textContent = `✔ Lệnh ${r.side} ${r.symbol} khớp (${r.status})\n` +
      `Khối lượng: ${got} ${sym.slice(0, -4)} · Giá trị: ${spent.toFixed(2)} USDT` +
      (got > 0 ? ` · Giá TB: ${(spent / got).toPrecision(6)}` : '');
    refreshBalances(true);
  } catch (e) {
    out.className = 'trade-result err';
    out.textContent = '✖ Lệnh thất bại: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

/* ==== Dialog cấu hình API ==== */

function bindApiDialog() {
  const dlg = $('apiDialog');
  const status = $('apiStatus');

  $('apiBtn').addEventListener('click', () => {
    const cfg = getTradeCfg();
    $('apiKeyInput').value = cfg ? cfg.key : '';
    $('apiSecretInput').value = cfg ? cfg.secret : '';
    $('apiTestnet').checked = cfg ? !!cfg.testnet : true; // mặc định gợi ý testnet
    status.textContent = '';
    status.className = 'api-status';
    dlg.showModal();
  });

  $('apiCloseBtn').addEventListener('click', () => dlg.close());

  $('apiDeleteBtn').addEventListener('click', () => {
    localStorage.removeItem('binanceApi');
    $('apiKeyInput').value = '';
    $('apiSecretInput').value = '';
    status.textContent = 'Đã xóa khóa API khỏi trình duyệt.';
    status.className = 'api-status ok';
    updateTradeUI();
  });

  $('apiSaveBtn').addEventListener('click', async () => {
    const key = $('apiKeyInput').value.trim();
    const secret = $('apiSecretInput').value.trim();
    const testnet = $('apiTestnet').checked;
    if (!key || !secret) {
      status.textContent = 'Nhập đủ API Key và Secret.';
      status.className = 'api-status err';
      return;
    }
    if (!window.isSecureContext || !crypto.subtle) {
      status.textContent = 'Trình duyệt chặn ký HMAC ở ngữ cảnh không an toàn — hãy mở app qua HTTPS hoặc localhost (không dùng file://).';
      status.className = 'api-status err';
      return;
    }
    localStorage.setItem('binanceApi', JSON.stringify({ key, secret, testnet }));
    status.textContent = 'Đang kiểm tra kết nối…';
    status.className = 'api-status';
    try {
      await syncServerTime({ testnet });
      const acc = await signedFetch('/api/v3/account', { omitZeroBalances: 'true' });
      const n = (acc.balances || []).length;
      status.textContent = `✔ Kết nối thành công (${testnet ? 'Testnet' : 'Binance thật'}) — ${n} loại tài sản có số dư. Quyền giao dịch: ${acc.canTrade ? 'CÓ' : 'KHÔNG'}.`;
      status.className = 'api-status ok';
      updateTradeUI();
    } catch (e) {
      status.textContent = '✖ Kết nối thất bại: ' + e.message;
      status.className = 'api-status err';
    }
  });
}

function bindTradeEvents() {
  $('tradeSide').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-side]');
    if (!btn) return;
    trade.side = btn.dataset.side;
    document.querySelectorAll('#tradeSide button').forEach(b => b.classList.toggle('active', b === btn));
    resetConfirm();
    $('tradeResult').textContent = '';
    $('tradeResult').className = 'trade-result';
    updateTradeUI();
  });

  $('tradeMax').addEventListener('click', () => {
    if (!trade.balances || !state.selected) return;
    const base = state.selected.slice(0, -4);
    $('tradeAmount').value = trade.side === 'BUY' ? trade.balances.USDT : trade.balances[base];
    resetConfirm();
  });

  $('tradeAmount').addEventListener('input', resetConfirm);
  $('tradeSubmit').addEventListener('click', submitTrade);
}

/* ================= Sự kiện & khởi động ================= */

function bindEvents() {
  $('coinRows').addEventListener('click', (e) => {
    const star = e.target.closest('.star[data-star]');
    if (star) {
      toggleWatch(star.dataset.star);
      return;
    }
    const tr = e.target.closest('tr[data-sym]');
    if (!tr) return;
    state.selected = tr.dataset.sym;
    renderTable();
    renderDetail(state.selected);
  });

  $('dWatchBtn').addEventListener('click', () => {
    if (state.selected) toggleWatch(state.selected);
  });

  $('searchBox').addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    renderTable();
  });

  $('searchBox').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lookupCoin(e.target.value);
  });

  $('lookupBtn').addEventListener('click', () => lookupCoin($('searchBox').value));

  $('sortSel').addEventListener('change', (e) => {
    state.sort = e.target.value;
    state.sortDir = state.sort === 'name' ? 'asc' : 'desc';
    renderTable();
  });

  $('filterSel').addEventListener('change', (e) => {
    state.filter = e.target.value;
    renderTable();
  });

  // Bấm tiêu đề cột để sắp xếp (bấm lần nữa để đảo chiều)
  $('headRow').addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const key = th.dataset.key;
    if (state.sort === key) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sort = key;
      state.sortDir = key === 'name' ? 'asc' : 'desc';
    }
    renderTable();
  });

  $('intervalSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-iv]');
    if (!btn || btn.dataset.iv === state.interval) return;
    state.interval = btn.dataset.iv;
    document.querySelectorAll('#intervalSeg button').forEach(b => b.classList.toggle('active', b === btn));
    state.analysis.clear();
    renderTable();
    if (state.selected) renderDetail(state.selected);
    runAnalysis();
  });

  $('refreshBtn').addEventListener('click', async () => {
    await loadTickers();
    renderTable();
    runAnalysis();
  });

  window.addEventListener('resize', redrawCharts);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawCharts);

  bindChartHover();
  initSplitter();
  bindApiDialog();
  bindTradeEvents();
}

async function init() {
  bindEvents();
  const tradeCfg = getTradeCfg();
  if (tradeCfg) syncServerTime(tradeCfg); // bù lệch giờ máy để chữ ký lệnh không bị từ chối
  await loadRate();
  try {
    await loadTickers();
  } catch (err) {
    $('coinRows').innerHTML =
      '<tr><td colspan="8" class="loading-cell">Không tải được dữ liệu từ Binance. Kiểm tra kết nối mạng rồi bấm "Làm mới".<br><span class="dim">' +
      esc(err) + '</span></td></tr>';
    return;
  }
  renderTable();
  runAnalysis();

  setInterval(async () => {
    try {
      await loadTickers();
      renderTable();
      if (state.selected) renderDetail(state.selected);
    } catch { /* giữ dữ liệu cũ */ }
  }, TICKER_REFRESH_MS);

  setInterval(() => runAnalysis(), ANALYSIS_REFRESH_MS);
  setInterval(() => loadRate(), 60 * 60_000);
}

init();
