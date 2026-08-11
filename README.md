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
- **Đề xuất mua bán** chấm điểm từ các chỉ báo (phân tích lại mỗi 5 phút):
  - RSI 14 (quá mua / quá bán)
  - EMA 20 / EMA 50 (xu hướng, golden cross / death cross)
  - MACD 12-26-9 (động lượng, giao cắt đường tín hiệu)
  - Biến động 24h kết hợp RSI (bắt đáy / cảnh báo quá nóng)

  Điểm ≥ +4: **MUA MẠNH** · ≥ +2: MUA · ≤ −4: **BÁN MẠNH** · ≤ −2: BÁN · còn lại: GIỮ.
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

Dự án đã kèm sẵn `Dockerfile` (nginx phục vụ file tĩnh, cổng 80):

1. Đẩy thư mục này lên một git repository (GitHub/GitLab/Gitea…).
2. Trong Coolify: **+ New → Application → chọn repository**.
3. **Build Pack**: chọn `Dockerfile` (Coolify tự phát hiện).
4. **Ports Exposes**: `80`.
5. Gán domain rồi bấm **Deploy** — Coolify tự cấp HTTPS qua Let's Encrypt.

Không cần biến môi trường hay database — toàn bộ dữ liệu (giá Binance, tỷ giá VND)
được trình duyệt của người dùng gọi trực tiếp; danh sách coin theo dõi đặc biệt
lưu trong localStorage của từng người dùng.

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
