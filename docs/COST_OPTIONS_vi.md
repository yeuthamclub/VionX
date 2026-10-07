# Chi phí AI và hạ tầng VionX (bản đã chốt 07/10/2026)

Giá model Claude (USD cho 1 triệu token, input / output):

| Model | Giá thường | Qua Batch API (−50%) |
|---|---|---|
| Claude Opus 5.5 (`claude-opus-5-5`) | 4 / 20 | 2 / 10 |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | 2 / 10 | 1 / 5 |
| Claude Haiku 4.5 (`claude-haiku-4-5`) | 1 / 5 | 0,5 / 2,5 |

Khi dùng prompt caching, phần đầu prompt lặp lại chỉ tốn khoảng 1/10 giá input lúc đọc lại từ cache.
Mọi con số dưới đây là **ước lượng thô**. Trước khi chạy cả bộ, cần đo trên 1 chủ đề.

## 1. Dựng thư viện: 500 câu cho mỗi môn của mỗi lớp (phương án B)

| Bước | Model | Ghi chú | Chi phí/môn-lớp |
|---|---|---|---|
| Đọc trang có text layer tốt | không dùng AI | ~60–70% số trang với PDF số; bộ SGK 2026–2027 là scan nên không có trang nào | 0 |
| Đọc trang khó (scan, công thức, bảng, font cũ) | Haiku 4.5, Batch | trang lỗi gửi lại bằng Sonnet 5.5 | ~1–2 USD |
| Dựng xương sống kỹ năng, mục lục, ánh xạ | Sonnet 5.5, Batch | làm một lần cho mỗi bộ sách | ~1–2 USD |
| Sinh 500 câu (kèm 4 gợi ý, lời giải, phản hồi cho từng đáp án sai) | Sonnet 5.5, Batch | ≥40% là câu mẫu có tham số cho môn tự nhiên | ~5–6 USD |
| Kiểm tra | Haiku 4.5, Batch + kiểm bằng code | | ~1 USD |
| Ca tranh chấp (≤5%) | Opus 5.5, Batch | | <1 USD |
| **Tổng** | | | **~8–12 USD** |

Thời gian duyệt của người khoảng 8–10 giờ cho mỗi môn-lớp (500 câu × ~1 phút).

### Đợt 1: lớp 2 và lớp 6, 8 thư viện (xem `CONTENT_PLAN_vi.md`)
| Thư viện | Tiền AI | Giờ duyệt |
|---|---|---|
| Toán 2, Toán 6 | ~8–12 USD mỗi môn | ~8 giờ mỗi môn |
| Tiếng Việt 2, Ngữ văn 6, Tiếng Anh 2, Tiếng Anh 6 | ~10–15 USD mỗi môn (thêm đoạn văn) | ~10–12 giờ mỗi môn |
| KHTN 6, TN&XH 2 | ~10–15 USD mỗi môn (thêm hình SVG) | ~9–10 giờ mỗi môn |
| **Tổng** | **~80–110 USD** | **~75–85 giờ** |

Đọc to bằng giọng có sẵn trên Android nên không tốn thêm tiền cho lớp 2.

**Cập nhật sau khi xem bộ sách thật (07/10/2026):** bộ PDF SGK 2026–2027 là ảnh scan, **không có text layer**, nên mọi trang phải đọc bằng Haiku 4.5 (Batch). 8 môn có 1.622 trang SGK và 1.730 trang SGV; với khoảng 0,003 USD/trang, đọc hết tốn **~5 USD (SGK) hoặc ~10 USD (cả SGV)**. Tổng chi phí đợt 1 gần như không đổi.

Quy mô toàn bộ lớp 1–12: khoảng 100 môn-lớp × ~10 USD ≈ **1.000 USD tiền AI** và khoảng **900 giờ duyệt**. Giờ duyệt mới là chi phí chính, nên triển khai lần lượt từng môn, ưu tiên môn có nhiều người dùng nhất.

### Thư viện dùng chung giúp chi phí không tăng theo số người dùng
- Câu hỏi gắn với kỹ năng GDPT nên học sinh nào cùng lớp cũng dùng được, kể cả khi sau này ánh xạ thêm bộ sách khác.
- Câu mẫu có tham số (chủ yếu môn Toán, Lý, Hóa): code tự sinh vô số biến thể số, không tốn tiền AI, trẻ ít gặp lại câu cũ.
- Bổ sung hằng tuần chỉ cho kỹ năng sắp hết câu chưa làm, và có trần ngân sách.
- Dữ liệu làm bài thật tự hiệu chỉnh độ khó; câu có vấn đề tự quay về hàng chờ duyệt.

## 2. AI Tutor xếp tầng

| Tầng | Cách làm | Chi phí lúc chạy |
|---|---|---|
| T0 | Gợi ý 4 bậc, lời giải, phản hồi cho từng đáp án sai, đều sinh sẵn trong thư viện | 0 |
| T1 | Kho hỏi-đáp đã duyệt của cùng kỹ năng, tự lớn dần theo số người dùng | ~0 |
| T2 | Haiku 4.5, có prompt caching, trả lời ngắn và có trích nguồn | ~0,002–0,003 USD/lượt |
| T3 | Sonnet 5.5, dưới 10% số lượt | ~0,006 USD/lượt |
| Hạn mức | 5 câu hỏi tự do mỗi ngày (mặc định, chỉnh được theo gói) | |

Ước tính khoảng **0,15–0,30 USD mỗi trẻ mỗi tháng**, và con số này giảm dần khi kho T1 lớn lên.

## 3. Các khoản AI khác
- Tiếng Anh nghe và nói: dùng giọng nói có sẵn trên Android, chi phí 0. Chấm bài viết dùng Haiku 4.5 (Sonnet 5.5 cho lớp 10–12) và tính vào hạn mức.
- Báo cáo tuần cho phụ huynh: Haiku 4.5 qua Batch, chưa tới 0,01 USD mỗi trẻ mỗi tuần.

## 4. Hạ tầng hằng tháng (alpha)

| Hạng mục | Chi phí |
|---|---|
| Supabase Pro (DB, đăng nhập, file, functions, cron, hàng đợi) | ~25 USD/tháng |
| Cloudflare Pages (web admin) | 0 |
| Expo EAS (build, cập nhật OTA) | gói miễn phí cho alpha; có thể build local |
| Thông báo đẩy (FCM) | 0 |
| Google Play Developer | 25 USD, trả một lần |
| SMS OTP Việt Nam | theo nhà cung cấp, chọn ở M22 |

Giá cần kiểm tra lại lúc đăng ký. Giới hạn chi tiêu đặt ở Anthropic Console và ở `ai_task_config` (M22).
