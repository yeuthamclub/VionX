# Kế hoạch thư viện đợt 1: lớp 2 và lớp 6 (chốt ngày 07/10/2026)

## 1. Tám thư viện, mỗi thư viện 500 câu

Tên môn ghi theo Chương trình GDPT 2018:

| # | Lớp | Môn | Ghi chú theo chương trình |
|---|---|---|---|
| L1 | 6 | **Toán** | Thí điểm đầu tiên (X01) |
| L2 | 2 | **Toán** | Thí điểm cho trẻ nhỏ (X02) |
| L3 | 2 | **Tiếng Việt** | Lớp 1–5 học Tiếng Việt; từ lớp 6 mới là Ngữ văn |
| L4 | 6 | **Ngữ văn** | Đọc hiểu theo thể loại, văn bản mới ngoài SGK |
| L5 | 2 | **Tiếng Anh** | Lớp 1–2 là môn tự chọn; tập trung nghe và nói (Công văn 681/2020) |
| L6 | 6 | **Tiếng Anh** | Bắt buộc |
| L7 | 6 | **Khoa học tự nhiên** | Tích hợp Lý, Hóa, Sinh, Trái Đất và bầu trời |
| L8 | 2 | **Tự nhiên và Xã hội** | Lớp 1–3 chưa có môn "Khoa học"; đây là môn tương đương ở lớp 2 |

Tổng cộng **4.000 câu**. Nguồn sách: **bộ SGK thống nhất cả nước năm học 2026–2027** (PDF đã có trên ổ ngoài của chủ dự án; là ảnh scan, không có text layer). Các bộ sách cũ chỉ ánh xạ thêm nếu cần, với chi phí thấp.

## 2. Thứ tự sản xuất

1. **Phase A** (trước khi alpha): **L1 Toán 6** và **L2 Toán 2**. Như vậy cả trẻ lớp 2 lẫn lớp 6 đều có bài để dùng thử, đồng thời kiểm chứng được giao diện cho trẻ nhỏ.
2. **Ngay sau GATE A**: chạy song song với việc xây Phase B, dùng chung bộ script của X01: L3 Tiếng Việt 2 → L4 Ngữ văn 6 → L6 Tiếng Anh 6 → L5 Tiếng Anh 2 → L7 KHTN 6 → L8 TN&XH 2.
3. Mỗi thư viện chỉ bắt đầu khi thư viện trước đã duyệt xong, để người duyệt không bị dồn việc và để bài học từ thư viện trước được đưa vào prompt cho thư viện sau.

## 3. Cấu hình theo từng môn (subject profile)

| Môn | Câu mẫu có tham số | Nhóm câu theo đoạn văn | Đọc to mặc định | Hình minh họa | Bài viết (chấm bằng AI) |
|---|---|---|---|---|---|
| Toán 2 | ≥50% (cộng trừ trong phạm vi 100/1000, bảng nhân chia 2 và 5, đo lường, xem giờ) | – | Có | Nhiều (đếm hình, đồng hồ, hình học bằng SVG) | – |
| Toán 6 | ≥40% | – | Không | Ít (hình học bằng SVG) | – |
| Tiếng Việt 2 | ~10% (chính tả s/x, ch/tr, d/gi/r theo mẫu) | ~40% (đoạn văn ngắn 80–150 chữ + 3–5 câu) | Có | Vừa (tranh từ vựng) | ~5% (viết 3–5 câu) |
| Ngữ văn 6 | 0 | ~60% (văn bản 200–400 chữ: truyện, thơ, văn bản thông tin, nghị luận) | Không | Ít | ~10% (đoạn văn) |
| Tiếng Anh 2 | ~10% | ~20% (hội thoại ngắn) | Có (tiếng Anh) | Nhiều (chọn tranh) | – |
| Tiếng Anh 6 | ~10% | ~35% (đọc, hội thoại) | Phần nghe | Vừa | ~5% (câu, đoạn ngắn) |
| KHTN 6 | ~25% (đo lường, đổi đơn vị, tính toán đơn giản) | ~15% (tình huống thí nghiệm) | Không | Vừa (sơ đồ SVG) | – |
| TN&XH 2 | 0 | ~15% (tình huống) | Có | Nhiều | – |

Các loại câu dùng chung: chọn 1 đáp án, chọn nhiều, điền số, điền từ (có ngân hàng từ), chọn tranh, sắp xếp thứ tự, nối cặp, đúng/sai. Bài viết chỉ mở khi có M17 (chấm bằng AI); trước đó bị ẩn.

## 4. Lưu ý riêng cho lớp 2
- Mọi đề, đáp án và gợi ý đều được **đọc to bằng giọng tiếng Việt có sẵn trên Android**, nên trẻ chưa đọc thạo vẫn làm được.
- Trẻ trả lời bằng cách chạm vào tranh hoặc nút lớn, hạn chế phải gõ.
- Mỗi phiên học ngắn (khoảng 15 phút), có nhiều phản hồi khích lệ.
- Hình minh họa lấy từ bộ biểu tượng mã nguồn mở (cần kiểm tra giấy phép, ví dụ yêu cầu ghi nguồn) hoặc do Claude vẽ bằng SVG đơn giản (đếm đồ vật, hình học, đồng hồ). Hình cũng phải được duyệt.

## 5. Bản quyền với môn ngôn ngữ
- Không đưa nguyên văn bài đọc trong SGK vào thư viện.
- Ngữ liệu đọc hiểu lấy từ hai nguồn:
  1. Văn bản mới do AI viết theo đúng thể loại và độ khó.
  2. Văn bản thuộc phạm vi công cộng như ca dao, tục ngữ, truyện cổ tích, và tác phẩm của tác giả đã mất quá thời hạn bảo hộ. Cần kiểm tra từng tác phẩm.
- Cách này cũng khớp với định hướng GDPT 2018 là đánh giá bằng **ngữ liệu mới ngoài SGK**.

## 6. Ước tính chi phí và công duyệt (thô, cần đo sau L1)

| Thư viện | Tiền AI | Giờ duyệt |
|---|---|---|
| Toán 2, Toán 6 | ~8–12 USD mỗi môn | ~8 giờ mỗi môn |
| Tiếng Việt 2, Ngữ văn 6, Tiếng Anh 2, Tiếng Anh 6 | ~10–15 USD mỗi môn (thêm chi phí viết đoạn văn) | ~10–12 giờ mỗi môn (phải đọc cả đoạn văn) |
| KHTN 6, TN&XH 2 | ~10–15 USD mỗi môn (thêm hình SVG) | ~9–10 giờ mỗi môn |
| **Tổng 8 thư viện** | **~80–110 USD** | **~75–85 giờ** |

## 7. Bạn cần chuẩn bị
1. PDF nguồn: **đã có** SGK + SGV lớp 2 và lớp 6, SBT lớp 2 (thư mục SBT lớp 6 còn trống), ở `/Volumes/ViTu/VionX/Sach giao khoa`. Script đọc PDF nguồn từ thư mục này hoặc từ Supabase Storage sau khi upload.
2. Văn bản Chương trình GDPT 2018: **đã có** Toán, Ngữ văn (gồm Tiếng Việt lớp 1–5), Tiếng Anh lớp 3–12, Tự nhiên và Xã hội, Khoa học tự nhiên (`/mnt/project-files/sources/gdpt/`). Với Tiếng Anh 2 chưa có văn bản chương trình làm quen lớp 1–2 (mới có Công văn 681/2020 hướng dẫn chung), nên khung kỹ năng dựng từ SGK + SGV Tiếng Anh 2 Global Success, theo định hướng của công văn: tập trung nghe và nói, đánh giá nhẹ nhàng.
3. ~~Chọn bộ SGK~~: đã dùng bộ thống nhất 2026–2027.
4. Người duyệt cho môn ngôn ngữ, lý tưởng là giáo viên hoặc phụ huynh có chuyên môn, vì đây là phần khó kiểm tra tự động nhất.
