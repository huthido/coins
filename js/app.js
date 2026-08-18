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
  interval: '1d',
  tickers: [],          // [{symbol, base, price, changePct, quoteVolume}]
  analysis: new Map(),  // symbol -> {score, verdict, reasons, rsi, ema20, ema50, macd, closes, times, klineIv}
  selected: null,
  search: '',
  sort: 'strength',   // strength | name | price | change | volume | rsi | score
  sortDir: 'desc',
  filter: 'all',
  assetType: 'all',
  view: localStorage.getItem('view') === 'heat' ? 'heat' : 'table',      // bảng | bản đồ nhiệt
  chartMode: localStorage.getItem('chartMode') === 'line' ? 'line' : 'candle', // nến | đường
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

/* ==== Phân loại tài sản ==== */

const ASSET_LABELS = {
  l1: 'Layer 1', l2: 'Layer 2', defi: 'DeFi', meme: 'Meme', ai: 'AI & Dữ liệu',
  gaming: 'Gaming/NFT', payment: 'Thanh toán', exchange: 'Token sàn',
  privacy: 'Riêng tư', infra: 'Hạ tầng', other: '',
};

const ASSET_TYPES = {
  // Layer 1
  BTC: 'l1', ETH: 'l1', SOL: 'l1', ADA: 'l1', AVAX: 'l1', DOT: 'l1', TRX: 'l1',
  ATOM: 'l1', NEAR: 'l1', APT: 'l1', SUI: 'l1', TON: 'l1', ICP: 'l1', ALGO: 'l1',
  XTZ: 'l1', EGLD: 'l1', S: 'l1', FTM: 'l1', SEI: 'l1', INJ: 'l1', KAS: 'l1',
  HBAR: 'l1', ETC: 'l1', TIA: 'l1', DYM: 'l1', CELO: 'l1', KAVA: 'l1', ROSE: 'l1',
  ONE: 'l1', WAVES: 'l1', TRUMP: 'meme', BERA: 'l1', MOVE: 'l1', MMT: 'l1',
  // Layer 2
  OP: 'l2', ARB: 'l2', MATIC: 'l2', POL: 'l2', STRK: 'l2', IMX: 'l2', MNT: 'l2',
  ZK: 'l2', METIS: 'l2', BLAST: 'l2', SCROLL: 'l2', LINEA: 'l2', TAIKO: 'l2',
  // DeFi
  UNI: 'defi', AAVE: 'defi', MKR: 'defi', CRV: 'defi', LDO: 'defi', SNX: 'defi',
  COMP: 'defi', SUSHI: 'defi', CAKE: 'defi', RUNE: 'defi', JUP: 'defi',
  PENDLE: 'defi', ENA: 'defi', DYDX: 'defi', GMX: 'defi', RAY: 'defi',
  '1INCH': 'defi', BAL: 'defi', YFI: 'defi', JTO: 'defi', ONDO: 'defi',
  MORPHO: 'defi', AERO: 'defi', HYPE: 'defi', CRV3: 'defi', BICO: 'infra',
  // Meme
  DOGE: 'meme', SHIB: 'meme', PEPE: 'meme', WIF: 'meme', BONK: 'meme',
  FLOKI: 'meme', MEME: 'meme', BOME: 'meme', MUBARAK: 'meme', BABY: 'meme',
  NEIRO: 'meme', PNUT: 'meme', ACT: 'meme', DOGS: 'meme', TST: 'meme', PUMP: 'meme',
  // AI & Dữ liệu
  FET: 'ai', RENDER: 'ai', RNDR: 'ai', TAO: 'ai', WLD: 'ai', ARKM: 'ai',
  NMR: 'ai', GRT: 'ai', OCEAN: 'ai', AI: 'ai', VIRTUAL: 'ai', AIXBT: 'ai',
  // Gaming / NFT
  SAND: 'gaming', MANA: 'gaming', AXS: 'gaming', GALA: 'gaming', ENJ: 'gaming',
  APE: 'gaming', RON: 'gaming', PIXEL: 'gaming', BEAM: 'gaming', YGG: 'gaming',
  // Thanh toán
  XRP: 'payment', XLM: 'payment', LTC: 'payment', BCH: 'payment', DASH: 'payment',
  // Token sàn
  BNB: 'exchange', OKB: 'exchange', CRO: 'exchange', KCS: 'exchange', GT: 'exchange',
  // Riêng tư
  XMR: 'privacy', ZEC: 'privacy', SCRT: 'privacy',
  // Hạ tầng / Lưu trữ
  FIL: 'infra', AR: 'infra', STORJ: 'infra', LINK: 'infra', PYTH: 'infra',
  ENS: 'infra', W: 'infra', AXL: 'infra', STX: 'infra', ICX: 'infra',
};

const assetType = (base) => ASSET_TYPES[base] || 'other';
const assetLabel = (base) => ASSET_LABELS[assetType(base)];

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

/* Chỉ báo kỹ thuật & bộ chấm điểm: xem js/engine.js (dùng chung với server push) */

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

// Cấu hình từng khung: nến dùng để phân tích + số nến tải về
// '1y' = nến ngày trải 365 nến (Binance không có nến 1 năm)
const IV_CONF = {
  '15m': { iv: '15m', limit: 200 },
  '1h':  { iv: '1h',  limit: 200 },
  '4h':  { iv: '4h',  limit: 200 },
  '1d':  { iv: '1d',  limit: 200 },
  '1w':  { iv: '1w',  limit: 200 },
  '1M':  { iv: '1M',  limit: 120 },
  '1y':  { iv: '1d',  limit: 365 },
};
const IV_LABEL = {
  '15m': '15 phút', '1h': '1 giờ', '4h': '4 giờ', '1d': '1 ngày',
  '1w': '1 tuần', '1M': '1 tháng', '1y': '1 năm (nến ngày)',
};

async function analyzeSymbol(sym) {
  const iv = state.interval;
  const conf = IV_CONF[iv] || { iv, limit: 200 };
  const hIv = HTF_MAP[conf.iv]; // nến 1 tháng không có khung lớn hơn
  const [raw, rawH] = await Promise.all([
    fetchJson(`${BINANCE}/klines?symbol=${sym}&interval=${conf.iv}&limit=${conf.limit}`),
    hIv ? fetchJson(`${BINANCE}/klines?symbol=${sym}&interval=${hIv}&limit=120`).catch(() => null) : Promise.resolve(null),
  ]);
  const d = parseKlines(raw);
  const dH = rawH ? parseKlines(rawH) : null;
  const ticker = state.tickers.find(t => t.symbol === sym) || { changePct: 0 };
  const sig = buildSignal(d, dH, ticker);
  state.analysis.set(sym, {
    ...sig,
    closes: d.closes, opens: d.opens, highs: d.highs, lows: d.lows,
    volumes: d.volumes, times: d.times, klineIv: iv,
  });
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
  $('scanStatus').textContent = `Đã phân tích ${state.analysis.size} coin · khung ${IV_LABEL[state.interval] || state.interval}`;
  renderTable();
  if (state.selected) renderDetail(state.selected);
  checkSignalAlerts();
}

/* ==== Thông tin thị trường chung ==== */

async function loadMarketInfo() {
  try {
    const f = await fetchJson('https://api.alternative.me/fng/?limit=1');
    const v = parseInt(f.data[0].value, 10);
    const label = v <= 24 ? 'Sợ hãi cực độ' : v <= 44 ? 'Sợ hãi' : v <= 55 ? 'Trung lập' : v <= 74 ? 'Tham lam' : 'Tham lam cực độ';
    const el = $('mFng');
    el.textContent = `${v} · ${label}`;
    el.className = 'v ' + (v <= 44 ? 'chg-down' : v >= 56 ? 'chg-up' : '');
  } catch { /* giữ giá trị cũ */ }
  try {
    const g = await fetchJson('https://api.coingecko.com/api/v3/global');
    $('mDom').textContent = g.data.market_cap_percentage.btc.toFixed(1) + '%';
    const chg = g.data.market_cap_change_percentage_24h_usd;
    const el = $('mMcap');
    el.textContent = '$' + fmtCompactUsd(g.data.total_market_cap.usd) + ' · ' + fmtPct(chg);
    el.className = 'v ' + (chg >= 0 ? 'chg-up' : 'chg-down');
  } catch { /* giữ giá trị cũ */ }
  $('marketBar').hidden = false;
}

function updateBreadth() {
  if (!state.tickers.length) return;
  const ups = state.tickers.filter(t => t.changePct > 0).length;
  const el = $('mBreadth');
  el.textContent = `${ups}/${state.tickers.length} coin tăng 24h`;
  el.className = 'v ' + (ups >= state.tickers.length * 0.6 ? 'chg-up' : ups <= state.tickers.length * 0.4 ? 'chg-down' : '');
  $('marketBar').hidden = false;
}

/* ==== Thông tin sâu của coin đang chọn (sổ lệnh + funding futures) ==== */

const coinExtras = { sym: null, at: 0 };

async function loadCoinExtras(sym) {
  if (coinExtras.sym === sym && Date.now() - coinExtras.at < 60_000) return;
  coinExtras.sym = sym;
  coinExtras.at = Date.now();
  const el = $('dExtras');
  el.innerHTML = '';
  const tiles = [];
  try {
    const depth = await fetchJson(`${BINANCE}/depth?symbol=${encodeURIComponent(sym)}&limit=100`);
    const sum = (side) => side.reduce((s, [p, q]) => s + parseFloat(p) * parseFloat(q), 0);
    const bid = sum(depth.bids), ask = sum(depth.asks);
    if (bid + ask > 0) {
      const pct = (bid / (bid + ask)) * 100;
      tiles.push(['Sổ lệnh (bid)', pct.toFixed(0) + '% mua', pct >= 55 ? 1 : pct <= 45 ? -1 : 0]);
    }
  } catch { /* coin không có dữ liệu depth */ }
  try {
    const f = await fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(sym)}`);
    const fr = parseFloat(f.lastFundingRate) * 100;
    if (isFinite(fr)) {
      const note = fr >= 0.03 ? ' · long đông' : fr <= -0.01 ? ' · short đông' : '';
      tiles.push(['Funding futures', fr.toFixed(4) + '%' + note, fr >= 0.03 ? -1 : fr <= -0.01 ? 1 : 0]);
    }
  } catch { /* coin không có hợp đồng futures */ }
  if (state.selected !== sym) return;
  el.innerHTML = tiles.map(([k, v, dir]) =>
    `<div class="ind-tile"><div class="k">${k}</div><div class="v ${dir > 0 ? 'chg-up' : dir < 0 ? 'chg-down' : ''}">${v}</div></div>`
  ).join('');
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
    $('scanStatus').textContent = `Đã phân tích ${sym} · khung ${IV_LABEL[state.interval] || state.interval}`;
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
  if (state.filter === 'holding') {
    list = state.tickers.filter(t => holdings.set && holdings.set.has(t.base))
      .filter(t => !state.search || t.base.includes(state.search.toUpperCase()));
  }
  if (state.assetType !== 'all') {
    list = list.filter(t => assetType(t.base) === state.assetType);
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
    const holdQty = state.filter === 'holding' && holdings.amt.has(t.base)
      ? ' · giữ ' + holdings.amt.get(t.base).toLocaleString('en-US', { maximumFractionDigits: 6 })
      : '';
    return `<tr data-sym="${esc(t.symbol)}"${sel}>
      <td><div class="coin-cell-row"><span class="star${watched ? ' on' : ''}" data-star="${esc(t.symbol)}" title="${watched ? 'Bỏ theo dõi đặc biệt' : 'Theo dõi đặc biệt'}">${watched ? '★' : '☆'}</span><div class="coin-cell"><span class="coin-sym">${esc(t.base)}</span><span class="coin-pair">${esc(t.symbol)}${assetLabel(t.base) ? ' · ' + assetLabel(t.base) : ''}${holdQty}</span></div></div></td>
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
  const emptyMsg = state.filter === 'holding'
    ? (holdings.set ? 'Tài khoản chưa giữ coin nào có cặp USDT (hoặc chỉ giữ stablecoin).' : 'Đang tải danh mục tài sản… Nếu không có gì hiện ra, kiểm tra kết nối API (⚙️).')
    : state.filter === 'watch'
    ? 'Chưa có coin nào được đánh dấu ★. Bấm vào dấu ☆ cạnh tên coin để theo dõi đặc biệt.'
    : state.assetType !== 'all' && state.filter === 'all' && !state.search
      ? 'Không có coin loại này trong danh sách đang theo dõi (top khối lượng + coin đánh dấu ★). Dùng ô tìm kiếm để phân tích coin cụ thể.'
      : state.filter !== 'all' && !state.scanning
        ? 'Hiện chưa có coin nào khớp bộ lọc này. Đà thị trường thay đổi liên tục — hệ thống sẽ tự quét lại mỗi 5 phút.'
        : 'Không tìm thấy coin phù hợp.';
  $('coinRows').innerHTML = rows || `<tr><td colspan="8" class="loading-cell">${emptyMsg}</td></tr>`;
  if (state.view === 'heat') drawHeatmap();
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
    v.innerHTML = `${a.verdict}<small>điểm tín hiệu: ${a.score > 0 ? '+' : ''}${a.score} · khung ${IV_LABEL[a.klineIv] || a.klineIv}</small>`;
  } else {
    v.className = 'verdict verdict-hold';
    v.textContent = 'Đang phân tích…';
  }

  const ul = $('dReasons');
  ul.innerHTML = a
    ? a.reasons.map(r => `<li class="${r.dir > 0 ? 'pos' : r.dir < 0 ? 'neg' : ''}">${r.text}</li>`).join('')
    : '<li>Đang tải dữ liệu nến…</li>';

  const risk = $('dRisk');
  if (a && a.risk) {
    const r = a.risk;
    risk.hidden = false;
    risk.innerHTML = `📐 Biến động (ATR): <strong>${r.atrPct.toFixed(2)}%/nến</strong> · ` +
      `Nếu MUA — gợi ý cắt lỗ ~<strong>${fmtUsd(r.longSL)}</strong> (−${((1 - r.longSL / t.price) * 100).toFixed(1)}%), ` +
      `chốt lời ~<strong>${fmtUsd(r.longTP)}</strong> (+${((r.longTP / t.price - 1) * 100).toFixed(1)}%) — tỷ lệ lời:lỗ ≈ 1.7`;
  } else risk.hidden = true;

  const grid = $('dIndicators');
  if (a) {
    const n = a.closes.length;
    const tiles = [
      ['RSI 14', a.rsi != null ? a.rsi.toFixed(1) : '—'],
      ['ADX (sức mạnh)', a.adx != null ? a.adx.toFixed(0) + (a.adx >= 25 ? ' · mạnh' : a.adx < 20 ? ' · sideway' : '') : '—'],
      ['SuperTrend', a.st === 1 ? 'Tăng ↗' : a.st === -1 ? 'Giảm ↘' : '—'],
      ['Khung lớn hơn', a.htf === 1 ? 'Tăng ↗' : a.htf === -1 ? 'Giảm ↘' : 'Trung tính'],
      ['EMA 20', a.ema20[n - 1] != null ? fmtUsd(a.ema20[n - 1]) : '—'],
      ['EMA 50', a.ema50[n - 1] != null ? fmtUsd(a.ema50[n - 1]) : '—'],
      ['MACD hist', a.macdObj.hist[n - 1] != null ? a.macdObj.hist[n - 1].toPrecision(3) : '—'],
      ['Bollinger %B', a.boll ? (a.boll.pctB * 100).toFixed(0) + '%' + (a.boll.squeeze ? ' · squeeze' : '') : '—'],
      ['Mua chủ động', a.takerRatio != null ? (a.takerRatio * 100).toFixed(0) + '%' : '—'],
      ['Cao 24h', fmtUsd(t.high)],
      ['Thấp 24h', fmtUsd(t.low)],
    ];
    grid.innerHTML = tiles.map(([k, val]) => `<div class="ind-tile"><div class="k">${k}</div><div class="v">${val}</div></div>`).join('');
  } else grid.innerHTML = '';
  loadCoinExtras(sym);

  renderLegend();
  if (a) { drawPriceChart(a); drawVolChart(a); drawRsiChart(a); }
  updateTradeUI();
  updateNewsCoinBtn();
  updateZoomUI();
  if (news.byCoin) renderNews();
}

function renderLegend() {
  const keys = state.chartMode === 'candle'
    ? [['--good', 'Nến tăng'], ['--critical', 'Nến giảm'], ['--series-2', 'EMA 20'], ['--series-3', 'EMA 50']]
    : [['--series-1', 'Giá đóng nến'], ['--series-2', 'EMA 20'], ['--series-3', 'EMA 50']];
  $('priceLegend').innerHTML = keys
    .map(([v, label]) => `<span class="key"><span class="swatch" style="background:var(${v})"></span>${label}</span>`).join('');
}

function drawVolChart(a) {
  const canvas = $('volChart');
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!a.volumes) return;
  const [s, e] = zoomRange(a);
  const X = makeX(w, s, e);
  const maxV = Math.max(...a.volumes.slice(s, e + 1)) || 1;
  const bw = Math.max(1, ((w - PAD.l - PAD.r) / (e - s + 1)) * 0.7);
  const up = cssVar('--good'), down = cssVar('--critical');
  for (let i = s; i <= e; i++) {
    const rising = a.opens ? a.closes[i] >= a.opens[i] : (i > 0 ? a.closes[i] >= a.closes[i - 1] : true);
    ctx.fillStyle = rising ? up : down;
    ctx.globalAlpha = 0.75;
    const bh = Math.max(1, (a.volumes[i] / maxV) * (h - 6));
    ctx.fillRect(X(i) - bw / 2, h - 3 - bh, bw, bh);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = cssVar('--ink-muted');
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(fmtCompactUsd(maxV), w - PAD.r + 6, 10);
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

// Vùng nhìn zoom (chỉ số nến đầu/cuối) — dùng chung cho biểu đồ giá, khối lượng, RSI
const zoomer = { sym: null, n: 0, s: null, e: null };
const MIN_ZOOM_SPAN = 10;

function zoomRange(a) {
  const n = a.closes.length;
  if (zoomer.sym !== state.selected || zoomer.n !== n || zoomer.s == null) return [0, n - 1];
  const s = Math.max(0, Math.min(zoomer.s, n - 2));
  const e = Math.max(s + 1, Math.min(zoomer.e, n - 1));
  return [s, e];
}

function setZoom(a, s, e) {
  const n = a.closes.length;
  if (e - s >= n - 1) { zoomer.s = zoomer.e = null; }
  else {
    zoomer.sym = state.selected;
    zoomer.n = n;
    zoomer.s = Math.max(0, Math.round(s));
    zoomer.e = Math.min(n - 1, Math.round(e));
  }
  updateZoomUI();
  redrawCharts();
}

function resetZoom() {
  zoomer.s = zoomer.e = null;
  updateZoomUI();
  redrawCharts();
}

function updateZoomUI() {
  $('zoomReset').hidden = zoomer.s == null || zoomer.sym !== state.selected;
}

const makeX = (w, s, e) => (i) => PAD.l + ((i - s) / (e - s)) * (w - PAD.l - PAD.r);

function chartGeom(a, w, h, useHL = false) {
  const n = a.times.length;
  const [s, e] = zoomRange(a);
  const series = useHL && a.highs ? [a.highs, a.lows, a.ema20, a.ema50] : [a.closes, a.ema20, a.ema50];
  let min = Infinity, max = -Infinity;
  for (const arr of series) {
    for (let i = s; i <= e; i++) {
      const v = arr[i];
      if (v != null) { if (v < min) min = v; if (v > max) max = v; }
    }
  }
  const pad = (max - min) * 0.05 || max * 0.01;
  min -= pad; max += pad;
  const X = makeX(w, s, e);
  const Y = (v) => PAD.t + (1 - (v - min) / (max - min)) * (h - PAD.t - PAD.b);
  return { X, Y, min, max, n, s, e };
}

function drawLine(ctx, arr, X, Y, color, s = 0, e = arr.length - 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let started = false;
  for (let i = s; i <= e; i++) {
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
  const candleMode = state.chartMode === 'candle' && a.opens;
  const { X, Y, min, max, n, s, e } = chartGeom(a, w, h, candleMode);

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
  const longFrame = ['1d', '1w', '1M', '1y'].includes(a.klineIv);
  const fmtT = (ms) => {
    const d = new Date(ms);
    return longFrame
      ? d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: a.klineIv === '1d' ? undefined : '2-digit' })
      : d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };
  [s, Math.floor((s + e) / 2), e].forEach((i, k) => {
    ctx.textAlign = k === 0 ? 'left' : k === 2 ? 'right' : 'center';
    ctx.fillText(fmtT(a.times[i]), X(i), h - 6);
  });

  if (candleMode) {
    // Biểu đồ nến: xanh tăng / đỏ giảm, bấc = cao-thấp, thân = mở-đóng
    const bw = Math.max(1, ((w - PAD.l - PAD.r) / (e - s + 1)) * 0.7);
    const up = cssVar('--good'), down = cssVar('--critical');
    for (let i = s; i <= e; i++) {
      const o = a.opens[i], c = a.closes[i], hi = a.highs[i], lo = a.lows[i];
      if (![o, c, hi, lo].every(isFinite)) continue;
      const col = c >= o ? up : down;
      const x = X(i);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(hi)); ctx.lineTo(x, Y(lo)); ctx.stroke();
      ctx.fillStyle = col;
      const yTop = Y(Math.max(o, c));
      ctx.fillRect(x - bw / 2, yTop, bw, Math.max(1, Y(Math.min(o, c)) - yTop));
    }
    drawLine(ctx, a.ema50, X, Y, cssVar('--series-3'), s, e);
    drawLine(ctx, a.ema20, X, Y, cssVar('--series-2'), s, e);
  } else {
    drawLine(ctx, a.ema50, X, Y, cssVar('--series-3'), s, e);
    drawLine(ctx, a.ema20, X, Y, cssVar('--series-2'), s, e);
    drawLine(ctx, a.closes, X, Y, cssVar('--series-1'), s, e);
  }

  // crosshair
  if (hoverIdx != null && hoverIdx >= s && hoverIdx <= e) {
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
  const [s, e] = zoomRange(a);
  const X = makeX(w, s, e);
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
  drawLine(ctx, a.rsiArr, X, Y, cssVar('--series-1'), s, e);
}

function redrawCharts() {
  const a = state.selected && state.analysis.get(state.selected);
  if (a) { drawPriceChart(a); drawVolChart(a); drawRsiChart(a); }
  if (state.view === 'heat') drawHeatmap();
}

/* ==== Bản đồ nhiệt thị trường (treemap: diện tích = khối lượng, màu = %24h) ==== */

let heatCells = [];

function hexToRgb(hex) {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return { r: 128, g: 128, b: 128 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

// Chia đôi đệ quy theo trọng số — treemap gọn không cần thư viện
function layoutTreemap(items, x, y, w, h, out) {
  if (!items.length || w <= 0 || h <= 0) return;
  if (items.length === 1) { out.push({ t: items[0], x, y, w, h }); return; }
  const total = items.reduce((s, it) => s + it.weight, 0);
  let acc = 0, i = 0;
  while (i < items.length - 1 && acc + items[i].weight <= total / 2) { acc += items[i].weight; i++; }
  if (i === 0) { acc = items[0].weight; i = 1; }
  const frac = acc / total;
  const first = items.slice(0, i), rest = items.slice(i);
  if (w >= h) {
    layoutTreemap(first, x, y, w * frac, h, out);
    layoutTreemap(rest, x + w * frac, y, w * (1 - frac), h, out);
  } else {
    layoutTreemap(first, x, y, w, h * frac, out);
    layoutTreemap(rest, x, y + h * frac, w, h * (1 - frac), out);
  }
}

function drawHeatmap() {
  const canvas = $('heatCanvas');
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const list = visibleTickers().map(t => ({ ...t, weight: Math.max(t.quoteVolume, 1) }));
  heatCells = [];
  if (!list.length) {
    ctx.fillStyle = cssVar('--ink-muted');
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Không có coin nào khớp bộ lọc.', w / 2, h / 2);
    return;
  }
  layoutTreemap(list, 0, 0, w, h, heatCells);
  const up = hexToRgb(cssVar('--good'));
  const down = hexToRgb(cssVar('--critical'));
  const ink = cssVar('--ink-1');
  for (const c of heatCells) {
    const chg = c.t.changePct;
    const col = chg >= 0 ? up : down;
    const alpha = Math.min(1, 0.16 + (Math.min(Math.abs(chg), 10) / 10) * 0.7);
    ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${alpha})`;
    ctx.fillRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2); // chừa 2px khe giữa các ô
    if (c.w > 52 && c.h > 34) {
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.font = `600 ${Math.min(15, Math.max(10, c.w / 7))}px system-ui, sans-serif`;
      ctx.fillText(c.t.base, c.x + c.w / 2, c.y + c.h / 2 - 3);
      ctx.font = `${Math.min(12, Math.max(9, c.w / 9))}px system-ui, sans-serif`;
      ctx.fillText(fmtPct(chg), c.x + c.w / 2, c.y + c.h / 2 + 12);
    }
    if (state.selected === c.t.symbol) {
      ctx.strokeStyle = cssVar('--series-1');
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x + 2, c.y + 2, c.w - 4, c.h - 4);
    }
  }
}

function heatCellAt(e) {
  const rect = $('heatCanvas').getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  return heatCells.find(c => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
}

function updateView() {
  const heat = state.view === 'heat';
  $('tableScroll').hidden = heat;
  $('heatHolder').hidden = !heat;
  document.querySelector('.layout').classList.remove('collapsed');
  document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  if (heat) drawHeatmap();
}

/* ==== Zoom biểu đồ: lăn chuột / kéo / pinch / nháy đúp ==== */

function bindChartZoom() {
  const canvas = $('priceChart');
  const cur = () => state.selected && state.analysis.get(state.selected);

  // Lăn chuột: phóng to/thu nhỏ, neo tại vị trí con trỏ
  canvas.addEventListener('wheel', (ev) => {
    const a = cur();
    if (!a) return;
    ev.preventDefault();
    const n = a.closes.length;
    const [s, e] = zoomRange(a);
    const rect = canvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left - PAD.l) / (rect.width - PAD.l - PAD.r)));
    const span = e - s;
    const anchor = s + frac * span;
    const newSpan = Math.max(MIN_ZOOM_SPAN, Math.min(n - 1, Math.round(span * (ev.deltaY > 0 ? 1.25 : 0.8))));
    let ns = Math.round(anchor - frac * newSpan);
    ns = Math.max(0, Math.min(ns, n - 1 - newSpan));
    setZoom(a, ns, ns + newSpan);
  }, { passive: false });

  // Kéo để di chuyển (pan) + pinch 2 ngón để zoom
  const pts = new Map(); // pointerId -> clientX
  let panStart = null;   // {x, s, e}
  let pinchStart = null; // {dist, s, e, midFrac}

  canvas.addEventListener('pointerdown', (ev) => {
    const a = cur();
    if (!a) return;
    pts.set(ev.pointerId, ev.clientX);
    canvas.setPointerCapture(ev.pointerId);
    const [s, e] = zoomRange(a);
    if (pts.size === 1) {
      panStart = { x: ev.clientX, s, e };
      pinchStart = null;
    } else if (pts.size === 2) {
      const [x1, x2] = [...pts.values()];
      const rect = canvas.getBoundingClientRect();
      pinchStart = {
        dist: Math.max(10, Math.abs(x1 - x2)),
        s, e,
        midFrac: Math.max(0, Math.min(1, ((x1 + x2) / 2 - rect.left - PAD.l) / (rect.width - PAD.l - PAD.r))),
      };
      panStart = null;
    }
  });

  canvas.addEventListener('pointermove', (ev) => {
    const a = cur();
    if (!a || !pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, ev.clientX);
    const n = a.closes.length;
    const rect = canvas.getBoundingClientRect();
    const plotW = rect.width - PAD.l - PAD.r;
    if (pinchStart && pts.size === 2) {
      const [x1, x2] = [...pts.values()];
      const scale = Math.max(10, Math.abs(x1 - x2)) / pinchStart.dist;
      const span0 = pinchStart.e - pinchStart.s;
      const newSpan = Math.max(MIN_ZOOM_SPAN, Math.min(n - 1, Math.round(span0 / scale)));
      const anchor = pinchStart.s + pinchStart.midFrac * span0;
      let ns = Math.round(anchor - pinchStart.midFrac * newSpan);
      ns = Math.max(0, Math.min(ns, n - 1 - newSpan));
      setZoom(a, ns, ns + newSpan);
    } else if (panStart && pts.size === 1) {
      const span = panStart.e - panStart.s;
      if (span >= n - 1) return; // chưa zoom thì không cần pan
      const di = Math.round(((panStart.x - ev.clientX) / plotW) * span);
      let ns = Math.max(0, Math.min(panStart.s + di, n - 1 - span));
      setZoom(a, ns, ns + span);
    }
  });

  const endPointer = (ev) => {
    pts.delete(ev.pointerId);
    if (pts.size < 2) pinchStart = null;
    if (pts.size === 0) panStart = null;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // Nháy đúp hoặc nút ⟲: về toàn cảnh
  canvas.addEventListener('dblclick', resetZoom);
  $('zoomReset').addEventListener('click', resetZoom);
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
    const [zs, ze] = zoomRange(a);
    const frac = (x - PAD.l) / (rect.width - PAD.l - PAD.r);
    const idx = Math.max(zs, Math.min(ze, zs + Math.round(frac * (ze - zs))));
    if (idx !== hoverIdx) {
      hoverIdx = idx;
      drawPriceChart(a);
    }
    const d = new Date(a.times[idx]);
    const timeStr = ['1d', '1w', '1M', '1y'].includes(a.klineIv)
      ? d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const row = (color, label, val) =>
      `<div class="tt-row"><span class="k"><span class="swatch" style="display:inline-block;width:10px;height:2px;background:${cssVar(color)}"></span>${label}</span><span>${val}</span></div>`;
    const candleRows = state.chartMode === 'candle' && a.opens
      ? `<div class="tt-row"><span class="k">Mở / Đóng</span><span>${fmtUsd(a.opens[idx])} / ${fmtUsd(a.closes[idx])}</span></div>` +
        `<div class="tt-row"><span class="k">Cao / Thấp</span><span>${fmtUsd(a.highs[idx])} / ${fmtUsd(a.lows[idx])}</span></div>` +
        (a.volumes ? `<div class="tt-row"><span class="k">KL</span><span>${fmtCompactUsd(a.volumes[idx])}</span></div>` : '')
      : row('--series-1', 'Giá', fmtUsd(a.closes[idx]));
    tip.innerHTML =
      `<div class="tt-time">${timeStr}</div>` +
      candleRows +
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

/* ================= Cảnh báo tín hiệu MUA MẠNH / BÁN MẠNH ================= */

const alerts = {
  enabled: JSON.parse(localStorage.getItem('alertsOn') || 'true'),
  prev: new Map(),      // symbol -> cls của lần quét trước
  lastSent: new Map(),  // "symbol|cls" -> timestamp (chống spam)
  firstScan: true,
};
const ALERT_COOLDOWN_MS = 60 * 60_000; // không lặp lại cùng tín hiệu trong 60 phút

function showToast(title, body, kind, sym) {
  const box = $('toasts');
  if (!document.createElement || !box.appendChild) return; // môi trường test không có DOM thật
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = `<div><div class="t-title">${esc(title)}</div><div class="t-body">${esc(body)}</div></div>` +
    `<button class="t-close" title="Đóng">✕</button>`;
  el.addEventListener('click', (e) => {
    if (e.target.closest('.t-close')) { el.remove(); return; }
    if (sym) {
      state.selected = sym;
      renderTable();
      renderDetail(sym);
    }
    el.remove();
  });
  box.appendChild(el);
  setTimeout(() => el.remove(), 10_000);
}

function notifySignal(sym, a) {
  const isBuy = a.cls.startsWith('buy');
  const t = state.tickers.find(x => x.symbol === sym);
  const title = (isBuy ? '🟢 MUA MẠNH: ' : '🔴 BÁN MẠNH: ') + sym.slice(0, -4);
  const body = `Điểm ${a.score > 0 ? '+' : ''}${a.score} · ${t ? fmtUsd(t.price) + ' USDT' : ''} · khung ${IV_LABEL[a.klineIv || state.interval] || a.klineIv}`;
  showToast(title, body, isBuy ? 'buy' : 'sell', sym);
  if (alerts.enabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, { body, icon: 'icons/icon-192.png', tag: 'coins-' + sym });
      n.onclick = () => {
        window.focus();
        state.selected = sym;
        renderTable();
        renderDetail(sym);
        n.close();
      };
    } catch { /* một số trình duyệt chặn Notification ngoài SW */ }
  }
}

function checkSignalAlerts() {
  const events = [];
  let strongBuy = 0, strongSell = 0;
  for (const [sym, a] of state.analysis) {
    const prevCls = alerts.prev.get(sym);
    alerts.prev.set(sym, a.cls);
    if (!a.cls.includes('strong')) continue;
    if (a.cls.startsWith('buy')) strongBuy++; else strongSell++;
    if (prevCls === a.cls) continue; // vẫn như lần quét trước — không báo lại
    const key = sym + '|' + a.cls;
    if (Date.now() - (alerts.lastSent.get(key) || 0) < ALERT_COOLDOWN_MS) continue;
    alerts.lastSent.set(key, Date.now());
    events.push({ sym, a });
  }
  if (alerts.firstScan) {
    // Lần quét đầu sau khi mở app: chỉ tóm tắt, tránh dội một loạt thông báo
    alerts.firstScan = false;
    if (strongBuy + strongSell > 0) {
      showToast('Quét xong', `Hiện có ${strongBuy} tín hiệu MUA MẠNH, ${strongSell} BÁN MẠNH — lọc theo "Đề xuất" để xem.`, '', null);
    }
    return;
  }
  events.slice(0, 5).forEach(ev => notifySignal(ev.sym, ev.a));
  if (events.length > 5) showToast('Tín hiệu mạnh', `…và ${events.length - 5} coin khác vừa có tín hiệu mạnh`, '', null);
}

function updateAlertBtn() {
  const btn = $('alertBtn');
  const sysOn = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  btn.textContent = alerts.enabled ? '🔔' : '🔕';
  btn.className = 'btn' + (alerts.enabled ? '' : ' off');
  btn.title = alerts.enabled
    ? `Thông báo tín hiệu mạnh: BẬT${sysOn ? ' (kèm thông báo hệ thống)' : ' (chỉ trong app — bấm để xin quyền thông báo hệ thống)'}`
    : 'Thông báo tín hiệu mạnh: TẮT — bấm để bật';
}

/* ==== Web Push: nhận cảnh báo từ server kể cả khi đóng trình duyệt ==== */

function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function setupPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return 'no-permission';
  const keyRes = await fetch('push/key').catch(() => null);
  if (!keyRes || !keyRes.ok) return 'no-server';
  const { key } = await keyRes.json();
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key) });
  const r = await fetch('push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub }),
  });
  return r.ok ? 'ok' : 'no-server';
}

async function teardownPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch('push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* không sao */ }
}

async function tryEnablePush() {
  const r = await setupPush().catch(() => 'error');
  if (r === 'ok') showToast('🔔 Web Push đã bật', 'Bạn sẽ nhận cảnh báo tín hiệu mạnh (khung 1h) kể cả khi đóng trình duyệt.', 'buy', null);
  else if (r === 'no-server') showToast('Web Push chưa khả dụng', 'Server hiện tại không có dịch vụ push — cần bản deploy Docker/Coolify mới nhất.', '', null);
  return r;
}

async function hasPushSub() {
  try {
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch { return false; }
}

// Xin quyền thông báo với phản hồi rõ ràng ở mọi tình huống
async function requestPermissionFlow() {
  showToast('Đang xin quyền thông báo…',
    'Nếu không thấy hộp thoại hiện ra, hãy bấm biểu tượng 🔔/🔒 nhỏ CẠNH THANH ĐỊA CHỈ của trình duyệt rồi chọn "Cho phép".', '', null);
  let p = 'timeout';
  try {
    p = await Promise.race([
      Notification.requestPermission(),
      new Promise(r => setTimeout(() => r('timeout'), 12_000)),
    ]);
  } catch { p = 'error'; }
  if (p === 'granted') {
    showToast('✅ Đã cấp quyền thông báo', 'Đang đăng ký Web Push với server…', 'buy', null);
    tryEnablePush();
  } else if (p === 'denied') {
    showToast('❌ Quyền thông báo bị CHẶN', 'Bấm biểu tượng 🔒 cạnh thanh địa chỉ → Thông báo (Notifications) → Cho phép (Allow), rồi bấm 🔔 lại.', 'sell', null);
  } else if (p === 'timeout') {
    showToast('Trình duyệt đang ẩn hộp xin quyền', 'Tìm biểu tượng chuông nhỏ 🔔 trong thanh địa chỉ (bên phải) và bấm vào đó để cho phép — Chrome hay ẩn hộp thoại kiểu này.', '', null);
  }
  updateAlertBtn();
}

function bindAlertBtn() {
  $('alertBtn').addEventListener('click', async () => {
    const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
    if (!alerts.enabled) {
      alerts.enabled = true;
      localStorage.setItem('alertsOn', 'true');
      showToast('🔔 Cảnh báo trong app: BẬT', 'Toast sẽ hiện khi có coin chuyển sang MUA MẠNH / BÁN MẠNH.', '', null);
      if (perm === 'granted') tryEnablePush();
      else if (perm === 'default') await requestPermissionFlow();
    } else if (perm === 'default') {
      await requestPermissionFlow();
    } else if (perm === 'granted' && !(await hasPushSub())) {
      showToast('Đang đăng ký Web Push…', 'Quyền đã có, đang kết nối với server push.', '', null);
      tryEnablePush();
    } else {
      alerts.enabled = false;
      localStorage.setItem('alertsOn', 'false');
      teardownPush();
      showToast('🔕 Đã tắt cảnh báo', perm === 'denied'
        ? 'Lưu ý: quyền thông báo hệ thống đang bị CHẶN cho trang này — bấm 🔒 cạnh thanh địa chỉ nếu muốn mở lại.'
        : 'Bấm 🔔 để bật lại.', '', null);
    }
    updateAlertBtn();
  });
  updateAlertBtn();

  // Nhận thông điệp từ service worker khi người dùng bấm vào thông báo push
  if ('serviceWorker' in navigator && navigator.serviceWorker.addEventListener) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.coin) lookupCoin(e.data.coin);
    });
  }

  // Mở app từ thông báo push khi chưa có cửa sổ nào (?coin=SYMBOL)
  try {
    const p = new URLSearchParams(location.search).get('coin');
    if (p) setTimeout(() => lookupCoin(p), 1500);
  } catch { /* môi trường không có location */ }

  // Tự làm mới đăng ký push nếu đã bật từ trước
  if (alerts.enabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    setupPush().catch(() => {});
  }
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
  // Binance chặn CORS trên endpoint có ký (không cho header X-MBX-APIKEY, không cho POST)
  // nên trình duyệt không gọi thẳng được — lệnh đi qua proxy cùng origin của app
  // (nginx.conf chuyển tiếp /xapi → api.binance.com, /xapi-testnet → testnet.binance.vision).
  return cfg && cfg.testnet ? '/xapi-testnet' : '/xapi';
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
  if (!res.ok) {
    if (res.status === 404 || res.status === 405) {
      throw new Error('Server đang chạy không có proxy Binance (/xapi). Tính năng giao dịch cần chạy app qua Docker/Coolify (nginx kèm sẵn proxy) — xem README.');
    }
    throw new Error(data.msg || `Lỗi HTTP ${res.status}`);
  }
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

/* ==== Tài sản đang có (lọc danh mục từ tài khoản Binance) ==== */

const holdings = { set: null, amt: new Map(), at: 0 };

async function loadHoldings(force = false) {
  if (!getTradeCfg()) throw new Error('no-api');
  if (!force && holdings.set && Date.now() - holdings.at < 60_000) return;
  const acc = await signedFetch('/api/v3/account', { omitZeroBalances: 'true' });
  holdings.amt.clear();
  for (const b of acc.balances || []) {
    let asset = b.asset;
    // Số dư Binance Earn hiển thị với tiền tố LD (LDBTC…) — gộp về coin gốc
    if (/^LD[A-Z0-9]{2,}$/.test(asset)) asset = asset.slice(2);
    const q = parseFloat(b.free) + parseFloat(b.locked);
    if (q > 0) holdings.amt.set(asset, (holdings.amt.get(asset) || 0) + q);
  }
  holdings.set = new Set(holdings.amt.keys());
  holdings.at = Date.now();
}

async function applyHoldingFilter() {
  try {
    await loadHoldings();
  } catch {
    state.filter = 'all';
    $('filterSel').value = 'all';
    showToast('Cần kết nối API Binance', 'Bấm ⚙️ API ở góc trên để kết nối trước khi lọc theo tài sản đang có.', 'sell', null);
    renderTable();
    return;
  }
  // Coin đang giữ nhưng ngoài top khối lượng → thêm vào danh sách theo dõi
  let added = false;
  for (const base of holdings.set) {
    const sym = base + 'USDT';
    if (!state.extras.has(sym) && !state.tickers.some(t => t.symbol === sym)) {
      state.extras.add(sym);
      added = true;
    }
  }
  if (added) {
    try { await loadTickers(); } catch { /* giữ dữ liệu cũ */ }
  }
  renderTable();
  runAnalysis();

  let totalUsd = 0, nCoin = 0;
  for (const t of state.tickers) {
    if (holdings.amt.has(t.base)) { totalUsd += holdings.amt.get(t.base) * t.price; nCoin++; }
  }
  const usdt = holdings.amt.get('USDT') || 0;
  totalUsd += usdt;
  showToast('💼 Tài sản đang có',
    `${nCoin} coin + ${usdt.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT · tổng ≈ ${fmtCompactUsd(totalUsd)} USDT (${fmtVnd(totalUsd)})`, '', null);
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

/* ==== Tin tức thị trường (server thu thập RSS, client tìm/lọc) ==== */

const news = {
  items: [], updatedAt: 0, available: false, q: '', lang: '', byCoin: false,
  translate: localStorage.getItem('newsTrans') === 'true',
  viMap: new Map(),    // link -> tiêu đề đã dịch
  failed: new Set(),   // link dịch lỗi — không thử lại liên tục
  translating: false,
};

// Tên đầy đủ của các coin lớn để lọc tin chính xác hơn
const COIN_NAMES = {
  BTC: ['bitcoin'], ETH: ['ethereum'], BNB: ['bnb', 'binance coin'], SOL: ['solana'],
  XRP: ['xrp', 'ripple'], DOGE: ['dogecoin'], ADA: ['cardano'], TRX: ['tron'],
  LINK: ['chainlink'], DOT: ['polkadot'], AVAX: ['avalanche'], LTC: ['litecoin'],
  SHIB: ['shiba inu'], PEPE: ['pepe'], NEAR: ['near protocol'], ICP: ['internet computer'],
  ZEC: ['zcash'], SUI: ['sui'], UNI: ['uniswap'], ATOM: ['cosmos'], FIL: ['filecoin'],
  APT: ['aptos'], ARB: ['arbitrum'], OP: ['optimism'], TON: ['toncoin'],
};

function newsTimeAgo(t) {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + ' phút trước';
  if (s < 86400) return Math.floor(s / 3600) + ' giờ trước';
  if (s < 172800) return 'hôm qua';
  return new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

async function loadNews() {
  try {
    const res = await fetch('news?limit=150');
    if (!res.ok) throw new Error('no news endpoint');
    const d = await res.json();
    news.items = d.items || [];
    news.updatedAt = d.updatedAt || 0;
    news.available = true;
    $('newsBox').hidden = false;
    renderNews();
  } catch {
    // Hosting tĩnh / bản cũ không có server tin tức — ẩn khu tin
    news.available = false;
    $('newsBox').hidden = true;
  }
}

function coinNewsTerms() {
  if (!state.selected) return [];
  const base = state.selected.slice(0, -4);
  return [base.toLowerCase(), ...(COIN_NAMES[base] || [])];
}

function renderNews() {
  if (!news.available) return;
  let list = news.items;
  if (news.lang) list = list.filter(n => n.lang === news.lang);
  if (news.byCoin) {
    const terms = coinNewsTerms();
    if (terms.length) list = list.filter(n => {
      const hay = (n.title + ' ' + n.desc).toLowerCase();
      return terms.some(t => hay.includes(t));
    });
  }
  if (news.q) {
    const q = news.q.toLowerCase();
    list = list.filter(n => (n.title + ' ' + n.desc).toLowerCase().includes(q));
  }
  $('newsUpd').textContent = news.updatedAt ? 'cập nhật ' + newsTimeAgo(news.updatedAt) : '';
  const shown = list.slice(0, 40);
  $('newsList').innerHTML = shown.map(n => {
    // Phòng thủ hai lớp: server đã lọc, client vẫn chỉ render link http/https
    const safeLink = /^https?:\/\//i.test(n.link) ? n.link : null;
    const vi = news.translate && n.lang === 'en' ? news.viMap.get(n.link) : null;
    const shownTitle = vi || n.title;
    const transNote = vi ? ' <span class="news-trans-note">· đã dịch</span>' : '';
    const titleHtml = safeLink
      ? `<a href="${esc(safeLink)}" target="_blank" rel="noopener noreferrer" title="${esc(vi ? n.title + '\n---\n' + n.desc : n.desc)}">${esc(shownTitle)}</a>`
      : `<span title="${esc(n.desc)}">${esc(shownTitle)}</span>`;
    return `<li>${titleHtml}<div class="news-meta">${esc(n.source)} · ${newsTimeAgo(n.time)}${transNote}</div></li>`;
  }).join('') || '<li class="news-empty">Không có tin nào khớp bộ lọc.</li>';
  if (news.translate) ensureTranslations(shown);
}

// Dịch dần các tin tiếng Anh đang hiển thị (qua proxy /translate của server, có cache)
async function ensureTranslations(shown) {
  if (news.translating) return;
  const pending = shown.filter(n =>
    n.lang === 'en' && !news.viMap.has(n.link) && !news.failed.has(n.link));
  if (!pending.length) return;
  news.translating = true;
  try {
    const res = await fetch('translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: pending.map(n => n.title) }),
    });
    if (!res.ok) throw new Error('no-endpoint');
    const d = await res.json();
    let got = 0;
    pending.forEach((n, i) => {
      const vi = d.items && d.items[i];
      if (vi) { news.viMap.set(n.link, vi); got++; }
      else news.failed.add(n.link);
    });
    news.translating = false;
    if (got) renderNews();
  } catch {
    news.translating = false;
    news.translate = false;
    localStorage.setItem('newsTrans', 'false');
    updateNewsTransBtn();
    showToast('Không dịch được tin', 'Server hiện tại chưa có dịch vụ dịch — cần bản deploy mới nhất.', 'sell', null);
  }
}

function updateNewsTransBtn() {
  const btn = $('newsTransBtn');
  btn.className = 'btn btn-sm' + (news.translate ? ' on' : '');
  btn.textContent = news.translate ? '✓ 🌐 Dịch' : '🌐 Dịch';
}

function updateNewsCoinBtn() {
  const btn = $('newsCoinBtn');
  if (!news.available || !state.selected) {
    btn.hidden = true;
    if (news.byCoin) { news.byCoin = false; renderNews(); }
    return;
  }
  const base = state.selected.slice(0, -4);
  btn.hidden = false;
  btn.textContent = (news.byCoin ? '✓ ' : '') + 'Tin về ' + base;
  btn.className = 'btn btn-sm' + (news.byCoin ? ' on' : '');
}

function bindNews() {
  $('newsSearch').addEventListener('input', (e) => {
    news.q = e.target.value.trim();
    renderNews();
  });
  $('newsLang').addEventListener('change', (e) => {
    news.lang = e.target.value;
    renderNews();
  });
  $('newsCoinBtn').addEventListener('click', () => {
    news.byCoin = !news.byCoin;
    updateNewsCoinBtn();
    renderNews();
  });

  $('newsTransBtn').addEventListener('click', () => {
    news.translate = !news.translate;
    localStorage.setItem('newsTrans', String(news.translate));
    news.failed.clear();
    updateNewsTransBtn();
    renderNews();
  });
  updateNewsTransBtn();
}

/* ==== Chuyển theme sáng / tối / tự động ==== */

function applyTheme(mode) {
  const root = document.documentElement;
  if (root && root.dataset) {
    if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
    else delete root.dataset.theme;
  }
  if (mode === 'light' || mode === 'dark') localStorage.setItem('theme', mode);
  else localStorage.removeItem('theme');
  const btn = $('themeBtn');
  btn.textContent = mode === 'light' ? '☀️' : mode === 'dark' ? '🌙' : '🌗';
  btn.title = mode === 'light' ? 'Giao diện: SÁNG — bấm để chuyển sang tối'
    : mode === 'dark' ? 'Giao diện: TỐI — bấm để theo hệ điều hành'
    : 'Giao diện: theo hệ điều hành — bấm để chuyển sang sáng';
  redrawCharts(); // canvas đọc màu từ CSS variables nên phải vẽ lại
}

function bindThemeBtn() {
  let mode = 'auto';
  try { mode = localStorage.getItem('theme') || 'auto'; } catch {}
  applyTheme(mode);
  $('themeBtn').addEventListener('click', () => {
    mode = mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto';
    applyTheme(mode);
  });
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
    if (state.filter === 'holding') applyHoldingFilter();
  });

  $('assetSel').addEventListener('change', (e) => {
    state.assetType = e.target.value;
    renderTable();
  });

  // Chuyển bảng ↔ bản đồ nhiệt
  $('viewSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn || btn.dataset.view === state.view) return;
    state.view = btn.dataset.view;
    localStorage.setItem('view', state.view);
    updateView();
  });

  $('collapseBtn').addEventListener('click', () => {
    document.querySelector('.layout').classList.toggle('collapsed');
  });

  // Bấm vào ô trên bản đồ nhiệt → chọn coin
  $('heatCanvas').addEventListener('click', (e) => {
    const cell = heatCellAt(e);
    if (!cell) return;
    state.selected = cell.t.symbol;
    renderTable();
    renderDetail(cell.t.symbol);
  });
  $('heatCanvas').addEventListener('mousemove', (e) => {
    const cell = heatCellAt(e);
    $('heatCanvas').title = cell
      ? `${cell.t.base} · ${fmtUsd(cell.t.price)} USDT · ${fmtPct(cell.t.changePct)} (24h) · KL ${fmtCompactUsd(cell.t.quoteVolume)}`
      : '';
  });

  // Chuyển kiểu biểu đồ giá: nến ↔ đường
  $('chartModeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn || btn.dataset.mode === state.chartMode) return;
    state.chartMode = btn.dataset.mode;
    localStorage.setItem('chartMode', state.chartMode);
    document.querySelectorAll('#chartModeSeg button').forEach(b => b.classList.toggle('active', b.dataset.mode === state.chartMode));
    renderLegend();
    redrawCharts();
  });
  document.querySelectorAll('#chartModeSeg button').forEach(b => b.classList.toggle('active', b.dataset.mode === state.chartMode));
  updateView();

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
    alerts.prev.clear();
    alerts.firstScan = true; // đổi khung: chỉ tóm tắt thay vì dội thông báo
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
  bindChartZoom();
  initSplitter();
  bindApiDialog();
  bindTradeEvents();
  bindAlertBtn();
  bindThemeBtn();
  bindNews();
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
  updateBreadth();
  loadMarketInfo();
  loadNews();
  runAnalysis();

  setInterval(async () => {
    try {
      await loadTickers();
      renderTable();
      updateBreadth();
      if (state.selected) renderDetail(state.selected);
    } catch { /* giữ dữ liệu cũ */ }
  }, TICKER_REFRESH_MS);

  setInterval(() => runAnalysis(), ANALYSIS_REFRESH_MS);
  setInterval(() => loadMarketInfo(), 5 * 60_000);
  setInterval(() => loadNews(), 10 * 60_000);
  setInterval(() => loadRate(), 60 * 60_000);
}

init();
