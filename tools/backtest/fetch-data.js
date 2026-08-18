'use strict';
// Tải và cache dữ liệu nến lịch sử từ Binance cho backtest
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'data');

const COINS = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT',
  'LINKUSDT','AVAXUSDT','DOTUSDT','LTCUSDT','NEARUSDT','SUIUSDT','PEPEUSDT'];
const TFS = ['1d', '4h'];

(async () => {
  for (const sym of COINS) {
    for (const tf of TFS) {
      const f = path.join(DIR, `${sym}-${tf}.json`);
      if (fs.existsSync(f)) { console.log('cache', sym, tf); continue; }
      const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${tf}&limit=1000`;
      const raw = await (await fetch(url)).json();
      if (!Array.isArray(raw)) { console.log('LỖI', sym, tf, JSON.stringify(raw).slice(0, 100)); continue; }
      fs.writeFileSync(f, JSON.stringify(raw));
      console.log('tải', sym, tf, raw.length, 'nến');
      await new Promise(r => setTimeout(r, 250));
    }
  }
})();
