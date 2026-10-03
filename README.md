# Điểm Danh & Báo Cơm - Điểm Trường Mỹ Hòa - Trường Mầm Non Bắc Gianh (bản Vercel)

Chỉ có 3 file quan trọng:
- `index.html`   : giao diện
- `api/index.js` : máy chủ (Vercel Function)
- `package.json` : khai báo thư viện kết nối cơ sở dữ liệu Redis

## A. Đưa file lên GitHub (repo Mh) - làm trên điện thoại được
1. Vào repo Mh -> Add file -> Upload files -> chọn 3 file: `index.html`, `package.json`, `index.js`
   (index.html và package.json sẽ ghi đè bản cũ) -> Commit changes.
2. Mở file `index.js` vừa tải lên -> bấm biểu tượng cây bút (Edit) -> bấm vào ô tên file,
   gõ thêm `api/` vào TRƯỚC chữ `index.js` để tên thành `api/index.js` -> Commit changes.
   (GitHub tự tạo thư mục `api` và chuyển file vào đó.)
3. File cũ của Netlify (netlify.toml, thư mục netlify) không ảnh hưởng, có thể xoá hoặc để nguyên.

## B. Tạo site trên Vercel
1. vercel.com -> Continue with GitHub -> Add New... -> Project -> Import repo `Mh`
   -> Framework Preset chọn **Other** -> Deploy.
2. Thêm cơ sở dữ liệu: vào project -> tab **Storage** -> Create Database -> chọn **Upstash for Redis**
   -> gói Free -> Connect to Project (chọn đủ Development, Preview, Production).
   Vercel tự thêm 2 biến KV_REST_API_URL và KV_REST_API_TOKEN.
3. Tab Deployments -> dấu ba chấm ở bản mới nhất -> **Redeploy** (bắt buộc để nhận kết nối Redis vừa thêm).
4. Mở link `.vercel.app` và thử: Bước 5 đăng nhập bằng mật khẩu **admin** -> thêm học sinh -> mở trên điện thoại khác.

Mật khẩu Bước 4 (link nhóm chat) và Bước 5 (quản lý học sinh) là **admin** (cố định, không phân biệt hoa/thường),
không cần cài đặt gì trên Vercel. Muốn đổi: sửa dòng `const ADMIN_PASSWORD = 'admin';` trong file `api/index.js`.

## Cập nhật sau này
Sửa/tải file mới lên GitHub (cùng tên) -> Vercel tự triển khai lại sau 1-2 phút.

## Cách hoạt động
- Cổng báo cơm mở 18:00 - 06:00 (giờ Việt Nam). Học sinh luôn bắt đầu ở "Chưa chọn".
- 06:00 sáng: bé chưa chọn tự chuyển "Báo muộn" và trừ 20.000đ. 17:30 chiều (trừ thứ 6, thứ 7): mở chu kỳ mới, lưu lịch sử.
- Không cần Cron Job: việc khoá 06:00 và mở chu kỳ 17:30 được hệ thống tự áp dụng ngay ở lần truy cập đầu tiên sau mốc giờ
  (Cron miễn phí của Vercel chỉ đảm bảo "trong vòng 1 giờ" nên không dùng).
- Đồng hồ, đếm ngược và nút khoá luôn theo GIỜ VIỆT NAM, kể cả khi điện thoại đang ở múi giờ khác.
- Số điện thoại phụ huynh được che (3 số đầu + 4 số cuối) ngay trên máy chủ; chỉ file sao lưu (cần mật khẩu) mới có số đầy đủ.
- Màn hình tự làm mới mỗi 60 giây (để nằm trong hạn mức miễn phí 500.000 lệnh/tháng của Upstash).
- Giao diện luôn hiện danh sách lớp ngay cả khi máy chủ lỗi; khi lỗi sẽ có thanh cảnh báo màu vàng/đỏ ghi rõ nguyên nhân.

## Nếu thấy chậm (tuỳ chọn)
Tạo Upstash Redis ở khu vực Singapore và vào Settings -> Functions -> Function Region chọn Singapore (sin1).

## Không đăng nhập được Bước 4 / Bước 5?
Ô đỏ ngay dưới nút đăng nhập sẽ ghi đúng nguyên nhân:
- "Mật khẩu không đúng": mật khẩu là `admin` (không phân biệt hoa/thường; bấm "Hiện / ẩn mật khẩu" để kiểm tra).
- "Chưa kết nối cơ sở dữ liệu Redis...": chưa làm bước B2, hoặc làm rồi nhưng chưa Redeploy (B3).
- "Nhập sai quá nhiều lần": đợi 15 phút (tối đa 10 lần sai cho mỗi mạng/IP).

## Nếu có lỗi
Thanh cảnh báo ở đầu trang cho biết nguyên nhân (ví dụ chưa nối Redis). Vercel -> project -> tab Logs xem chi tiết.
Lỗi hay gặp: quên bước B2 (chưa nối Redis) hoặc quên Redeploy sau khi nối Redis.
