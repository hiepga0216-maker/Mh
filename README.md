# Điểm Danh & Báo Cơm - Điểm Trường Mỹ Hòa - Trường Mầm Non Bắc Gianh (bản Vercel)

Chỉ cần 2 file: `index.html` (giao diện) và `api/index.js` (máy chủ).
Không cần `package.json` hay thư viện nào (file `package.json` có thể xoá hoặc để nguyên).

## A. Đưa file lên GitHub (repo Mh) - làm trên điện thoại được
1. Nếu repo ĐÃ có file `api/index.js` cũ: mở file đó -> biểu tượng thùng rác (Delete file) -> Commit changes.
2. Add file -> Upload files -> chọn 2 file `index.html` và `index.js` (index.html sẽ ghi đè bản cũ) -> Commit changes.
3. Mở file `index.js` vừa tải lên -> bấm biểu tượng cây bút (Edit) -> bấm vào ô tên file,
   gõ thêm `api/` vào TRƯỚC chữ `index.js` để tên thành `api/index.js` -> Commit changes.
   (Cẩn thận iPhone tự viết hoa: phải là `api` viết thường.)
Kết quả đúng: trang chính của repo có thư mục `api`, bên trong có file `index.js`.

## B. Tạo site trên Vercel
1. vercel.com -> Continue with GitHub -> Add New... -> Project -> Import repo `Mh`
   -> Framework Preset chọn **Other** -> Deploy.
2. Thêm cơ sở dữ liệu: vào project -> tab **Storage** -> Create Database -> chọn **Upstash for Redis**
   -> gói **Free** -> Connect to Project (chọn đủ Development, Preview, Production).
3. Tab Deployments -> dấu ba chấm ở bản mới nhất -> **Redeploy** (bắt buộc để nhận kết nối Redis vừa thêm).
4. Mở link `.vercel.app` và thử: Bước 5 đăng nhập bằng mật khẩu **admin** -> thêm học sinh -> mở trên điện thoại khác.

Mật khẩu Bước 4 và Bước 5 là **admin** (cố định, không phân biệt hoa/thường). Muốn đổi: sửa dòng
`const ADMIN_PASSWORD = 'admin';` trong file `api/index.js` (chỉ dùng chữ và số, KHÔNG dùng dấu nháy ' hoặc \).
Mật khẩu nằm trong file trên GitHub nên repo `Mh` phải để **Private**.

## Link nhóm chat & mật khẩu cho TỪNG LINK (riêng tư)
Bước 4 (đăng nhập admin) -> với mỗi lớp:
- Dán **link nhóm** Messenger/Zalo của lớp.
- (Tuỳ chọn) đặt **mật khẩu riêng của lớp** (4-40 ký tự; gõ dấu `-` để xoá). Mật khẩu này chỉ mở được nhóm của đúng lớp đó.
- Bấm "Lưu". Link và mật khẩu luôn ẩn, không xem lại được (chỉ ghi đè bằng giá trị mới).

Khi dùng **Gửi nhanh** (ô ở đầu Bước 4): bấm tên lớp -> nhập mật khẩu (mật khẩu riêng của lớp, hoặc mật khẩu admin mở được mọi lớp)
-> nhóm chat mới mở ra với nội dung nhắc nhở (Messenger điền sẵn, Zalo đã copy sẵn) -> bấm Gửi trong Messenger/Zalo.
- Không có mật khẩu thì máy chủ KHÔNG trả link cho bất kỳ ai.
- Đã đăng nhập admin ở Bước 4 trong phiên đó thì Gửi nhanh không hỏi lại.
- Nhập sai quá 10 lần (mỗi mạng/IP) bị khoá 15 phút.
- Gửi tin vào nhóm không tự động hoàn toàn được (giới hạn của Messenger/Zalo): luôn phải bấm Gửi.

## Kiểm tra nhanh máy chủ
Mở trong trình duyệt: `https://<tên-site>.vercel.app/api?r=ping`
- Thấy `{"ok":true,...,"redis":true}` -> máy chủ và cơ sở dữ liệu đều tốt.
- `"redis":false` -> chưa làm B2 hoặc làm rồi nhưng chưa Redeploy (B3).
- Trang lỗi 404 -> file chưa nằm đúng `api/index.js` (xem lại bước A3).
- Trang lỗi 500 -> file `api/index.js` trên GitHub chưa phải bản mới nhất.
Cũng có thể bấm nút **"🔧 Kiểm tra kết nối máy chủ"** ngay ở màn hình đăng nhập Bước 4 / Bước 5.

## Cập nhật sau này
Sửa/tải file mới lên GitHub (cùng tên) -> Vercel tự triển khai lại sau 1-2 phút.

## Cách hoạt động
- Cổng báo cơm mở 18:00 - 06:00 (giờ Việt Nam). Học sinh luôn bắt đầu ở "Chưa chọn".
- 06:00 sáng: bé chưa chọn tự chuyển "Báo muộn" và trừ 20.000đ. 17:30 chiều (trừ thứ 6, thứ 7): mở chu kỳ mới, lưu lịch sử.
- Không cần Cron Job: việc khoá 06:00 và mở chu kỳ 17:30 được hệ thống tự áp dụng ngay ở lần truy cập đầu tiên sau mốc giờ.
- Đồng hồ, đếm ngược và nút khoá luôn theo GIỜ VIỆT NAM, kể cả khi điện thoại ở múi giờ khác.
- Số điện thoại phụ huynh được che (3 số đầu + 4 số cuối) ngay trên máy chủ; chỉ file sao lưu (cần mật khẩu) mới có số đầy đủ.
- Màn hình tự làm mới mỗi 60 giây (để nằm trong hạn mức miễn phí của Upstash).
- Giao diện luôn hiện danh sách lớp ngay cả khi máy chủ lỗi; khi lỗi có thanh/ô cảnh báo ghi rõ nguyên nhân.

## Nếu thấy chậm (tuỳ chọn)
Tạo Upstash Redis ở khu vực Singapore và vào Settings -> Functions -> Function Region chọn Singapore (sin1).
