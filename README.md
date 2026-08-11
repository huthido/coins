# Coins — Theo dõi thị trường crypto & đề xuất mua bán

Ứng dụng web tĩnh (không cần cài đặt, không cần API key) theo dõi top 30 coin
có khối lượng giao dịch lớn nhất trên Binance, hiển thị giá theo **USDT và VND**,
và đưa ra đề xuất **MUA / BÁN / GIỮ** dựa trên chỉ báo kỹ thuật.

## Cách chạy

**Cách 1 — mở trực tiếp:** nháy đúp vào `index.html` (chạy được ngay trong trình duyệt).

**Cách 2 — chạy qua server cục bộ** (nếu trình duyệt chặn fetch từ `file://`):

```
cd D:\code\Coins
npx serve .        # hoặc: python -m http.server 8000
```

rồi mở `http://localhost:3000` (hoặc cổng tương ứng).

> Lưu ý: nếu Chrome bật chế độ "Always use secure connections" (luôn dùng HTTPS),
> hãy cho phép ngoại lệ với localhost, hoặc dùng Cách 1.

## Tính năng

- **Bảng thị trường**: top 30 coin theo khối lượng 24h — giá USDT, giá quy đổi VND,
  % thay đổi 24h, khối lượng, RSI, xu hướng và đề xuất. Tự làm mới mỗi 30 giây.
- **Tỷ giá USD→VND** lấy tự động từ open.er-api.com (cache 1 giờ; nếu mạng lỗi
  dùng tỷ giá ước tính 26.300).
- **Khung phân tích**: 15 phút / 1 giờ / 4 giờ / 1 ngày.
- **Đề xuất mua bán** — bộ chấm điểm hợp lưu v2 (phân tích lại mỗi 5 phút), kết hợp
  các thuật toán có bằng chứng hiệu quả với crypto:
  - **SuperTrend (10, 3)** — chỉ báo bám xu hướng theo ATR; đảo chiều được chấm điểm cao
  - **ADX 14** — cổng lọc sức mạnh xu hướng: ADX < 20 (sideway) thì các tín hiệu
    xu hướng bị giảm nửa trọng số để tránh nhiễu
  - **Hợp lưu đa khung thời gian** — khung lớn hơn (1h→4h, 4h→1d…) đồng thuận
    mới cộng điểm; lọc bớt 40–60% tín hiệu giả
  - **Phân kỳ RSI** (đáy giá thấp hơn + đáy RSI cao hơn = phân kỳ tăng) — tín hiệu
    đảo chiều có xác suất cao nhất trong bộ
  - **OBV + tỷ lệ mua chủ động (taker buy)** — xác nhận bằng dòng khối lượng
  - **Bollinger Bands (20, 2)** — quá mua/quá bán căng + phát hiện squeeze
  - RSI 14, EMA 20/50 (golden/death cross), MACD 12-26-9, biến động 24h như v1

  Điểm ≥ +6: **MUA MẠNH** · ≥ +3: MUA · ≤ −6: **BÁN MẠNH** · ≤ −3: BÁN · còn lại: GIỮ.
- **Gợi ý quản trị rủi ro theo ATR**: mỗi coin hiển thị mức cắt lỗ (−1.5×ATR) và
  chốt lời (+2.5×ATR) tham khảo, tỷ lệ lời:lỗ ≈ 1.7.
- **Thanh thông tin thị trường**: chỉ số Sợ hãi/Tham lam (alternative.me),
  BTC Dominance + tổng vốn hóa (CoinGecko), độ rộng thị trường (số coin tăng 24h).
- **Thông tin sâu từng coin**: áp lực mua từ sổ lệnh (tỷ trọng bid trong depth 100 mức),
  funding rate futures (cảnh báo long/short đông đúc).
- **Tin tức thị trường** (panel phải, dưới phần phân tích): server tự thu thập RSS mỗi
  10 phút từ CoinDesk, Cointelegraph, Bitcoin Magazine và Coin68 (tiếng Việt), khử trùng
  lặp và phục vụ qua `/news`. Trên giao diện có ô **tìm kiếm tin**, lọc theo ngôn ngữ
  (Việt/Anh), và nút **"Tin về <coin>"** lọc tin nhắc đến coin đang chọn (nhận cả tên
  đầy đủ — BTC/bitcoin, SOL/solana…). Cần bản deploy có server Node; hosting tĩnh sẽ tự ẩn khu tin.
- **Thông báo tín hiệu mạnh** (nút 🔔): khi một coin *chuyển sang* MUA MẠNH / BÁN MẠNH,
  app hiện toast ở góc màn hình (bấm vào để mở coin đó) và gửi thông báo hệ thống của
  trình duyệt nếu đã cấp quyền (hiện cả khi đang ở tab khác). Chống spam: không lặp lại
  cùng tín hiệu trong 60 phút; lần quét đầu và khi đổi khung thời gian chỉ tóm tắt.
- **Web Push — thông báo cả khi ĐÓNG trình duyệt**: server tự quét top 30 coin mỗi 5 phút
  (khung 1h, hợp lưu 4h, cùng engine `js/engine.js` với app nên tín hiệu khớp 100%) và đẩy
  thông báo qua Web Push (VAPID) tới mọi thiết bị đã đăng ký. Cách bật: mở app đã deploy
  (HTTPS), bấm 🔔 và cấp quyền thông báo — app tự đăng ký push với server. Bấm vào thông báo
  sẽ mở app đúng coin đó. Khóa VAPID tự sinh lần đầu, lưu trong `server/data/`
  (mount volume để giữ qua các lần redeploy — xem `docker-compose.yml`).
- **Panel chi tiết**: biểu đồ giá + EMA20/50 (có tooltip theo con trỏ), biểu đồ RSI,
  danh sách lý do vì sao có đề xuất, và các chỉ số chính.
- **Phân tích coin bất kỳ**: gõ tên coin (VD: `PEPE`, `chz`, `NEARUSDT`) vào ô tìm kiếm
  rồi nhấn Enter hoặc bấm "🔎 Phân tích" — ứng dụng tra cứu cặp USDT tương ứng trên
  Binance, chạy toàn bộ chỉ báo và hiển thị đánh giá chi tiết, kể cả coin ngoài top 30.
- **Bộ lọc đà mới** (menu "Lọc"):
  - *↗ Đà tăng mới*: coin có động lượng vừa đảo chiều tăng trong ~6 nến gần nhất
    (MACD chuyển dương hoặc golden cross, giá đang tăng, RSI < 70) — cơ hội mua sớm.
  - *↘ Đà giảm mới*: động lượng vừa đảo chiều giảm (MACD chuyển âm hoặc death cross,
    giá đang giảm, RSI > 30) — cân nhắc bán trước khi giá giảm sâu hơn.
  - Lọc theo đề xuất MUA / BÁN.
  - Coin có đà mới được gắn nhãn **MỚI ↗ / MỚI ↘** ngay trong bảng.
- **★ Theo dõi đặc biệt**: bấm dấu ☆ cạnh tên coin (hoặc trong panel chi tiết) để
  đánh dấu; coin đã đánh dấu luôn ghim lên đầu bảng, có bộ lọc riêng "★ Theo dõi
  đặc biệt", được giữ lại kể cả khi rớt khỏi top 30 khối lượng, và lưu bền vững
  trong trình duyệt (localStorage).
- Tìm kiếm, sắp xếp (bấm tiêu đề cột hoặc menu), giao diện sáng/tối theo hệ điều hành,
  **tương thích mobile** (cột phụ tự ẩn trên màn hình hẹp).
- **Chia đôi màn hình** (màn hình ≥ 1080px): kéo thanh dọc giữa bảng và panel chi tiết
  để chỉnh tỷ lệ hai khung (30–72%); nháy đúp để về mặc định; tỷ lệ được ghi nhớ.

## Giao dịch trực tiếp (tùy chọn)

Bấm **⚙️ API** để kết nối API key Binance của bạn — sau đó panel chi tiết mỗi coin có
khung **Giao dịch nhanh**: đặt lệnh MUA (theo số USDT) / BÁN (theo số coin) kiểu market,
kèm số dư khả dụng, nút "Tất cả", và **xác nhận 2 bước** trước khi gửi lệnh.

**Bảo mật & lưu ý:**

- Khóa API **chỉ lưu trong localStorage của trình duyệt** và lệnh được ký HMAC-SHA256
  ngay trên máy bạn (Web Crypto). Vì Binance chặn CORS trên các endpoint có ký,
  lệnh được chuyển tiếp qua **proxy cùng origin trong nginx của app** (`/xapi`,
  `/xapi-testnet` — xem `nginx.conf`); proxy chỉ chuyển tiếp nguyên vẹn, không đọc/lưu khóa.
- **Giao dịch cần chạy app qua Docker/Coolify** (bản nginx kèm proxy). Mở `file://`
  hay chạy static server thuần vẫn xem giá/phân tích bình thường nhưng không đặt lệnh được
  (app sẽ báo rõ).
- Khi tạo key trên Binance: chỉ bật **Enable Spot Trading**, **không bật Withdraw**
  (dù ai lấy được key cũng không rút được tiền), cân nhắc giới hạn IP.
- Có chế độ **Testnet** (testnet.binance.vision, bật mặc định khi mở form) — dùng API key
  của testnet để thử đặt lệnh với tiền ảo trước khi dùng tiền thật.
- Cần chạy qua **HTTPS hoặc localhost** (Web Crypto không hoạt động trên `file://`).
- Không dùng trên máy tính công cộng; xóa key bằng nút "Xóa khóa" khi không dùng.

## PWA — cài đặt & chạy offline

Khi chạy qua **HTTPS hoặc localhost** (không hỗ trợ mở trực tiếp `file://`):

- Trình duyệt sẽ gợi ý **Cài đặt** app (biểu tượng ⊕ trên thanh địa chỉ Chrome/Edge,
  hoặc "Thêm vào màn hình chính" trên điện thoại) — chạy như ứng dụng riêng.
- **Offline**: giao diện mở được ngay không cần mạng; bảng giá và biểu đồ hiển thị
  **dữ liệu lần cập nhật cuối** đã lưu. Khi có mạng lại, giá tự cập nhật như thường.
- Cơ chế: service worker (`sw.js`) cache app shell (cache-first, tự cập nhật nền)
  và cache dữ liệu API theo kiểu network-first (ưu tiên giá mới, mất mạng dùng bản lưu).

## Deploy lên Coolify

Dự án kèm sẵn `Dockerfile` (Node server: file tĩnh + proxy Binance + Web Push, cổng 80):

1. Đẩy thư mục này lên một git repository (GitHub/GitLab/Gitea…).
2. Trong Coolify: **+ New → Application → chọn repository**.
3. **Build Pack**: chọn `Dockerfile` (Coolify tự phát hiện).
4. **Ports Exposes**: `80`.
5. (Khuyến nghị) Thêm **Persistent Storage**: mount volume vào `/app/server/data`
   để giữ khóa VAPID + danh sách đăng ký push qua các lần redeploy.
6. Gán domain rồi bấm **Deploy** — Coolify tự cấp HTTPS qua Let's Encrypt.

Không cần database; biến môi trường tùy chọn: `VAPID_SUBJECT` (mailto:email-của-bạn),
`SCAN_MS` (chu kỳ quét push, mặc định 300000 = 5 phút).

Chạy thử bằng Docker tại chỗ: `docker compose up --build` → `http://localhost:8080`.

## Nguồn dữ liệu

- Giá & nến: [Binance public API](https://api.binance.com) (`/ticker/24hr`, `/klines`)
- Tỷ giá: [open.er-api.com](https://open.er-api.com)

## Cấu trúc

```
index.html      giao diện
css/style.css   theme sáng/tối, bảng, biểu đồ
js/app.js       gọi API, chỉ báo (RSI/EMA/MACD), chấm điểm, vẽ canvas
```

## ⚠️ Miễn trừ trách nhiệm

Đây là công cụ **tham khảo** dựa thuần túy trên chỉ báo kỹ thuật, **không phải lời
khuyên đầu tư**. Thị trường tiền ảo biến động rất mạnh — luôn tự nghiên cứu và chỉ
đầu tư số tiền bạn chấp nhận mất.
