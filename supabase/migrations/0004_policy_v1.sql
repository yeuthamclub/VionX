-- VionX M02 — version 1 (DRAFT) of the privacy policy and terms, vi + en.
-- Content is copied verbatim from docs/legal/*.md (a unit test keeps them in sync). Later versions
-- are new rows in new migrations; policy_versions is append-only.
insert into app.policy_versions (type, version, locale, title, content_md, effective_at, requires_reconsent) values
  ('PRIVACY_POLICY', 1, 'vi', 'Chính sách quyền riêng tư', $policy$# Chính sách quyền riêng tư của VionX

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
$policy$,
   '2026-10-08T00:00:00Z', false),
  ('PRIVACY_POLICY', 1, 'en', 'Privacy Policy', $policy$# VionX Privacy Policy

> **DRAFT, version 1.** Not yet reviewed by a lawyer and not legally in force. It must be reviewed under Vietnamese personal-data protection law (including the cross-border transfer impact assessment) before release. Items in square brackets are filled in by the product owner. The Vietnamese version prevails.

Last updated: [release date]

## 1. Who we are

VionX is a study and family organiser for Grade 1-12 students and their families. The app has a Parent mode and a Child mode. The data controller is [legal entity], [address]; privacy contact: [email].

VionX accounts are created by a parent or guardian. A child needs no phone number, email or Google account to use VionX.

## 2. Data we collect

**Parents:** the phone number or email used to sign in (OTP or Google), display name, household name, time zone, consent choices and the policy versions you accepted.

**Children:** display name, birth year, grade, a preset avatar (no real photos), a `vx-…` login id, a PIN (stored only as a hash; we cannot read it), device session information, and learning data created while using the app (answers, progress, tasks, rewards).

**Technical data:** a random device id created by the app, error logs and access logs for security.

We do **not** collect a child's precise location, do **not** upload camera images or video, and do **not** upload a child's voice.

## 3. Purposes and consent choices

Each kind of processing of a child's data happens only after the parent has consented to that kind specifically. Parents can review and withdraw each consent at any time under **Privacy** in the app; withdrawal takes effect immediately.

| Consent | What it covers |
|---|---|
| Core service (`CORE_SERVICE`) | Creating the child's profile and login, storing answers and progress so the app works. Required: without it the child cannot sign in. |
| Learning analytics (`EDUCATION_ANALYTICS`) | Statistics about the child's learning for suggestions and parent reports. |
| AI personalisation (`AI_PERSONALIZATION`) | Sending the question content and the child's skill state (without the name) to an AI service for explanations, hints and writing feedback. |
| Microphone for speaking practice (`MICROPHONE_SPEAKING`) | Using the microphone in speaking or reading exercises the child starts. Audio is processed on the phone and never uploaded. |
| Activity via Health Connect (`HEALTH_CONNECT_ACTIVITY`) | Reading steps and active minutes from Health Connect. No heart rate, no GPS routes. |
| Competition area (`COMPETITION_AREA`) | Using the province, city or district chosen by the parent to suggest suitable competitions. |

**Child assent:** for children aged 7 or older, AI, microphone and Health Connect features are switched on only when the child also agrees on a child-facing screen, in addition to the parent's consent. The child may decline.

When this policy changes in a way that needs renewed consent, the affected features pause until the parent confirms the new version.

## 4. Where data is stored and cross-border transfers

Family data is stored on **Supabase** infrastructure in **Singapore** (Amazon Web Services region ap-southeast-1). This is a transfer of personal data outside Vietnam; by accepting this policy the parent consents to that transfer. Connections are always encrypted.

When a parent turns on **AI personalisation**, the content to be processed is sent to **Anthropic** (provider of the Claude AI models, United States) through Anthropic's API. We send only a pseudonymous id, the grade and the skill state, never the child's name, phone number or login id. Under Anthropic's current commercial terms, API data is not used to train models and is retained only for a limited period [to be confirmed in review].

Shared learning content (questions, passages) is created with AI assistance and reviewed by people; that library contains no personal data.

## 5. Sharing

We do not sell personal data and do not use children's data for advertising. Data is shared only with processors that help us run the service: Supabase (storage, authentication), Anthropic (AI, only with consent), Google (Google sign-in, if the parent uses it), the SMS provider that sends OTP codes, and an app error-monitoring service. We may disclose data to competent authorities when the law requires it.

## 6. Retention

Data is kept while the family uses VionX. When a parent asks for deletion:

- the account or child profile is **disabled immediately**;
- after **30 days** the data is **permanently deleted**;
- reward and transaction ledgers are **anonymised** instead of deleted, so totals stay correct but can no longer be linked to the child or family;
- a record that the request was fulfilled (ids only, no names) is kept as proof of compliance.

Data export files can be downloaded for **24 hours** and are then deleted.

## 7. Rights of parents and children

Under **Privacy** in the app, a parent can:

- review and withdraw each consent for each child, with its history;
- see the policy versions they accepted;
- **export** the whole household's data as a ZIP file (JSON) with a download link valid for 24 hours;
- **delete a child's profile**;
- **delete the account and all household data**. This can also be done on the web page [account deletion URL] without installing the app.

Parents can also contact [email] to correct data, restrict processing or complain. We answer within the time limits set by law.

## 8. Security

PINs are stored only as hashes; child sessions use random tokens that parents can revoke; wrong PIN attempts are limited. The app never accesses the database directly: every request goes through our server and sees only the family's own data. Every admin access to a child's data is logged.

## 9. Children

VionX is designed for students. Children use VionX only through an account created and managed by a parent. The app has no public messaging between children.

## 10. Changes

Every change creates a new version, announced in the app. If a change affects consent choices, we ask the parent again before continuing the affected processing.
$policy$,
   '2026-10-08T00:00:00Z', false),
  ('TERMS_OF_SERVICE', 1, 'vi', 'Điều khoản sử dụng', $policy$# Điều khoản sử dụng VionX

> **BẢN NHÁP (DRAFT), phiên bản 1.** Văn bản này chưa được luật sư rà soát và chưa có hiệu lực pháp lý. Các mục trong ngoặc vuông do chủ sản phẩm điền.

Cập nhật lần cuối: [ngày phát hành]

## 1. Chấp nhận điều khoản

Khi tạo tài khoản VionX, bạn xác nhận mình là cha, mẹ hoặc người giám hộ hợp pháp của các con được thêm vào gia đình, đã đủ 18 tuổi, và đồng ý với Điều khoản sử dụng này cùng Chính sách quyền riêng tư.

## 2. Tài khoản

- Phụ huynh đăng nhập bằng số điện thoại (mã OTP) hoặc tài khoản Google và chịu trách nhiệm về mọi hoạt động trong tài khoản gia đình.
- Mỗi con có một mã đăng nhập và mã PIN do phụ huynh quản lý. Hãy giữ PIN cẩn thận; phụ huynh có thể đặt lại PIN, đăng xuất con trên mọi thiết bị hoặc tạm khoá tài khoản của con bất kỳ lúc nào.
- Con chỉ đăng nhập được sau khi phụ huynh đồng ý với dịch vụ cốt lõi cho con.

## 3. Sử dụng đúng mục đích

Bạn không được dùng VionX để vi phạm pháp luật, xâm phạm quyền của người khác, phá hoại hệ thống, dò tìm mã PIN hoặc truy cập dữ liệu của gia đình khác.

## 4. Nội dung học tập và AI

Nội dung học tập bám theo chương trình giáo dục phổ thông 2018 và được tạo với sự hỗ trợ của AI, sau đó được kiểm tra tự động và kiểm duyệt. Dù vậy, nội dung có thể còn sai sót; VionX hỗ trợ việc học chứ không thay thế giáo viên và sách giáo khoa. Nếu thấy nội dung sai, vui lòng báo cho chúng tôi trong ứng dụng hoặc qua [email].

Các gợi ý và nhận xét do AI tạo chỉ có khi phụ huynh bật tính năng Cá nhân hoá bằng AI (và con từ 7 tuổi trở lên cũng đồng ý).

## 5. Điểm thưởng

Điểm kinh nghiệm (XP) và xu trong VionX chỉ có giá trị trong ứng dụng, không quy đổi thành tiền. Phần thưởng thực tế do phụ huynh tự đặt và tự chịu trách nhiệm thực hiện.

## 6. Phí dịch vụ

Trong giai đoạn thử nghiệm, VionX được cung cấp miễn phí. Nếu sau này có gói trả phí, chúng tôi sẽ thông báo trước và không tự động thu phí khi bạn chưa đồng ý.

## 7. Chấm dứt và xoá tài khoản

Bạn có thể xoá tài khoản bất kỳ lúc nào trong ứng dụng (mục Quyền riêng tư) hoặc tại [địa chỉ trang xoá tài khoản]. Tài khoản bị khoá ngay và dữ liệu bị xoá vĩnh viễn sau 30 ngày như mô tả trong Chính sách quyền riêng tư. Chúng tôi có thể tạm ngừng tài khoản vi phạm Điều khoản này sau khi thông báo cho bạn, trừ trường hợp cần ngăn chặn ngay một hành vi gây hại.

## 8. Giới hạn trách nhiệm

Chúng tôi cố gắng để dịch vụ hoạt động ổn định nhưng không cam kết dịch vụ luôn liên tục hoặc không có lỗi. Trong phạm vi pháp luật cho phép, chúng tôi không chịu trách nhiệm về thiệt hại gián tiếp phát sinh từ việc sử dụng ứng dụng.

## 9. Luật áp dụng

Điều khoản này được điều chỉnh bởi pháp luật Việt Nam. Tranh chấp được ưu tiên giải quyết bằng thương lượng; nếu không thành, sẽ do toà án có thẩm quyền tại Việt Nam giải quyết.

## 10. Liên hệ

[tên pháp nhân], [địa chỉ], [email].
$policy$,
   '2026-10-08T00:00:00Z', false),
  ('TERMS_OF_SERVICE', 1, 'en', 'Terms of Service', $policy$# VionX Terms of Service

> **DRAFT, version 1.** Not yet reviewed by a lawyer and not legally in force. Items in square brackets are filled in by the product owner. The Vietnamese version prevails.

Last updated: [release date]

## 1. Acceptance

By creating a VionX account you confirm that you are the parent or legal guardian of the children you add to your household, that you are at least 18, and that you accept these Terms and the Privacy Policy.

## 2. Accounts

- Parents sign in with a phone number (OTP) or a Google account and are responsible for all activity in the household account.
- Each child has a login id and a PIN managed by the parent. Keep the PIN safe; a parent can reset it, sign the child out on every device or turn the child's login off at any time.
- A child can sign in only after the parent has consented to the core service for that child.

## 3. Acceptable use

You may not use VionX to break the law, infringe others' rights, disrupt the system, guess PINs or access another household's data.

## 4. Learning content and AI

Learning content follows the 2018 general education programme and is created with AI assistance, then checked automatically and reviewed. It may still contain mistakes; VionX supports learning and does not replace teachers or textbooks. Please report mistakes in the app or at [email].

AI-generated hints and feedback appear only when the parent turns on AI personalisation (and, for children aged 7 or older, the child also agrees).

## 5. Rewards

XP and coins in VionX have value only inside the app and cannot be exchanged for money. Real-world rewards are set and fulfilled by the parent.

## 6. Fees

During the trial period VionX is free. If paid plans are introduced we will announce them in advance and never charge without your agreement.

## 7. Termination and account deletion

You can delete your account at any time in the app (Privacy) or at [account deletion URL]. The account is disabled immediately and the data is permanently deleted after 30 days as described in the Privacy Policy. We may suspend an account that breaches these Terms after notifying you, unless immediate action is needed to stop harm.

## 8. Limitation of liability

We aim to keep the service running reliably but do not promise it will always be available or error-free. To the extent permitted by law, we are not liable for indirect damage arising from use of the app.

## 9. Governing law

These Terms are governed by Vietnamese law. Disputes are first settled by negotiation, otherwise by a competent court in Vietnam.

## 10. Contact

[legal entity], [address], [email].
$policy$,
   '2026-10-08T00:00:00Z', false);
