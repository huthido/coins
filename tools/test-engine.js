'use strict';
const e = require('../js/engine.js');
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name, extra); }
};

function mk(closes, opts = {}) {
  return {
    closes,
    highs: opts.highs || closes.map(c => c * 1.01),
    lows: opts.lows || closes.map(c => c * 0.99),
    volumes: opts.volumes || closes.map(() => 1000),
    takerBuy: opts.takerBuy || closes.map((c, i, a) => (i > 0 && c > a[i - 1] ? 700 : 300)),
  };
}

console.log('== Unit: EMA ==');
{
  const flat = new Array(60).fill(5);
  const ema = e.emaSeries(flat, 20);
  ok(Math.abs(ema[59] - 5) < 1e-9, 'EMA của giá phẳng = chính giá đó');
  // đối chiếu với tính tay đệ quy độc lập
  const vals = Array.from({ length: 30 }, (_, i) => i + 1);
  const ema3 = e.emaSeries(vals, 3);
  let ref = (1 + 2 + 3) / 3;
  const k = 2 / 4;
  for (let i = 3; i < 30; i++) ref = vals[i] * k + ref * (1 - k);
  ok(Math.abs(ema3[29] - ref) < 1e-9, 'EMA khớp công thức đệ quy chuẩn');
  ok(e.emaSeries([1, 2], 20).every(v => v == null), 'EMA chuỗi ngắn hơn chu kỳ → toàn null, không crash');
}

console.log('== Unit: RSI ==');
{
  const flat = new Array(60).fill(5);
  const r = e.rsiSeries(flat);
  ok(r[59] === 50, 'RSI giá đứng yên = 50 (không phải 100 quá mua)', 'got ' + r[59]);
  const up = Array.from({ length: 60 }, (_, i) => 10 + i);
  ok(e.rsiSeries(up)[59] === 100, 'RSI tăng liên tục = 100');
  const dn = Array.from({ length: 60 }, (_, i) => 100 - i);
  ok(e.rsiSeries(dn)[59] === 0, 'RSI giảm liên tục = 0');
  const rnd = Array.from({ length: 200 }, (_, i) => 50 + Math.sin(i * 1.7) * 5 + Math.sin(i * 0.3) * 10);
  const rr = e.rsiSeries(rnd);
  ok(rr.slice(15).every(v => v >= 0 && v <= 100), 'RSI luôn trong [0, 100]');
}

console.log('== Unit: MACD ==');
{
  const flat = new Array(100).fill(7);
  const { hist } = e.macdSeries(flat);
  ok(Math.abs(hist[99]) < 1e-9, 'MACD hist của giá phẳng = 0');
  const { macd, signal } = e.macdSeries(Array.from({ length: 100 }, (_, i) => 10 + i * 0.5));
  ok(macd[99] != null && signal[99] != null, 'MACD/signal căn chỉnh đúng chỉ số cuối');
}

console.log('== Unit: ATR / ADX / SuperTrend ==');
{
  const closes = new Array(60).fill(10);
  const d = mk(closes); // high 10.1, low 9.9 → TR = 0.2
  const atr = e.atrSeries(d.highs, d.lows, d.closes);
  ok(Math.abs(atr[59] - 0.2) < 1e-6, 'ATR nến biên độ cố định = biên độ đó', 'got ' + atr[59]);
  const up = Array.from({ length: 100 }, (_, i) => 10 + i);
  const du = mk(up);
  ok(e.supertrendDir(du.highs, du.lows, du.closes)[99] === 1, 'SuperTrend xu hướng tăng dài → 1');
  const dn = Array.from({ length: 100 }, (_, i) => 200 - i);
  const dd = mk(dn);
  ok(e.supertrendDir(dd.highs, dd.lows, dd.closes)[99] === -1, 'SuperTrend xu hướng giảm dài → -1');
  const { adx } = e.adxSeries(du.highs, du.lows, du.closes);
  ok(adx[99] > 25, 'ADX xu hướng một chiều mạnh > 25', 'got ' + adx[99]);
}

console.log('== Unit: OBV chuẩn hoá ==');
{
  const up = Array.from({ length: 30 }, (_, i) => 10 + i);
  ok(Math.abs(e.obvSlope(up, up.map(() => 100)) - 1) < 1e-9, 'Toàn nến tăng → obvSlope = +1 (biên trên)');
  const dn = Array.from({ length: 30 }, (_, i) => 50 - i);
  ok(Math.abs(e.obvSlope(dn, dn.map(() => 100)) + 1) < 1e-9, 'Toàn nến giảm → obvSlope = -1 (biên dưới)');
  const alt = Array.from({ length: 30 }, (_, i) => 10 + (i % 2)); // tăng giảm xen kẽ
  ok(Math.abs(e.obvSlope(alt, alt.map(() => 100))) <= 0.2, 'Xen kẽ tăng/giảm → gần 0');
  ok(e.obvSlope([1, 2, 3], [1, 1, 1]) === 0, 'Chuỗi quá ngắn → 0, không crash');
}

console.log('== Unit: pricePosition / reversalTurn ==');
{
  const up = Array.from({ length: 100 }, (_, i) => 10 + i);
  const du = mk(up);
  ok(e.pricePosition(du.highs, du.lows, up[99], 90) > 0.95, 'Giá tại đỉnh biên độ → pos ≈ 1');
  const dn = Array.from({ length: 100 }, (_, i) => 200 - i);
  const dd = mk(dn);
  ok(e.pricePosition(dd.highs, dd.lows, dn[99], 90) < 0.05, 'Giá tại đáy biên độ → pos ≈ 0');
  ok(e.pricePosition([5, 5], [5, 5], 5, 90) === 0.5, 'Biên độ bằng 0 → pos = 0.5, không chia 0');
  // turn.up + turn.down không bao giờ vượt 4 (các cặp tín hiệu loại trừ nhau)
  const rnd = Array.from({ length: 200 }, (_, i) => 50 + Math.sin(i * 0.7) * 8);
  const dr = mk(rnd);
  const rsiA = e.rsiSeries(rnd);
  const { hist } = e.macdSeries(rnd);
  const stA = e.supertrendDir(dr.highs, dr.lows, dr.closes);
  const t = e.reversalTurn(rnd, rsiA, hist, stA);
  ok(t.up + t.down <= 4, 'turn.up + turn.down ≤ 4 (tín hiệu loại trừ nhau)', JSON.stringify(t));
}

console.log('== Unit: swingStats (tỉ lệ tăng giảm lịch sử) ==');
{
  // Sóng sin biên độ lớn → nhiều nhịp hoàn chỉnh, biên độ mỗi nhịp ≈ đỉnh-đáy
  const wave = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 8) * 30);
  const dw = mk(wave);
  const sw = e.swingStats(dw.highs, dw.lows, dw.closes);
  ok(sw.count >= 3, 'Sóng lớn lặp lại → nhiều nhịp dao động', JSON.stringify(sw));
  ok(sw.avgPct > 20, 'Biên độ nhịp trung bình phản ánh đúng sóng ±30/100', 'avgPct=' + sw.avgPct.toFixed(1));
  // Giá phẳng → không có nhịp nào
  const flat = mk(new Array(200).fill(50));
  const sf = e.swingStats(flat.highs, flat.lows, flat.closes);
  ok(sf.count === 0, 'Giá phẳng → 0 nhịp', JSON.stringify(sf));
  // Tăng một chiều → tối đa 1 nhịp (nhịp đang mở), không đếm nhầm nhiều nhịp
  const up = Array.from({ length: 200 }, (_, i) => 10 * Math.pow(1.01, i));
  const du = mk(up);
  const su = e.swingStats(du.highs, du.lows, du.closes);
  ok(su.count <= 1, 'Tăng một chiều → ≤1 nhịp (không có dao động lặp lại)', JSON.stringify(su));
  ok(e.swingStats([1, 2], [1, 2], [1, 2]).count === 0, 'Chuỗi quá ngắn → 0 nhịp, không crash');
}

console.log('== Unit: alertPriority (ưu tiên thông báo theo danh mục) ==');
{
  const P = e.alertPriority;
  // Chưa có dữ liệu danh mục (held = null): hành vi cũ — chỉ tín hiệu MẠNH
  ok(P('buy strong', null, false) === 1 && P('sell strong', null, false) === 2, 'Chưa kết nối API: chỉ báo MẠNH, BÁN xếp trước MUA');
  ok(P('buy', null, false) === 0 && P('sell', null, false) === 0, 'Chưa kết nối API: tín hiệu thường không báo');
  // Coin đang giữ: ưu tiên BÁN, báo cả BÁN thường
  ok(P('sell', true, false) === 4 && P('sell strong', true, false) === 5, 'Đang giữ: BÁN thường cũng báo, BÁN MẠNH ưu tiên cao nhất');
  ok(P('buy strong', true, false) === 1 && P('buy', true, false) === 0, 'Đang giữ: MUA MẠNH ưu tiên thấp nhất, MUA thường không báo');
  // Coin chưa giữ: ưu tiên MUA, BÁN là vô hành động
  ok(P('buy strong', false, false) === 3 && P('buy', false, false) === 0, 'Chưa giữ: chỉ MUA MẠNH');
  ok(P('sell strong', false, false) === 0 && P('sell', false, false) === 0, 'Chưa giữ: BÁN không báo (không có gì để bán)');
  ok(P('sell strong', false, true) === 2, 'Chưa giữ nhưng ★ theo dõi: BÁN MẠNH vẫn báo');
  ok(P('hold', true, true) === 0, 'GIỮ/THEO DÕI: không bao giờ báo');
  // Thứ tự ưu tiên tổng thể đúng như thiết kế
  ok(P('sell', true, false) > P('buy strong', false, false) &&
     P('buy strong', false, false) > P('sell strong', false, true) &&
     P('sell strong', false, true) > P('buy strong', true, false),
    'Thứ tự: BÁN coin giữ > MUA coin mới > BÁN coin ★ > MUA thêm coin giữ');
}

console.log('== Độ bền dữ liệu xấu / chuỗi ngắn ==');
{
  const short = mk(Array.from({ length: 30 }, (_, i) => 10 + Math.sin(i)));
  const s = e.buildSignal(short, null, { changePct: 1 });
  ok(Number.isFinite(s.score), 'Coin mới niêm yết 30 nến → không crash, điểm hữu hạn');
  const nanTaker = mk(Array.from({ length: 100 }, (_, i) => 10 + Math.sin(i)), {
    takerBuy: new Array(100).fill(NaN),
  });
  const s2 = e.buildSignal(nanTaker, null, { changePct: 1 });
  ok(s2.takerRatio == null && Number.isFinite(s2.score), 'takerBuy toàn NaN → takerRatio null, điểm vẫn hữu hạn');
  const flat = mk(new Array(158).fill(3));
  const s3 = e.buildSignal(flat, null, { changePct: 0 });
  ok(Number.isFinite(s3.score) && s3.verdict === 'GIỮ / THEO DÕI',
    'Giá phẳng tuyệt đối → GIỮ, không bị RSI 100 kéo thành BÁN', `${s3.verdict} ${s3.score} rsi=${s3.rsi}`);
}

console.log('== Kịch bản mua đáy / bán đỉnh ==');
{
  let v = [];
  for (let i = 0; i < 150; i++) v.push(100 - i * 0.4 + Math.sin(i) * 0.5);
  for (let i = 0; i < 8; i++) v.push(v[v.length - 1] * 1.012);
  const sB = e.buildSignal(mk(v), null, { changePct: -5 });
  ok(sB.score >= 3 && sB.cls.startsWith('buy'), 'Đáy chữ V vừa quay đầu tăng → MUA', `${sB.verdict} ${sB.score}`);

  let p = [];
  for (let i = 0; i < 150; i++) p.push(40 + i * 0.4 + Math.sin(i) * 0.5);
  for (let i = 0; i < 8; i++) p.push(p[p.length - 1] * 0.988);
  const sT = e.buildSignal(mk(p), null, { changePct: 5 });
  ok(sT.score < 0 && sT.reasons.some(r => r.text.includes('chốt lời đẹp')),
    'Đỉnh vừa quay đầu giảm → điểm âm + cố vấn "thời điểm chốt lời đẹp"', `${sT.verdict} ${sT.score}`);

  // Quỹ đạo gãy đỉnh: BÁN phải phát khi giá còn ở vùng cao (bán cao), và khi giá
  // đã rơi về vùng đáy thì không còn hô BÁN (không bán tháo)
  {
    let q = [];
    for (let i = 0; i < 150; i++) q.push(40 + i * 0.4 + Math.sin(i) * 0.5);
    let soldHigh = false, panicAtBottom = false;
    for (let k = 1; k <= 20; k++) {
      q.push(q[q.length - 1] * 0.988);
      const s = e.buildSignal(mk(q.slice(-158)), null, { changePct: -3 });
      if (s.score <= -3 && s.pricePos >= 0.6) soldHigh = true;
      if (s.score <= -3 && s.pricePos <= 0.30) panicAtBottom = true;
    }
    ok(soldHigh, 'Gãy đỉnh: tín hiệu BÁN phát khi giá còn ở vùng cao (≥60% biên độ)');
    ok(!panicAtBottom, 'Gãy đỉnh: khi giá đã về vùng đáy thì không còn hô BÁN');
  }

  let up = [];
  for (let i = 0; i < 158; i++) up.push(40 + i * 0.4 + Math.sin(i) * 0.3);
  const sC = e.buildSignal(mk(up), null, { changePct: 8 });
  ok(sC.score < 3, 'Đang ở đỉnh còn tăng → KHÔNG đề xuất mua đuổi', `${sC.verdict} ${sC.score}`);

  let dn = [];
  for (let i = 0; i < 158; i++) dn.push(100 - i * 0.4 + Math.sin(i) * 0.3);
  const sK = e.buildSignal(mk(dn), null, { changePct: -8 });
  ok(sK.score > -3, 'Dao rơi ở đáy → KHÔNG hô bán tháo', `${sK.verdict} ${sK.score}`);

  // Đối xứng: cùng dữ liệu lộn ngược quanh trục — điểm phải gần đối dấu về hành vi
  ok(sB.pricePos <= 0.30 && sT.pricePos >= 0.70, 'pricePos phản ánh đúng vùng đáy/đỉnh',
    `bottom=${sB.pricePos.toFixed(2)} top=${sT.pricePos.toFixed(2)}`);
}

console.log('== Chốt chặn vô điều kiện ==');
{
  // Tăng mạnh liên tục, mọi tín hiệu turn.up đều bật → trước đây gate bị bỏ qua
  let strong = [];
  for (let i = 0; i < 130; i++) strong.push(40 + Math.sin(i / 5) * 1);
  for (let i = 0; i < 28; i++) strong.push(strong[strong.length - 1] * 1.015);
  const s = e.buildSignal(mk(strong), null, { changePct: 12 });
  const gated = s.reasons.some(r => r.text.includes('mua đuổi đỉnh'));
  ok(s.pricePos >= 0.70 ? (s.score < 3 || !s.cls.startsWith('buy') || false) || gated : true,
    'Đà tăng mạnh ở đỉnh: gate vẫn áp dụng (có lý do "tránh mua đuổi đỉnh") hoặc không MUA',
    `${s.verdict} ${s.score} pos=${(s.pricePos * 100).toFixed(0)}% gated=${gated}`);
  ok(!(s.score >= 6), 'Không bao giờ MUA MẠNH khi giá ở 70%+ biên độ', `${s.verdict} ${s.score}`);
}

console.log(`\n==== ${pass} pass, ${fail} fail ====`);
process.exit(fail ? 1 : 0);
