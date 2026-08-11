/* Service worker: cache app shell để chạy offline + giữ dữ liệu API lần cuối */
'use strict';

const SHELL_CACHE = 'coins-shell-v1';
const API_CACHE = 'coins-api-v1';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Proxy giao dịch (/xapi, /xapi-testnet): luôn đi thẳng mạng, không bao giờ cache
  if (url.pathname.startsWith('/xapi')) return;

  if (url.origin === self.location.origin) {
    // App shell: lấy từ cache trước (mở tức thì, chạy được offline),
    // đồng thời tải bản mới về cập nhật cache cho lần sau.
    e.respondWith(
      caches.match(req).then((cached) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || fresh;
      })
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
