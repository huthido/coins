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

async function broadcast(payload) {
  const body = JSON.stringify(payload);
  const dead = [];
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, body);
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
}

/* ==== Vòng quét tín hiệu (khung 1h, hợp lưu 4h — như mặc định của app) ==== */

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
          getJson(`https://api.binance.com/api/v3/klines?symbol=${t.symbol}&interval=1h&limit=200`),
          getJson(`https://api.binance.com/api/v3/klines?symbol=${t.symbol}&interval=4h&limit=120`).catch(() => null),
        ]);
        const sig = engine.buildSignal(engine.parseKlines(raw), rawH ? engine.parseKlines(rawH) : null, t);
        const prevCls = prev.get(t.symbol);
        prev.set(t.symbol, sig.cls);
        if (!sig.cls.includes('strong') || prevCls === sig.cls) continue;
        const key = t.symbol + '|' + sig.cls;
        if (Date.now() - (lastSent.get(key) || 0) < COOLDOWN_MS) continue;
        lastSent.set(key, Date.now());
        events.push({ t, sig });
      } catch { /* bỏ qua coin lỗi */ }
    }

    if (firstScan) {
      firstScan = false;
      console.log(`Quét đầu: ${tickers.length} coin, ${events.length} tín hiệu mạnh (không push để tránh dội sau khi khởi động)`);
      return;
    }
    for (const { t, sig } of events) {
      const isBuy = sig.cls.startsWith('buy');
      const payload = {
        title: (isBuy ? '🟢 MUA MẠNH: ' : '🔴 BÁN MẠNH: ') + t.base,
        body: `Điểm ${sig.score > 0 ? '+' : ''}${sig.score} · ${fmtUsd(t.price)} USDT · khung 1h`,
        tag: 'coins-' + t.symbol,
        sym: t.symbol,
      };
      console.log('PUSH:', payload.title, payload.body, `→ ${subs.length} thiết bị`);
      await broadcast(payload);
    }
  } catch (e) {
    console.error('scan lỗi:', e.message);
  }
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
  if (p === '/healthz') { res.writeHead(200); res.end('ok'); return; }

  // --- File tĩnh ---
  let fp = p === '/' ? '/index.html' : decodeURIComponent(p);
  if (fp.includes('..') || fp.startsWith('/server') ) { res.writeHead(403); res.end(); return; }
  fs.readFile(path.join(ROOT, fp), (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const noCache = fp === '/sw.js' || fp === '/manifest.webmanifest' || fp === '/index.html';
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Coins server chạy tại cổng ${PORT} · ${subs.length} đăng ký push · quét mỗi ${SCAN_MS / 1000}s`);
  scan();
  setInterval(scan, SCAN_MS);
});
