/* Server của Coins: file tĩnh + proxy Binance (/xapi) + Web Push.
 * Vòng quét chạy cùng engine chỉ báo với trình duyệt (js/engine.js) nên
 * tín hiệu push khớp 100% với tín hiệu hiển thị trong app. */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const engine = require('../js/engine.js');

const PORT = process.env.PORT || 80;
const BOOT_VERSION = Date.now(); // gắn vào URL js/css để phá mọi tầng cache (CDN/trình duyệt) sau mỗi deploy
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

/* ==== VAPID (tự sinh lần đầu, lưu vào volume data) ==== */
const vapidFile = path.join(DATA_DIR, 'vapid.json');
let vapid;
if (fs.existsSync(vapidFile)) {
  vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8'));
} else {
  vapid = webpush.generateVAPIDKeys();
  fs.writeFileSync(vapidFile, JSON.stringify(vapid));
  console.log('Đã sinh cặp khóa VAPID mới');
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:coins@localhost.local', vapid.publicKey, vapid.privateKey);

/* ==== Danh sách đăng ký push ==== */
const subsFile = path.join(DATA_DIR, 'subs.json');
let subs = [];
try { subs = JSON.parse(fs.readFileSync(subsFile, 'utf8')); } catch { subs = []; }
const saveSubs = () => fs.writeFileSync(subsFile, JSON.stringify(subs));

// Gửi payload tới các thiết bị; payloadFor(sub) trả về payload theo từng thiết bị
// hoặc null để bỏ qua thiết bị đó. Trả về số thiết bị đã gửi.
async function broadcast(payloadOrFn) {
  const dead = [];
  let sent = 0;
  await Promise.all(subs.map(async (sub) => {
    const payload = typeof payloadOrFn === 'function' ? payloadOrFn(sub) : payloadOrFn;
    if (!payload) return;
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) dead.push(sub.endpoint);
      else console.error('push lỗi:', e.statusCode || e.message);
    }
  }));
  if (dead.length) {
    subs = subs.filter(s => !dead.includes(s.endpoint));
    saveSubs();
    console.log(`Dọn ${dead.length} đăng ký hết hạn, còn ${subs.length}`);
  }
  return sent;
}

/* ==== Vòng quét tín hiệu (khung 1 ngày, hợp lưu 1 tuần — như mặc định của app) ==== */

const TOP_N = 30;
const SCAN_MS = parseInt(process.env.SCAN_MS || '', 10) || 5 * 60_000;
const COOLDOWN_MS = 60 * 60_000;
const EXCLUDE_BASE = /^(FDUSD|TUSD|BUSD|DAI|EUR|GBP|AEUR|EURI|PAXG|XAUT|WBTC)$|^USD|USD$/;
const EXCLUDE_SUFFIX = /(UP|DOWN|BULL|BEAR)$/;
const prev = new Map();
const lastSent = new Map();
let firstScan = true;
let lastTestAt = 0;

const fmtUsd = (p) => p >= 1 ? p.toLocaleString('en-US', { maximumFractionDigits: p >= 100 ? 2 : 4 }) : p.toPrecision(4);

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function scan() {
  try {
    const data = await getJson('https://api.binance.com/api/v3/ticker/24hr');
    const tickers = data
      .filter(t => t.symbol.endsWith('USDT'))
      .map(t => ({ symbol: t.symbol, base: t.symbol.slice(0, -4), price: parseFloat(t.lastPrice), changePct: parseFloat(t.priceChangePercent), quoteVolume: parseFloat(t.quoteVolume) }))
      .filter(t => t.price > 0 && !EXCLUDE_BASE.test(t.base) && !EXCLUDE_SUFFIX.test(t.base))
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, TOP_N);

    const events = [];
    for (const t of tickers) {
      try {
        const [raw, rawH] = await Promise.all([
          getJson(`https://api.binance.com/api/v3/klines?symbol=${t.symbol}&interval=1d&limit=200`),
          getJson(`https://api.binance.com/api/v3/klines?symbol=${t.symbol}&interval=1w&limit=120`).catch(() => null),
        ]);
        const sig = engine.buildSignal(engine.parseKlines(raw), rawH ? engine.parseKlines(rawH) : null, t);
        const prevCls = prev.get(t.symbol);
        prev.set(t.symbol, sig.cls);
        // Tín hiệu đáng chú ý: MẠNH (cả hai chiều) hoặc BÁN thường — BÁN thường chỉ gửi
        // cho thiết bị đang giữ coin đó (bảo vệ vốn cần báo sớm, không đợi BÁN MẠNH)
        const interesting = sig.cls.includes('strong') || sig.cls.startsWith('sell');
        if (!interesting || prevCls === sig.cls) continue;
        const key = t.symbol + '|' + sig.cls;
        if (Date.now() - (lastSent.get(key) || 0) < COOLDOWN_MS) continue;
        lastSent.set(key, Date.now());
        events.push({ t, sig });
      } catch { /* bỏ qua coin lỗi */ }
    }

    if (firstScan) {
      firstScan = false;
      console.log(`Quét đầu: ${tickers.length} coin, ${events.length} tín hiệu đáng chú ý (không push để tránh dội sau khi khởi động)`);
      return;
    }
    for (const { t, sig } of events) {
      const isBuy = sig.cls.startsWith('buy');
      // Quy tắc danh mục theo từng thiết bị (client đồng bộ qua /push/prefs), dùng chung
      // engine.alertPriority với app web: đang giữ → nhận BÁN mọi mức + MUA MẠNH (nhãn 💼);
      // chưa giữ → chỉ MUA MẠNH; chưa khai báo danh mục → hành vi cũ (mọi tín hiệu MẠNH)
      const sent = await broadcast((sub) => {
        const info = Array.isArray(sub.holdings);
        const held = info && sub.holdings.includes(t.base);
        if (!engine.alertPriority(sig.cls, info ? held : null, false)) return null;
        return {
          title: (isBuy ? '🟢 ' : '🔴 ') + sig.verdict + ': ' + t.base + (held ? ' 💼' : ''),
          body: (held ? `Coin đang có trong ví — ${isBuy ? 'cân nhắc kỹ nếu mua thêm' : 'ưu tiên xem xét chốt lời/cắt lỗ'} · ` : '') +
            `Điểm ${sig.score > 0 ? '+' : ''}${sig.score} · ${fmtUsd(t.price)} USDT · khung 1 ngày`,
          tag: 'coins-' + t.symbol,
          sym: t.symbol,
        };
      });
      console.log(`PUSH: ${sig.verdict} ${t.base} (điểm ${sig.score}) → ${sent}/${subs.length} thiết bị`);
    }
  } catch (e) {
    console.error('scan lỗi:', e.message);
  }
}

/* ==== Thu thập tin tức (RSS) ==== */

const NEWS_FEEDS = [
  { source: 'CoinDesk', lang: 'en', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { source: 'Cointelegraph', lang: 'en', url: 'https://cointelegraph.com/rss' },
  { source: 'Bitcoin Magazine', lang: 'en', url: 'https://bitcoinmagazine.com/feed' },
  { source: 'Coin68', lang: 'vi', url: 'https://coin68.com/rss/tin-moi-nhat.rss' },
];
const NEWS_REFRESH_MS = 10 * 60_000;
const NEWS_MAX_PER_FEED = 40;
let newsCache = [];        // [{title, link, source, lang, time, desc}]
let newsUpdatedAt = 0;

function stripTags(s) {
  return s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c))
    .replace(/\s+/g, ' ').trim();
}

function pickTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

// Parser RSS 2.0 / Atom tối giản, không cần thư viện ngoài
function parseFeed(xml, meta) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks.slice(0, NEWS_MAX_PER_FEED)) {
    const title = stripTags(pickTag(b, 'title'));
    let link = stripTags(pickTag(b, 'link'));
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : ''; }
    const dateStr = pickTag(b, 'pubDate') || pickTag(b, 'published') || pickTag(b, 'updated') || pickTag(b, 'dc:date');
    const time = Date.parse(stripTags(dateStr)) || 0;
    const desc = stripTags(pickTag(b, 'description') || pickTag(b, 'summary')).slice(0, 260);
    // Chỉ nhận link http/https — chặn javascript:/data: từ feed bị chiếm quyền
    if (title && /^https?:\/\//i.test(link)) items.push({ title, link, source: meta.source, lang: meta.lang, time, desc });
  }
  return items;
}

async function refreshNews() {
  const all = [];
  await Promise.all(NEWS_FEEDS.map(async (f) => {
    try {
      const res = await fetch(f.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CoinsApp/1.0)', 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      all.push(...parseFeed(await res.text(), f));
    } catch (e) {
      console.error(`RSS ${f.source} lỗi:`, e.message);
    }
  }));
  if (all.length) {
    // khử trùng lặp theo link, mới nhất trước
    const seen = new Set();
    newsCache = all
      .sort((a, b) => b.time - a.time)
      .filter(n => !seen.has(n.link) && seen.add(n.link));
    newsUpdatedAt = Date.now();
    console.log(`Tin tức: ${newsCache.length} bài từ ${NEWS_FEEDS.length} nguồn`);
  }
}

/* ==== Dịch tin tức (proxy Google Translate miễn phí + cache) ==== */

const transCache = new Map();
const TRANS_CACHE_MAX = 3000;

async function translateOne(text) {
  if (transCache.has(text)) return transCache.get(text);
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=' + encodeURIComponent(text);
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CoinsApp/1.0)' },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const d = await res.json();
  const out = (d[0] || []).map(seg => seg && seg[0] ? seg[0] : '').join('').trim();
  if (!out) throw new Error('empty');
  if (transCache.size >= TRANS_CACHE_MAX) transCache.delete(transCache.keys().next().value);
  transCache.set(text, out);
  return out;
}

async function translateBatch(texts) {
  const out = new Array(texts.length).fill(null);
  let i = 0;
  const workers = Array.from({ length: 8 }, async () => {
    while (i < texts.length) {
      const idx = i++;
      try { out[idx] = await translateOne(texts[idx]); } catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

/* ==== HTTP server ==== */

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 100_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
  });
}

const server = http.createServer(async (req, res) => {
  const [p, qs] = req.url.split('?');

  // --- Proxy Binance (endpoint có ký bị chặn CORS khi gọi thẳng từ trình duyệt) ---
  if (p.startsWith('/xapi')) {
    const host = p.startsWith('/xapi-testnet') ? 'testnet.binance.vision' : 'api.binance.com';
    const targetPath = p.replace(/^\/xapi(-testnet)?/, '') + (qs ? '?' + qs : '');
    const headers = {};
    if (req.headers['x-mbx-apikey']) headers['X-MBX-APIKEY'] = req.headers['x-mbx-apikey'];
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    const preq = https.request({ host, path: targetPath, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode, { 'Content-Type': r.headers['content-type'] || 'application/json' });
      r.pipe(res);
    });
    preq.on('error', (e) => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ msg: 'Proxy lỗi: ' + e.message })); });
    req.pipe(preq);
    return;
  }

  // --- Web Push ---
  if (p === '/push/key') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key: vapid.publicKey }));
    return;
  }
  if (p === '/push/subscribe' && req.method === 'POST') {
    const body = await readBody(req);
    const sub = body && body.subscription;
    if (sub && sub.endpoint) {
      if (!subs.some(s => s.endpoint === sub.endpoint)) {
        subs.push(sub);
        saveSubs();
        console.log(`Đăng ký push mới (tổng ${subs.length})`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: subs.length }));
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
    }
    return;
  }
  if (p === '/push/prefs' && req.method === 'POST') {
    // Client đồng bộ danh sách coin đang giữ để server lọc thông báo theo danh mục:
    // đang giữ → ưu tiên cảnh báo BÁN, chưa giữ → chỉ cảnh báo MUA MẠNH
    const body = await readBody(req);
    const sub = body && body.endpoint ? subs.find(s => s.endpoint === body.endpoint) : null;
    if (sub) {
      sub.holdings = Array.isArray(body.holdings)
        ? [...new Set(body.holdings.slice(0, 300).map(x => String(x).toUpperCase().slice(0, 20)))]
        : [];
      sub.holdingsAt = Date.now();
      saveSubs();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, holdings: sub.holdings.length }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, msg: 'Thiết bị chưa đăng ký push' }));
    }
    return;
  }
  if (p === '/push/unsubscribe' && req.method === 'POST') {
    const body = await readBody(req);
    if (body && body.endpoint) {
      const before = subs.length;
      subs = subs.filter(s => s.endpoint !== body.endpoint);
      if (subs.length !== before) saveSubs();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  // --- Tin tức thị trường ---
  if (p === '/news') {
    const params = new URLSearchParams(qs || '');
    const q = (params.get('q') || '').toLowerCase();
    const lang = params.get('lang') || '';
    const limit = Math.min(parseInt(params.get('limit'), 10) || 60, 200);
    let list = newsCache;
    if (lang) list = list.filter(n => n.lang === lang);
    if (q) {
      const terms = q.split(/[,\s]+/).filter(Boolean);
      list = list.filter(n => {
        const hay = (n.title + ' ' + n.desc).toLowerCase();
        return terms.some(t => hay.includes(t));
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ updatedAt: newsUpdatedAt, total: list.length, items: list.slice(0, limit) }));
    return;
  }
  if (p === '/translate' && req.method === 'POST') {
    const body = await readBody(req);
    const texts = (body && Array.isArray(body.texts) ? body.texts : [])
      .slice(0, 60)
      .map(t => String(t).slice(0, 400));
    const items = texts.length ? await translateBatch(texts) : [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ items }));
    return;
  }
  if (p === '/push/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ subs: subs.length }));
    return;
  }
  if (p === '/push/test') {
    // Gửi thông báo thử tới mọi thiết bị đã đăng ký (mở URL này trong trình duyệt là được)
    if (Date.now() - lastTestAt < 30_000) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, msg: 'Chờ 30 giây giữa các lần test' }));
      return;
    }
    lastTestAt = Date.now();
    const n = subs.length;
    await broadcast({
      title: '🔔 Test Web Push từ Coins',
      body: `Hoạt động tốt! ${n} thiết bị đã đăng ký · ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`,
      tag: 'coins-test',
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, sent: n, remaining: subs.length }));
    console.log(`Push test → ${n} thiết bị (còn lại sau dọn dẹp: ${subs.length})`);
    return;
  }
  if (p === '/myip') {
    // IP outbound của server — dùng để whitelist trong Binance API
    // (lệnh giao dịch đi qua proxy nên Binance thấy IP này, không phải IP người dùng)
    try {
      const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(10_000) });
      const d = await r.json();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ outboundIp: d.ip, note: 'Thêm IP này vào danh sách IP tin cậy khi tạo API key Binance' }));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ msg: 'Không lấy được IP: ' + e.message }));
    }
    return;
  }
  if (p === '/healthz') { res.writeHead(200); res.end('ok'); return; }

  // --- File tĩnh ---
  let fp = p === '/' ? '/index.html' : decodeURIComponent(p);
  if (fp.includes('..') || fp.startsWith('/server') ) { res.writeHead(403); res.end(); return; }
  fs.readFile(path.join(ROOT, fp), (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    // HTML/JS/CSS: no-cache để deploy mới có hiệu lực ngay (max-age khiến
    // trình duyệt/CDN giữ JS cũ 1 giờ, đè cả chiến lược network-first của SW).
    // Chỉ icon/ảnh mới cache lâu.
    const ext = path.extname(fp);
    const longCache = ext === '.png' || ext === '.ico';
    if (fp === '/index.html') {
      // Gắn version vào URL tài nguyên: deploy mới = URL mới → Cloudflare/trình duyệt
      // không thể trả bản cũ dù có cache kiểu gì
      data = Buffer.from(
        data.toString('utf8')
          .replace('css/style.css', `css/style.css?v=${BOOT_VERSION}`)
          .replace('js/engine.js', `js/engine.js?v=${BOOT_VERSION}`)
          .replace('js/app.js', `js/app.js?v=${BOOT_VERSION}`)
      );
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': longCache ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Coins server chạy tại cổng ${PORT} · ${subs.length} đăng ký push · quét mỗi ${SCAN_MS / 1000}s`);
  scan();
  setInterval(scan, SCAN_MS);
  refreshNews();
  setInterval(refreshNews, NEWS_REFRESH_MS);
});
