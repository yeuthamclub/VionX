# Bắt đầu: VionX bản Android (đã chốt ngày 07/10/2026)

Bản này thay toàn bộ các bản trước (Mac mini, web trên Vercel). Master Spec v1.3 chỉ còn dùng để tra quy tắc sản phẩm.

## Đã chốt
1. **Ứng dụng Android viết bằng Expo** (React Native, TypeScript). Phụ huynh và con dùng chung một app, chọn vai trò khi mở lần đầu.
2. **Web admin nhỏ** (Vite + React) đặt trên Cloudflare Pages, dùng để nhập sách và duyệt câu hỏi.
3. **Backend chỉ dùng Supabase** (Singapore): DB, đăng nhập, file, functions, hàng đợi, cron. GitHub chỉ lưu code để Claude Code làm việc.
4. **Dựng dữ liệu theo phương án B:**
   - Trang có text layer thì lấy chữ trực tiếp, không dùng AI (đúng với PDF số).
   - Haiku 4.5 đọc trang khó. Bộ SGK 2026–2027 hiện có là ảnh scan, không có text layer, nên mọi trang đều đọc bằng Haiku 4.5 (~5 USD cho 1.622 trang SGK của 8 môn, ~10 USD nếu thêm SGV).
   - Sonnet 5.5 sinh câu hỏi.
   - Haiku 4.5 kiểm tra; Opus 5.5 chỉ phân xử các câu bị tranh chấp.
   - Mọi bước chạy qua Batch API.
5. **AI tutor 4 tầng** (sinh sẵn → kho đã duyệt → Haiku → Sonnet), mặc định 5 câu hỏi tự do mỗi ngày.
6. **Chưa dùng embedding.** Tìm kiếm full-text lọc theo kỹ năng.
7. **Thư viện câu hỏi dùng chung**, gắn với kỹ năng GDPT. **Lần đầu sinh 500 câu cho mỗi môn của mỗi lớp**, có câu mẫu có tham số, và tự cải thiện từ dữ liệu làm bài.
8. **Làm trước lớp 2 và lớp 6**, 8 thư viện: Toán 2, Tiếng Việt 2, Tiếng Anh 2, Tự nhiên và Xã hội 2; Toán 6, Ngữ văn 6, Tiếng Anh 6, Khoa học tự nhiên 6. Chi tiết ở `docs/CONTENT_PLAN_vi.md`.

## Tài liệu
| File | Nội dung |
|---|---|
| `CLAUDE.md` | Luật làm việc cho Claude Code |
| `docs/CONTRACT.md` | Quyết định D1–D11, cấu trúc repo, quy ước |
| `docs/ARCHITECTURE.md` | Kiến trúc, thư viện dùng chung, model cho từng tác vụ |
| `docs/ROADMAP.md` | 24 module và 8 lượt dựng thư viện X01–X08, theo thứ tự |
| `docs/CONTENT_PLAN_vi.md` | Kế hoạch 8 thư viện lớp 2 và lớp 6 |
| `TASK_PACKS/*.md` | Phạm vi và tiêu chí nghiệm thu của từng module |
| `docs/COST_OPTIONS_vi.md` | Chi phí AI và hạ tầng |
| `docs/BOOK_PIPELINE_vi.md` | Pipeline quét sách và sinh thư viện |

## Tài khoản cần tạo trước M00
1. **GitHub:** repo private `vionx`; copy thư mục này vào gốc repo.
2. **Supabase:** 2 project ở Singapore (staging, production); lên gói Pro khi bắt đầu alpha.
3. **Anthropic Console:** API key và giới hạn chi tiêu.
4. **Expo (EAS):** tài khoản để build app Android.
5. **Cloudflare:** cho web admin.
6. **Google Play Console:** 25 USD, dùng từ M09 cho bản thử nghiệm nội bộ.
7. **Google Cloud:** OAuth client cho đăng nhập Google (M01).

## Cách giao việc cho Claude Code
Mở Claude Code trên web (claude.ai/code), chọn repo `vionx` và dán:
```
Read CLAUDE.md and docs/CONTRACT.md, then TASK_PACKS/M00.md.
Implement module M00 only, following the working loop. Open a PR and stop.
```
Sau mỗi module:
1. Đọc file `docs/milestones/Mxx_REPORT.md`.
2. Cài bản build lên điện thoại thử.
3. Merge PR, rồi đổi sang mã module tiếp theo.

Module lớn có thể chia thành nhiều phiên; Claude Code sẽ ghi các bước còn lại vào file PLAN.

## Lộ trình
- **Phase A (M00–M09 + X01, X02):** gia đình dùng app Android với thư viện Toán 6 và Toán 2 (mỗi thư viện 500 câu; lớp 2 có đọc to). Kết thúc khi 2–5 gia đình, có cả trẻ lớp 2 và lớp 6, dùng thử qua Google Play nội bộ.
- **Sau GATE A (X03–X08):** lần lượt Tiếng Việt 2 → Ngữ văn 6 → Tiếng Anh 6 → Tiếng Anh 2 → KHTN 6 → TN&XH 2, chạy song song với Phase B.
- **Phase B (M10–M15):** nhập sách trên web admin, sinh thư viện cho môn mới, AI tutor tầng T1–T3.
- **Phase C (M16–M21):** đọc sách, kỹ năng ngôn ngữ (chấm bài viết tiếng Việt và tiếng Anh bằng AI, giọng nói trên máy), Health Connect, arena, cuộc thi, phân tích điểm mạnh.
- **Phase D (M22–M23):** chuẩn bị production và phát hành trên Google Play.

## Việc chỉ bạn làm được
- Nguồn đã có sẵn, không cần chọn bộ sách: PDF SGK + SGV lớp 2 và lớp 6, SBT lớp 2 (thư mục SBT lớp 6 còn trống) trên ổ ngoài `/Volumes/ViTu/VionX/Sach giao khoa`; văn bản Chương trình GDPT 2018 ở `/mnt/project-files/sources/gdpt/`. Script đọc PDF nguồn từ thư mục này hoặc từ Supabase Storage sau khi upload. Riêng Tiếng Anh 2 chưa có văn bản chương trình, khung kỹ năng dựng từ SGK + SGV Global Success 2 theo Công văn 681/2020.
- Duyệt `plan.csv` và `review.csv` (khoảng 75–85 giờ cho cả 8 thư viện).
- Tìm người duyệt cho môn ngôn ngữ (giáo viên hoặc phụ huynh có chuyên môn).
- Liên hệ nhà xuất bản về bản quyền; tra cứu nhãn hiệu VionX.
- Tìm tư vấn pháp lý về dữ liệu trẻ em và việc lưu dữ liệu ở Singapore.
- Chọn nhà cung cấp SMS OTP gửi được số Việt Nam (trước M22).
