# Chính sách quyền riêng tư của VionX

> **BẢN NHÁP (DRAFT), phiên bản 1.** Văn bản này chưa được luật sư rà soát và chưa có hiệu lực pháp lý. Cần rà soát theo pháp luật Việt Nam về bảo vệ dữ liệu cá nhân (bao gồm việc đánh giá tác động chuyển dữ liệu ra nước ngoài) trước khi phát hành chính thức. Các mục trong ngoặc vuông do chủ sản phẩm điền.

Cập nhật lần cuối: [ngày phát hành]

## 1. Chúng tôi là ai

VionX là ứng dụng hỗ trợ học tập và sinh hoạt cho học sinh từ lớp 1 đến lớp 12 và gia đình. Ứng dụng có hai chế độ: chế độ Phụ huynh và chế độ Con. Đơn vị chịu trách nhiệm xử lý dữ liệu là [tên pháp nhân], địa chỉ [địa chỉ], email liên hệ về quyền riêng tư: [email].

Tài khoản VionX do phụ huynh hoặc người giám hộ tạo. Con không cần số điện thoại, email hay tài khoản Google để sử dụng VionX.

## 2. Dữ liệu chúng tôi thu thập

**Về phụ huynh:** số điện thoại hoặc địa chỉ email dùng để đăng nhập (qua mã OTP hoặc Google), tên hiển thị, tên gia đình, múi giờ, các lựa chọn đồng ý và các phiên bản chính sách bạn đã chấp nhận.

**Về con:** tên gọi, năm sinh, lớp, hình đại diện chọn sẵn (không có ảnh thật), mã đăng nhập dạng `vx-…`, mã PIN (chỉ lưu dưới dạng mã băm, chúng tôi không đọc được PIN), thông tin phiên đăng nhập trên thiết bị, và dữ liệu học tập phát sinh khi con dùng ứng dụng (bài làm, tiến độ, nhiệm vụ, điểm thưởng).

**Dữ liệu kỹ thuật:** mã thiết bị ngẫu nhiên do ứng dụng tạo, nhật ký lỗi và nhật ký truy cập phục vụ an toàn hệ thống.

Chúng tôi **không** thu thập vị trí chính xác của con, **không** tải lên ảnh hoặc video từ camera, và **không** tải lên giọng nói của con.

## 3. Mục đích sử dụng và các lựa chọn đồng ý

Mỗi loại xử lý dữ liệu của con chỉ diễn ra khi phụ huynh đã đồng ý cho riêng loại đó. Phụ huynh có thể xem và rút lại từng sự đồng ý bất kỳ lúc nào trong mục **Quyền riêng tư** của ứng dụng; việc rút lại có hiệu lực ngay.

| Loại đồng ý | Nội dung |
|---|---|
| Dịch vụ cốt lõi (`CORE_SERVICE`) | Tạo hồ sơ và tài khoản đăng nhập cho con, lưu bài làm và tiến độ để ứng dụng hoạt động. Bắt buộc: không có sự đồng ý này, con không thể đăng nhập. |
| Phân tích học tập (`EDUCATION_ANALYTICS`) | Thống kê việc học của con để gợi ý và báo cáo cho phụ huynh. |
| Cá nhân hoá bằng AI (`AI_PERSONALIZATION`) | Gửi nội dung câu hỏi và tình trạng kỹ năng của con (không kèm tên) tới dịch vụ AI để giải thích, gợi ý và nhận xét bài viết. |
| Micro cho luyện nói (`MICROPHONE_SPEAKING`) | Dùng micro trong các bài luyện nói hoặc đọc do con chủ động bắt đầu. Âm thanh được xử lý ngay trên điện thoại và không được tải lên. |
| Hoạt động thể chất qua Health Connect (`HEALTH_CONNECT_ACTIVITY`) | Đọc số bước và thời gian vận động từ Health Connect. Không đọc nhịp tim, không đọc lộ trình GPS. |
| Khu vực cuộc thi (`COMPETITION_AREA`) | Dùng tỉnh, thành phố hoặc quận, huyện do phụ huynh chọn để gợi ý cuộc thi phù hợp. |

**Sự đồng ý của con:** với con từ 7 tuổi trở lên, ngoài sự đồng ý của phụ huynh, các tính năng AI, micro và Health Connect chỉ được bật khi con cũng đồng ý trên màn hình dành cho con. Con có thể từ chối.

Khi chính sách này thay đổi theo cách cần phụ huynh đồng ý lại, các tính năng liên quan sẽ tạm dừng cho đến khi phụ huynh xác nhận phiên bản mới.

## 4. Nơi lưu trữ dữ liệu và chuyển dữ liệu ra nước ngoài

Dữ liệu của gia đình được lưu trên hạ tầng **Supabase** tại khu vực **Singapore** (máy chủ của Amazon Web Services, vùng ap-southeast-1). Việc lưu trữ này là chuyển dữ liệu cá nhân ra nước ngoài; khi đồng ý với chính sách này, phụ huynh đồng ý với việc chuyển dữ liệu đó. Kết nối luôn được mã hoá.

Khi phụ huynh bật **Cá nhân hoá bằng AI**, nội dung cần xử lý được gửi tới **Anthropic** (nhà cung cấp mô hình AI Claude, Hoa Kỳ) qua giao diện lập trình của Anthropic. Chúng tôi chỉ gửi một mã định danh ẩn danh, khối lớp và tình trạng kỹ năng, không gửi tên, số điện thoại hay mã đăng nhập của con. Theo điều khoản thương mại hiện hành của Anthropic, dữ liệu gửi qua giao diện lập trình không được dùng để huấn luyện mô hình và chỉ được lưu giữ trong thời gian giới hạn [cần xác nhận khi rà soát].

Nội dung học tập dùng chung (câu hỏi, bài đọc) được tạo với sự hỗ trợ của AI và do người kiểm duyệt; kho nội dung này không chứa dữ liệu cá nhân.

## 5. Chia sẻ dữ liệu

Chúng tôi không bán dữ liệu cá nhân và không dùng dữ liệu của con cho quảng cáo. Dữ liệu chỉ được chia sẻ với các bên xử lý giúp chúng tôi vận hành dịch vụ: Supabase (lưu trữ, xác thực), Anthropic (AI, chỉ khi đã đồng ý), Google (đăng nhập bằng Google, nếu phụ huynh chọn), nhà cung cấp tin nhắn SMS gửi mã OTP, và dịch vụ theo dõi lỗi ứng dụng. Chúng tôi cũng có thể cung cấp dữ liệu khi cơ quan nhà nước có thẩm quyền yêu cầu theo quy định pháp luật.

## 6. Thời gian lưu trữ

Dữ liệu được lưu trong thời gian gia đình sử dụng VionX. Khi phụ huynh yêu cầu xoá:

- tài khoản hoặc hồ sơ của con bị **khoá ngay lập tức**;
- sau **30 ngày**, dữ liệu bị **xoá vĩnh viễn**;
- các sổ ghi điểm thưởng và giao dịch được **ẩn danh hoá** thay vì xoá, để số liệu tổng hợp vẫn đúng nhưng không còn liên kết được với con hay gia đình;
- hồ sơ ghi nhận rằng yêu cầu đã được thực hiện (chỉ gồm mã định danh, không có tên) được giữ lại để chứng minh việc tuân thủ.

Tệp xuất dữ liệu chỉ tải được trong **24 giờ** rồi bị xoá.

## 7. Quyền của phụ huynh và của con

Trong mục **Quyền riêng tư** của ứng dụng, phụ huynh có thể:

- xem và rút lại từng sự đồng ý của mỗi con, kèm lịch sử thay đổi;
- xem các phiên bản chính sách đã chấp nhận;
- **xuất dữ liệu** của cả gia đình thành tệp ZIP (định dạng JSON), nhận đường dẫn tải trong 24 giờ;
- **xoá hồ sơ của một con**;
- **xoá tài khoản và toàn bộ dữ liệu gia đình**. Việc này cũng làm được trên trang web [địa chỉ trang xoá tài khoản] mà không cần cài ứng dụng.

Phụ huynh cũng có thể liên hệ [email] để yêu cầu chỉnh sửa dữ liệu, hạn chế xử lý hoặc khiếu nại. Chúng tôi phản hồi trong thời hạn pháp luật quy định.

## 8. Bảo mật

Mã PIN chỉ được lưu dưới dạng mã băm; phiên đăng nhập của con dùng mã ngẫu nhiên và có thể bị phụ huynh thu hồi; số lần nhập PIN sai bị giới hạn. Ứng dụng không truy cập trực tiếp vào cơ sở dữ liệu, mọi yêu cầu đều đi qua máy chủ của chúng tôi và chỉ thấy dữ liệu của chính gia đình. Mọi lần quản trị viên truy cập dữ liệu của con đều được ghi nhật ký.

## 9. Trẻ em

VionX được thiết kế cho học sinh. Con chỉ dùng VionX qua tài khoản do phụ huynh tạo và quản lý. Ứng dụng không có tính năng nhắn tin công khai giữa các con.

## 10. Thay đổi chính sách

Mỗi lần thay đổi, chúng tôi tạo một phiên bản mới và thông báo trong ứng dụng. Nếu thay đổi ảnh hưởng tới các lựa chọn đồng ý, chúng tôi sẽ hỏi lại phụ huynh trước khi tiếp tục xử lý dữ liệu liên quan.
