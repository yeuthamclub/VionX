# Pipeline quét sách → thư viện học liệu dùng chung

Áp dụng cho X01–X08 (bản gọn, chạy bằng script) và M10–M15 (bản đầy đủ, có giao diện admin). Toàn bộ chạy trên **Supabase (hàng đợi + cron) + Claude Batch API**. Phần xử lý file nặng làm ngay trên **trình duyệt của admin**, nên không cần máy chủ riêng hay GitHub Actions.

## 1. Nguyên tắc
1. **Pipeline có các stage rõ ràng.** Code điều phối; Claude chỉ được gọi ở 4 chỗ: đọc trang khó, dựng mục lục/ánh xạ kỹ năng, sinh câu hỏi, kiểm tra câu hỏi.
2. **Trang nào lấy được chữ thì không dùng AI.** Text layer tốt thì lấy chữ trực tiếp, chi phí 0. Điều này đúng với PDF số; bộ SGK 2026–2027 hiện có là ảnh scan nên mọi trang đi tuyến AI.
3. **Xương sống kỹ năng lấy từ "yêu cầu cần đạt" GDPT 2018.** Sách chỉ được ánh xạ vào đó.
4. **Thư viện dùng chung:** câu hỏi gắn với kỹ năng, không gắn với sách hay người dùng; sinh một lần, ai cũng dùng.
5. **Cache theo hash, chạy lại được từ giữa chừng.** Không bao giờ trả tiền hai lần cho cùng một việc.
6. **Batch API cho mọi bước AI** (rẻ hơn 50%). Riêng tutor là chạy realtime.
7. **Người sửa một lần, máy nhớ mãi.** Sửa tay được lưu riêng và áp lại sau mỗi lần chạy.
8. **Có golden set để đo** trước khi đổi model hay đổi prompt.

## 2. Luồng xử lý

```
Admin web (trình duyệt)                       Supabase
─────────────────────────                     ──────────────────────────────
Chọn PDF + nhập metadata
pdf.js: lấy text layer từng trang,
  render ảnh xem trước,
  chấm chất lượng (dấu tiếng Việt,
  font TCVN3/VNI, ký hiệu toán)
pdf-lib: cắt các trang "cần AI"
  thành file 10 trang
Upload lên Storage ─────────────────────────► tạo ingest_run
                                               hàng đợi pgmq "ingest"
                                               worker chạy từng stage:
                                                 TEXT_PAGES (không AI)
                                                 AI_PAGES → gửi Claude Batch
                                               cron 10 phút: batch xong?
                                                 → ghi kết quả → stage kế
Admin xem tiến độ, sửa, duyệt ◄────────────── VALIDATE / RETRY / ASSEMBLE
```

## 3. Lưu trữ theo tầng (schema `library`, không có dữ liệu cá nhân)

| Tầng | Bảng | Ghi chú |
|---|---|---|
| Nguồn | `source_files`, `book_editions`, `book_versions` | sha256, phạm vi bản quyền |
| Trang | `source_pages` | text layer, điểm chất lượng, tuyến TEXT/AI |
| Khối | `source_blocks` | loại khối, chữ, LaTeX, bảng, số trang |
| Sửa tay | `human_corrections` | áp lại sau mỗi lần chạy |
| Cấu trúc | `book_structure_nodes`, `source_exercises` | bài tập gốc chỉ dùng làm mẫu |
| Kỹ năng | `curriculum_nodes`, `knowledge_edges`, `content_mappings` | xương sống GDPT |
| Tìm kiếm | `content_chunks` (+ tsvector) | full-text lọc theo kỹ năng |
| **Thư viện** | `items`, `item_templates`, `item_stats`, `item_reports`, `tutor_answers` | dùng chung cho mọi người dùng |
| Vận hành | `ingest_runs`, `ingest_tasks`, `stage_cache`, `ops.ai_runs` | trạng thái, chi phí |

## 4. Đọc trang

**Trang có text layer tốt** (lưu ý: bộ PDF SGK 2026–2027 Leo có là ảnh scan, không có text layer, nên mọi trang đi tuyến AI): chuẩn hóa Unicode, nối dòng, bỏ header/footer lặp lại, rồi tách khối theo quy tắc ("Bài", "Ví dụ", "Bài tập", "Định nghĩa"...). Không dùng AI.

**Trang khó** gồm trang scan, trang nhiều công thức, trang có bảng và trang dùng font cũ. Các trang này gửi Haiku 4.5 qua Batch, mỗi request là một file PDF 10 trang, kèm schema đầu ra có cấu trúc: loại khối, chữ, LaTeX, bảng dạng Markdown, đúng số trang.

**Kiểm tra bắt buộc** sau khi đọc:
1. Đủ trang, không trùng trang.
2. LaTeX phải parse được bằng KaTeX.
3. Tỉ lệ từ tiếng Việt hợp lệ đạt ngưỡng.
4. Trang có một phần text layer: chữ Claude trả về phải đủ giống text layer, để bắt lỗi bịa nội dung.

Trang không đạt được đọc lại riêng bằng Sonnet 5.5. Vẫn lỗi thì đưa vào hàng chờ người duyệt.

## 5. Kỹ năng và ánh xạ
- Xương sống kỹ năng dựng một lần cho mỗi môn-lớp từ văn bản chương trình GDPT (Sonnet 5.5).
- Mục lục: gom bookmark, các tiêu đề kèm số trang và trang mục lục vào **một** request. Code kiểm tra khoảng trang liên tục, tăng dần và phủ hết sách.
- Ánh xạ bài học → kỹ năng: dùng Batch, xương sống được cache trong system prompt. Bộ sách thứ hai và thứ ba chủ yếu khớp vào kỹ năng có sẵn, gần như không phát sinh thêm chi phí.
- Mỗi loại sách có vai trò riêng: SGV cho mục tiêu và lỗi thường gặp, SGK cho định nghĩa và ví dụ, SBT cho dạng bài và độ khó (chỉ làm mẫu).

## 6. Sinh thư viện 500 câu cho mỗi môn-lớp

**Phân bổ:**
1. Mỗi kỹ năng có ít nhất 2 câu: 1 câu mức nhận biết/thông hiểu và 1 câu mức vận dụng trở lên.
2. Phần còn lại chia theo trọng số kỹ năng.
3. Tỉ lệ câu mẫu có tham số, nhóm câu theo đoạn văn, bài viết, đọc to và hình minh họa lấy theo **cấu hình từng môn** (`subject_profiles`, mặc định ở `CONTENT_PLAN_vi.md` §3). Ví dụ Toán 6 ≥40% câu mẫu, Toán 2 ≥50%, Ngữ văn 6 ~60% câu theo đoạn văn.

**Môn ngôn ngữ và lớp nhỏ cần thêm:**
- **Ngữ liệu đọc hiểu** (Sonnet 5.5, Batch): văn bản mới đúng thể loại và độ dài, hoặc văn bản thuộc phạm vi công cộng có ghi nguồn. Không chép bài đọc trong SGK.
- **Hình minh họa**: SVG đơn giản do Claude vẽ (đếm đồ vật, đồng hồ, hình học, sơ đồ) hoặc biểu tượng có giấy phép; người duyệt xem cả hình.
- **Câu mẫu theo danh sách từ**: chính tả s/x, ch/tr, d/gi/r; từ vựng tiếng Anh.
- **Đọc to**: mỗi đề, đáp án, gợi ý có `tts_text` để Android đọc bằng giọng tiếng Việt hoặc tiếng Anh.

**Mỗi câu gồm:** đề, đáp án, lời giải mẫu, **4 bậc gợi ý**, **phản hồi riêng cho từng đáp án sai** (gắn với lỗi thường gặp) và nguồn tham chiếu. Đây chính là tầng T0 của tutor, nên lúc chạy không tốn tiền.

**Câu mẫu có tham số**, ví dụ:
```
Đề:        "Tính {a}/{b} + {c}/{d}"
Tham số:   a,c ∈ [1..9], b,d ∈ [2..12], b ≠ d
Điều kiện: kết quả chưa tối giản ít nhất một lần
Đáp án:    a/b + c/d (math.js, rút gọn)
Đáp án nhiễu: (a+c)/(b+d)  ← lỗi "cộng tử với tử, mẫu với mẫu"
```
Ứng dụng tạo biến thể từ `(template, seed)` ngay trên điện thoại, kể cả khi offline. Seed được lưu lại để chấm đúng câu.

**Kiểm tra trước khi tới tay người duyệt:**
1. Code kiểm: schema đúng, chỉ một đáp án đúng, math.js tính lại, thử 1.000 seed với câu mẫu, KaTeX, độ dài câu và đoạn văn theo lớp, có `tts_text` khi cần đọc to, SVG hiển thị được, không chép nguyên văn sách, không trùng câu đã có.
2. Haiku 4.5 giải "mù" rồi so với đáp án và đánh giá gợi ý.
3. Nếu hai bên bất đồng thì Opus 5.5 phân xử.
4. Đạt hết thì được duyệt hàng loạt; còn lại vào hàng chờ duyệt.

**Duy trì thư viện:**
- Thống kê mỗi đêm: độ khó thật, tỉ lệ đúng, số báo lỗi. Câu bất thường quay lại hàng chờ duyệt.
- Bổ sung hằng tuần cho kỹ năng sắp hết câu chưa làm, có trần ngân sách.
- Chương trình thay đổi thì chỉ sinh lại câu của các kỹ năng bị ảnh hưởng.

## 7. Làm ngay cho alpha (X01, X02), rồi X03–X08
1. Nguồn đã có: PDF SGK + SGV Toán 6 và Toán 2 (bộ thống nhất 2026–2027; Toán 2 có thêm SBT) và văn bản chương trình GDPT 2018 môn Toán (`/mnt/project-files/sources/gdpt/`). Script đọc PDF nguồn từ thư mục trên ổ ngoài hoặc từ Supabase Storage sau khi upload.
2. Claude Code chạy script theo các bước: `textlayer` → `backbone` → `map` → `edges` → `plan` (bạn duyệt `plan.csv`) → `passages` và `media` (khi môn cần) → `generate` → `check` → `verify` → `review-export`.
3. Bạn duyệt `review.csv` trên Google Sheets (khoảng 8–12 giờ cho 500 câu), sau đó chạy `review-import` → `package`.
4. M05 import gói thư viện.
5. Sau GATE A, dùng cùng bộ script cho 6 thư viện còn lại theo thứ tự trong `CONTENT_PLAN_vi.md`; môn ngôn ngữ cần người duyệt có chuyên môn.

Các gói X01–X08 cũng là golden set để đánh giá pipeline đầy đủ ở Phase B.

## 8. Bản quyền
- Gắn phạm vi bản quyền cho từng file ngay khi nhập. Không commit PDF vào GitHub.
- Văn bản SGK chỉ dùng nội bộ để tham chiếu. Câu hỏi phát cho học sinh phải là nội dung mới và qua kiểm tra chống chép nguyên văn.
- Tutor chỉ trích dẫn ngắn kèm số trang.
- Nên làm việc với nhà xuất bản về giấy phép trước khi thương mại hóa.

## 9. Sai lầm nên tránh
- Đưa mọi trang qua AI, kể cả trang đã có text layer tốt.
- Gửi cả quyển sách trong một request.
- Tin ngay đầu ra của model mà không so với text layer và không parse lại LaTeX.
- Để model tự tạo cây kỹ năng riêng cho từng quyển sách.
- Để cùng một model vừa sinh vừa tự duyệt câu hỏi.
- Mở rộng sang môn mới trước khi môn đang làm đạt chất lượng.
