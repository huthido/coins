/* Service worker: cache app shell để chạy offline + giữ dữ liệu API lần cuối */
'use strict';

const SHELL_CACHE = 'coins-shell-v3';
const API_CACHE = 'coins-api-v1';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/engine.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== API_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ==== Web Push: nhận thông báo từ server kể cả khi app/trình duyệt đã đóng ==== */

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'Coins', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Coins', {
    body: d.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: d.tag || 'coins-push',
    data: { sym: d.sym || null },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const sym = e.notification.data && e.notification.data.sym;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        c.focus();
        if (sym) c.postMessage({ coin: sym });
        return;
      }
      return self.clients.openWindow(sym ? `./?coin=${encodeURIComponent(sym)}` : './');
    })
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Proxy giao dịch (/xapi, /xapi-testnet): luôn đi thẳng mạng, không bao giờ cache
  if (url.pathname.startsWith('/xapi')) return;

  if (url.origin === self.location.origin) {
    // App shell: ưu tiên MẠNG để bản deploy mới đến người dùng ngay lần tải đầu tiên;
    // cache:'no-cache' ép revalidate qua HTTP cache của trình duyệt (nếu không,
    // max-age cũ có thể trả JS cũ dù đã fetch). Mất mạng mới rơi về cache SW.
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || Response.error()))
    );
  } else if (url.searchParams.has('signature')) {
    // Request đã ký (số dư, lệnh giao dịch): không cache — URL chứa chữ ký
    // duy nhất mỗi lần nên cache chỉ phình to và lưu vết không cần thiết.
    return;
  } else {
    // API (Binance, tỷ giá): ưu tiên mạng để có giá mới nhất;
    // mất mạng thì trả về dữ liệu đã lưu lần cuối.
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(API_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || Response.error()))
    );
  }
});
