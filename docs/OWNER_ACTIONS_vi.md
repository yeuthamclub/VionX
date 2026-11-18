# Việc Leo cần tự làm (cập nhật 18/11/2026)

Làm theo thứ tự từ trên xuống. Claude không làm thay được các bước này vì chúng cần tài khoản của Leo, giấy tờ hoặc thanh toán. Mỗi bước có dòng **Xong khi** để biết lúc nào báo lại Claude.

Không dán khoá, mật khẩu hay mã bí mật vào chat. Nhập chúng vào Keychain, vào terminal (lệnh sẽ hỏi) hoặc vào trang quản trị.

---

## 1. Đổi API key Anthropic (làm ngay)

File `.wave.sh` (đã xoá ngày 18/11) chứa một API key ở dạng chữ thường trên ổ ViTu. Key đó chưa từng lên GitHub. Vẫn nên coi nó là đã lộ.

1. Mở https://console.anthropic.com → **API Keys**.
2. Tìm key đang dùng cho VionX. Nếu không chắc key nào thì xoá mọi key cũ có ngày tạo trước 18/11. Bấm **Delete**.
3. Bấm **Create Key**, đặt tên `vionx-dev-2026-11`. Sao chép key mới.
4. Lưu key vào Keychain. Lệnh dưới đây sẽ hỏi mật khẩu: dán key vào đó, màn hình không hiện gì là bình thường.
   ```bash
   cd /Volumes/ViTu/VionX/VionX-repo && security add-generic-password -U -a "$USER" -s anthropic-api-key -w
   ```
5. Vào **Settings → Limits**, đặt hạn mức chi tiêu tháng, ví dụ US$30.
6. Nếu project Supabase dev có biến `ANTHROPIC_API_KEY`, sửa luôn biến đó: **Edge Functions → Secrets**, rồi dán key mới.

**Xong khi:** key cũ đã bị xoá và key mới nằm trong Keychain.

## 2. Mật khẩu và service secret: Leo không cần làm gì

- **Project dev:**
  - service secret và mật khẩu `admin@vionx.local` đã được đổi ngày 17/11 (M06); giá trị mới chỉ nằm trong `.env.cloud`;
  - giá trị công khai trên GitHub (`local-dev-service-secret`) bị worker trên dev từ chối (401).
- **Project test:** vẫn dùng giá trị công khai, nhưng project này không có Edge Function nào (kiểm 18/11: 404), nên giá trị đó không mở được gì. Các test tích hợp cần đúng giá trị này, nên giữ nguyên.
- **Mật khẩu database:** chưa từng lộ. Không cần đổi.

## 3. Cho Claude quyền triển khai Edge Functions

M07 và M08 chưa được triển khai lên cloud. App trên điện thoại cần chúng để gọi các màn Hôm nay và Bảng phụ huynh. Chạy lệnh dưới đây một lần; trình duyệt sẽ mở để Leo đăng nhập Supabase:

```bash
cd /Volumes/ViTu/VionX/VionX-repo && npx supabase login
```

**Xong khi:** terminal báo `You are now logged in`. Claude sẽ tự chạy `supabase functions deploy … --use-api`.

## 4. Đăng nhập Google cho phụ huynh

1. Vào https://console.cloud.google.com, tạo project `VionX`.
2. Vào **APIs & Services → OAuth consent screen**. Chọn External, tên app VionX, email hỗ trợ là email của Leo, thêm email Leo vào Test users.
3. Vào **Credentials → Create credentials → OAuth client ID**, tạo hai client:
   - loại **Web application**, tên `vionx-web`. Không cần nhập redirect URI;
   - loại **Android**, package `vn.vionx.app`. Claude sẽ gửi dấu vân tay SHA-1 sau khi build xong bản cài trên K40.
4. Vào Supabase (project dev) → **Authentication → Sign In / Providers → Google**:
   - bật Google;
   - dán Client ID và Client Secret của client **Web**;
   - bật **Skip nonce check**, vì đăng nhập Google gốc trên Android cần mục này.
5. Gửi Claude **Client ID của client Web**. Client ID không phải bí mật. Không gửi Client Secret.

**Xong khi:** Supabase hiện Google là Enabled và Claude đã có Web Client ID.

## 5. Tài khoản Google Play Console (cho M09)

Kênh thử nghiệm nội bộ (internal testing) cần tài khoản nhà phát triển. Google duyệt danh tính mất vài ngày, nên nên tạo sớm.

1. Vào https://play.google.com/console/signup, chọn tài khoản **Cá nhân** (Personal) và trả phí 25 USD một lần.
2. Xác minh danh tính bằng CCCD và số điện thoại theo hướng dẫn.
3. Khi được duyệt, tạo app tên **VionX**, ngôn ngữ mặc định Tiếng Việt, loại App, Miễn phí.
4. Vào **Testing → Internal testing → Testers**, tạo danh sách gồm email Leo và email các gia đình thử nghiệm.

**Xong khi:** đã thấy app VionX trong Play Console. Claude sẽ tạo bản AAB đã ký và hướng dẫn tải lên lần đầu.

Lưu ý: tài khoản cá nhân tạo sau 11/2023 phải cho ít nhất 12 người thử kín liên tục 14 ngày, rồi mới được phát hành công khai. Kênh internal testing thì không bị giới hạn này.

## 6. Người duyệt cần mời

- **Pháp lý:** nhờ luật sư đọc các văn bản đã soạn ở M02: điều khoản, chính sách quyền riêng tư, đồng ý của phụ huynh (`docs/legal/`).
- **Ngôn ngữ:** nhờ giáo viên Tiếng Việt, Ngữ văn và Tiếng Anh đọc mẫu các thư viện X03–X06 (khoảng 50 câu mỗi thư viện). Kế hoạch yêu cầu bước này trước GATE A.

**Xong khi:** người duyệt gửi ý kiến. Claude sẽ sửa theo ý kiến đó.

## 7. Chuẩn bị cho GATE A

Tìm 2–5 gia đình dùng điện thoại Android, có ít nhất một bé lớp 2 và một bé lớp 6. Thu email Google của phụ huynh để thêm vào danh sách thử nghiệm ở bước 5.

---

## Việc Claude đang làm song song

- Build app Android, cài lên Redmi K40, chạy các luồng kiểm thử M01–M08 trên máy thật.
- Làm M09: chạy offline, thông báo đẩy, vận hành, bản phát hành nội bộ.
- Sửa Tiếng Anh 6 (tỉ lệ đọc to) và Tiếng Anh 2 (50 kỹ năng mới có 1 câu) cho đạt acceptance.
