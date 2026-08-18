'use strict';
// Test tích hợp: server thật + /push/subscribe + /push/prefs + lưu trữ
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATA = path.join(require('os').tmpdir(), 'coins-test-srvdata');
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
const PORT = 8200 + Math.floor(Math.random() * 500); // cổng ngẫu nhiên tránh đụng tiến trình cũ

const child = spawn(process.execPath, ['server.js'], {
  cwd: path.join(__dirname, '..', 'server'),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, SCAN_MS: '600000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', d => { logs += d; });
child.stderr.on('data', d => { logs += d; });

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let ok = false;
  const base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 40; i++) {
    await wait(250);
    try { await fetch(base + '/healthz'); ok = true; break; } catch { /* chưa lên */ }
  }
  let fail = 0;
  const check = (cond, name, extra = '') => {
    if (cond) console.log('  ✓', name);
    else { fail++; console.log('  ✗ FAIL:', name, extra); }
  };
  if (!ok) { console.log('✗ server không khởi động\n--- log ---\n' + logs); child.kill(); process.exit(1); }
  try {
    const ep = 'https://fcm.example.com/fake-endpoint-123';
    let r = await (await fetch(base + '/push/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: { endpoint: ep, keys: { p256dh: 'x', auth: 'y' } } }),
    })).json();
    check(r.ok === true && r.count === 1, 'Đăng ký push', JSON.stringify(r));

    r = await (await fetch(base + '/push/prefs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: ep, holdings: ['btc', 'ETH', 'sol', 'ETH'] }),
    })).json();
    check(r.ok === true && r.holdings === 3, 'Đồng bộ danh mục: chuẩn hoá hoa + khử trùng lặp (4 mục → 3)', JSON.stringify(r));

    const bad = await fetch(base + '/push/prefs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://unknown', holdings: [] }),
    });
    check(bad.status === 404, 'Endpoint lạ → 404', 'HTTP ' + bad.status);

    const subs = JSON.parse(fs.readFileSync(path.join(DATA, 'subs.json'), 'utf8'));
    check(Array.isArray(subs[0].holdings) && subs[0].holdings.join(',') === 'BTC,ETH,SOL',
      'subs.json lưu holdings đã chuẩn hoá', JSON.stringify(subs[0].holdings));
  } catch (e) {
    fail++;
    console.log('  ✗ lỗi test:', e.message);
  }
  child.kill();
  console.log(fail ? `\n==== ${fail} FAIL ====` : '\n==== Tất cả test server ĐẠT ====');
  process.exit(fail ? 1 : 0);
})();
