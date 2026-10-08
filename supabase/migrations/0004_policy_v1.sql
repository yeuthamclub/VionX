-- VionX M02 — version 1 (DRAFT) of the privacy policy and terms, vi + en.
-- Content is copied verbatim from docs/legal/*.md (a unit test keeps them in sync). Later versions
-- are new rows in new migrations; policy_versions is append-only.
insert into app.policy_versions (type, version, locale, title, content_md, effective_at, requires_reconsent) values
  ('PRIVACY_POLICY', 1, 'vi', 'Chính sách quyền riêng tư', $policy$# Chính sách quyền riêng tư của VionX

> **BẢN NHÁP (DRAFT), phiên bản 1.** Văn bản này chưa được luật sư rà soát và chưa có hiệu lực pháp lý. Cần rà soát theo pháp luật Việt Nam về bảo vệ dữ liệu cá nhân (bao gồm việc đánh giá tác động chuyển dữ liệu ra nước ngoài) trước khi phát hành chính thức. Các mục trong ngoặc vuông do chủ sản phẩm điền.

Cập nhật lần cuối: [ngày phát hành]

## 1. Chúng tôi là ai

VionX là ứng dụng hỗ trợ học tập và sinh hoạt cho học sinh từ lớp 1 đến lớp 12 và gia đình. Ứng dụng có hai chế độ: chế độ Phụ huynh và chế độ Con. Đơn vị chịu trách nhiệm xử lý dữ liệu là [tên pháp nhân], mã số doanh nghiệp [mã số], địa chỉ [địa chỉ], email liên hệ về quyền riêng tư: [email], điện thoại: [số điện thoại].

Người phụ trách bảo vệ dữ liệu cá nhân của VionX: [họ tên hoặc chức danh], email [email], điện thoại [số điện thoại].

Tài khoản VionX do cha, mẹ hoặc người giám hộ (người đại diện theo pháp luật của con) tạo. Con không cần số điện thoại, email hay tài khoản Google để sử dụng VionX.

## 2. Dữ liệu chúng tôi thu thập

**Về phụ huynh:** số điện thoại hoặc địa chỉ email dùng để đăng nhập (qua mã OTP hoặc Google), tên hiển thị, tên gia đình, múi giờ, các lựa chọn đồng ý và các phiên bản chính sách bạn đã chấp nhận.

**Về con:** tên gọi, năm sinh, lớp, hình đại diện chọn sẵn (không có ảnh thật), mã đăng nhập dạng `vx-…`, mã PIN (chỉ lưu dưới dạng mã băm, chúng tôi không đọc được PIN), thông tin phiên đăng nhập trên thiết bị, và dữ liệu học tập phát sinh khi con dùng ứng dụng (bài làm, tiến độ, nhiệm vụ, điểm thưởng).

**Dữ liệu kỹ thuật:** mã thiết bị ngẫu nhiên do ứng dụng tạo, nhật ký lỗi và nhật ký truy cập phục vụ an toàn hệ thống.

Chúng tôi **không** thu thập vị trí chính xác của con, **không** tải lên ảnh hoặc video từ camera, và **không** tải lên giọng nói của con.

## 3. Mục đích sử dụng và các lựa chọn đồng ý

Mỗi loại xử lý dữ liệu của con chỉ diễn ra khi phụ huynh đã đồng ý cho riêng loại đó. Không có lựa chọn nào được bật sẵn, và việc chấp nhận chính sách này không thay cho bất kỳ sự đồng ý nào dưới đây. Phụ huynh có thể xem và rút lại từng sự đồng ý bất kỳ lúc nào trong mục **Quyền riêng tư** của ứng dụng; việc rút lại có hiệu lực ngay. Phụ huynh có thể xem bản ghi từng lần đồng ý, gồm thời điểm, nội dung và phiên bản chính sách, và tải các bản ghi này cùng bản xuất dữ liệu.

| Loại đồng ý | Nội dung |
|---|---|
| Dịch vụ cốt lõi (`CORE_SERVICE`) | Tạo hồ sơ và tài khoản đăng nhập cho con, lưu bài làm và tiến độ để ứng dụng hoạt động. Bắt buộc: không có sự đồng ý này, con không thể đăng nhập. |
| Chuyển dữ liệu ra nước ngoài (`CROSS_BORDER_TRANSFER`) | Lưu dữ liệu của con trên máy chủ ở nước ngoài và chuyển cho các bên nhận ở nước ngoài nêu tại mục 4. Được hỏi riêng, ngay sau Dịch vụ cốt lõi. Bắt buộc để con đăng nhập: dịch vụ không thể chạy nếu không lưu trữ tại Singapore. Phụ huynh có thể từ chối; khi đó chúng tôi không thể tạo tài khoản cho con. |
| Phân tích học tập (`EDUCATION_ANALYTICS`) | Thống kê việc học của con để gợi ý và báo cáo cho phụ huynh. |
| Cá nhân hoá bằng AI (`AI_PERSONALIZATION`) | Gửi nội dung câu hỏi và tình trạng kỹ năng của con (không kèm tên) tới dịch vụ AI tại Hoa Kỳ để giải thích, gợi ý và nhận xét bài viết. Chỉ bật được khi phụ huynh đã đồng ý Chuyển dữ liệu ra nước ngoài. |
| Micro cho luyện nói (`MICROPHONE_SPEAKING`) | Dùng micro trong các bài luyện nói hoặc đọc do con chủ động bắt đầu. Âm thanh được xử lý ngay trên điện thoại và không được tải lên. |
| Hoạt động thể chất qua Health Connect (`HEALTH_CONNECT_ACTIVITY`) | Đọc số bước và thời gian vận động từ Health Connect. Không đọc nhịp tim, không đọc lộ trình GPS. |
| Khu vực cuộc thi (`COMPETITION_AREA`) | Dùng tỉnh, thành phố hoặc quận, huyện do phụ huynh chọn để gợi ý cuộc thi phù hợp. |

**Sự đồng ý của con:** với con từ 7 tuổi trở lên, ngoài sự đồng ý của phụ huynh, các tính năng AI, micro và Health Connect chỉ được bật khi con cũng đồng ý trên màn hình dành cho con. Con có thể từ chối.

**Dữ liệu cá nhân nhạy cảm:** theo Nghị định 356/2025/NĐ-CP, các dữ liệu sau có thể là dữ liệu cá nhân nhạy cảm: (a) số bước và thời gian vận động đọc từ Health Connect; (b) dữ liệu về hoạt động học tập và cách con sử dụng ứng dụng dùng cho phân tích học tập. Chúng tôi chỉ xử lý các dữ liệu này khi phụ huynh (và con, nếu con từ 7 tuổi đối với Health Connect) đã đồng ý riêng cho từng loại ở bảng trên, và áp dụng biện pháp bảo vệ tăng cường. Dữ liệu vận động không được chia sẻ cho bất kỳ công ty bảo hiểm, cơ sở y tế hay bên quảng cáo nào và không được gửi tới dịch vụ AI.

**Nội dung do AI tạo:** AI chỉ đưa ra giải thích, gợi ý và nhận xét. AI không tự động quyết định điểm số, xếp loại hay quyền sử dụng dịch vụ của con. Mọi nội dung do AI tạo đều được ghi rõ là do AI tạo trong ứng dụng. Phụ huynh có thể hỏi chúng tôi vì sao AI đưa ra một gợi ý qua [email].

Khi chính sách này thay đổi theo cách cần phụ huynh đồng ý lại, các tính năng liên quan sẽ tạm dừng cho đến khi phụ huynh xác nhận phiên bản mới.

## 4. Nơi lưu trữ dữ liệu và chuyển dữ liệu ra nước ngoài

Dữ liệu của gia đình được lưu trên hạ tầng **Supabase** tại khu vực **Singapore** (máy chủ của Amazon Web Services, vùng ap-southeast-1). Việc lưu trữ ở nước ngoài và việc gửi dữ liệu cho các bên nhận dưới đây là chuyển dữ liệu cá nhân ra nước ngoài. Chúng tôi chỉ chuyển dữ liệu của con khi phụ huynh đã đồng ý riêng cho việc này (`CROSS_BORDER_TRANSFER`, xem mục 3); việc chấp nhận chính sách này không được coi là sự đồng ý đó.

| Bên nhận | Vai trò, mục đích | Dữ liệu | Nơi lưu trữ, quốc gia của bên nhận | Biện pháp bảo vệ |
|---|---|---|---|---|
| Supabase Inc. | Lưu trữ, xác thực, chạy máy chủ của VionX | Toàn bộ dữ liệu tài khoản và học tập | Máy chủ tại Singapore (AWS ap-southeast-1); công ty tại [quốc gia, cần xác nhận theo hợp đồng xử lý dữ liệu] | Hợp đồng xử lý dữ liệu; mã hoá khi truyền và khi lưu trữ |
| Anthropic PBC | Mô hình AI Claude, chỉ khi phụ huynh bật Cá nhân hoá bằng AI | Nội dung câu hỏi, khối lớp, tình trạng kỹ năng, một mã định danh bí danh; không có tên, số điện thoại hay mã đăng nhập | Hoa Kỳ | Hợp đồng xử lý dữ liệu; mã hoá khi truyền; không dùng để huấn luyện mô hình |
| Google LLC | Đăng nhập bằng Google, nếu phụ huynh chọn | Địa chỉ email và mã tài khoản Google của phụ huynh | Hoa Kỳ [cần xác nhận] | Điều khoản dịch vụ của Google; mã hoá khi truyền |
| [Tên nhà cung cấp SMS] | Gửi mã OTP đăng nhập qua tin nhắn | Số điện thoại của phụ huynh, nội dung mã OTP | [quốc gia] | Hợp đồng xử lý dữ liệu; mã hoá khi truyền |
| Functional Software, Inc. (Sentry) | Theo dõi lỗi ứng dụng | Nhật ký lỗi kỹ thuật, mã thiết bị ngẫu nhiên; không gửi tên hay nội dung bài làm | [quốc gia, cần xác nhận theo vùng lưu trữ đã chọn] | Hợp đồng xử lý dữ liệu; mã hoá khi truyền và khi lưu trữ |

Theo điều khoản thương mại hiện hành của Anthropic, dữ liệu gửi qua giao diện lập trình không được dùng để huấn luyện mô hình và được xoá sau tối đa [N] ngày, trừ khi cần giữ lâu hơn để điều tra vi phạm chính sách sử dụng [cần xác nhận theo hợp đồng xử lý dữ liệu ký ngày ...].

Dữ liệu được mã hoá khi truyền và khi lưu trữ. Mỗi bên xử lý chỉ được dùng dữ liệu theo chỉ dẫn của chúng tôi, theo hợp đồng xử lý dữ liệu bằng văn bản có điều khoản bảo mật, thông báo sự cố và xoá dữ liệu khi kết thúc. Chúng tôi lập hồ sơ đánh giá tác động chuyển dữ liệu ra nước ngoài và gửi cơ quan chuyên trách bảo vệ dữ liệu cá nhân thuộc Bộ Công an theo quy định.

Nội dung học tập dùng chung (câu hỏi, bài đọc) được tạo với sự hỗ trợ của AI và do người kiểm duyệt; kho nội dung này không chứa dữ liệu cá nhân.

## 5. Chia sẻ dữ liệu

Chúng tôi không bán dữ liệu cá nhân và không dùng dữ liệu của con cho quảng cáo. Dữ liệu chỉ được chia sẻ với các bên xử lý giúp chúng tôi vận hành dịch vụ, liệt kê đầy đủ ở bảng tại mục 4. Chúng tôi cũng có thể cung cấp dữ liệu khi cơ quan nhà nước có thẩm quyền yêu cầu theo quy định pháp luật.

## 6. Thời gian lưu trữ

Dữ liệu được lưu trong thời gian gia đình sử dụng VionX. Khi phụ huynh yêu cầu xoá:

- tài khoản hoặc hồ sơ của con bị **khoá ngay lập tức**;
- trong 14 ngày này, phụ huynh có thể hủy yêu cầu bằng nút **Hủy yêu cầu xóa** trong mục **Quyền riêng tư** của ứng dụng; tài khoản hoặc hồ sơ của con được mở lại;
- sau **14 ngày**, dữ liệu bị **xoá vĩnh viễn** và không thể khôi phục, chậm nhất 20 ngày kể từ ngày yêu cầu;
- các sổ ghi điểm thưởng và giao dịch được **ẩn danh hoá** thay vì xoá (mã định danh được thay bằng mã ngẫu nhiên không thể đối chiếu lại), để số liệu tổng hợp vẫn đúng nhưng không còn liên kết được với con hay gia đình;
- hồ sơ ghi nhận rằng yêu cầu đã được thực hiện (chỉ gồm mã định danh, không có tên) được giữ lại để chứng minh việc tuân thủ;
- nhật ký kiểm tra và nhật ký sự kiện hệ thống liên quan được giữ thêm **1 năm** sau khi xoá, chỉ gồm mã định danh đã được **bí danh hoá** (không có tên, số điện thoại, email hay dữ liệu cá nhân khác), rồi bị xoá. Dữ liệu bí danh hoá vẫn là dữ liệu cá nhân và được bảo vệ như vậy.

Tệp xuất dữ liệu chỉ tải được trong **24 giờ** rồi bị xoá.

## 7. Quyền của phụ huynh và của con

Phụ huynh, với tư cách người đại diện theo pháp luật của con, có quyền được biết về việc xử lý dữ liệu; đồng ý hoặc không đồng ý, rút lại sự đồng ý; xem, truy cập và chỉnh sửa dữ liệu; xoá dữ liệu; hạn chế xử lý; phản đối việc xử lý; yêu cầu cung cấp dữ liệu; khiếu nại, khởi kiện và yêu cầu bồi thường; và yêu cầu áp dụng biện pháp bảo vệ dữ liệu.

Trong mục **Quyền riêng tư** của ứng dụng, phụ huynh có thể:

- xem và rút lại từng sự đồng ý của mỗi con, kèm lịch sử thay đổi;
- xem các phiên bản chính sách đã chấp nhận;
- **xuất dữ liệu** của cả gia đình thành tệp ZIP (định dạng JSON), nhận đường dẫn tải trong 24 giờ;
- **xoá hồ sơ của một con**;
- **xoá tài khoản và toàn bộ dữ liệu gia đình**. Việc này cũng làm được trên trang web [địa chỉ trang xoá tài khoản] mà không cần cài ứng dụng.

Con có thể nhờ cha, mẹ thực hiện các quyền này; con từ 7 tuổi có thể từ chối sự đồng ý của mình cho AI, micro và Health Connect ngay trong ứng dụng.

Phụ huynh cũng có thể liên hệ [email] hoặc người phụ trách bảo vệ dữ liệu cá nhân (mục 1) để yêu cầu chỉnh sửa dữ liệu, hạn chế xử lý, phản đối việc xử lý hoặc khiếu nại. Chúng tôi xác nhận đã nhận yêu cầu trong **02 ngày làm việc**, và hoàn thành:

- rút lại sự đồng ý, hạn chế hoặc phản đối xử lý: trong tối đa **15 ngày** (trong ứng dụng, việc rút lại có hiệu lực ngay);
- cung cấp, chỉnh sửa dữ liệu: trong tối đa **10 ngày**;
- xoá dữ liệu: trong tối đa **20 ngày**.

Nếu cần gia hạn, chúng tôi sẽ báo lý do trước khi hết hạn.

Phụ huynh có quyền khiếu nại tới cơ quan chuyên trách bảo vệ dữ liệu cá nhân thuộc Bộ Công an.

## 8. Bảo mật

Mã PIN chỉ được lưu dưới dạng mã băm; phiên đăng nhập của con dùng mã ngẫu nhiên và có thể bị phụ huynh thu hồi; số lần nhập PIN sai bị giới hạn. Ứng dụng không truy cập trực tiếp vào cơ sở dữ liệu, mọi yêu cầu đều đi qua máy chủ của chúng tôi và chỉ thấy dữ liệu của chính gia đình. Mọi lần quản trị viên truy cập dữ liệu của con đều được ghi nhật ký.

**Thông báo khi có sự cố:** khi phát hiện sự cố làm lộ, mất dữ liệu cá nhân có thể gây hại, chúng tôi thông báo cho cơ quan chuyên trách bảo vệ dữ liệu cá nhân thuộc Bộ Công an chậm nhất **72 giờ** sau khi phát hiện, và thông báo cho phụ huynh bị ảnh hưởng qua ứng dụng và [email/SMS] kèm hướng dẫn tự bảo vệ.

## 9. Trẻ em

VionX được thiết kế cho học sinh. Con chỉ dùng VionX qua tài khoản do phụ huynh tạo và quản lý. Ứng dụng không có tính năng nhắn tin công khai giữa các con.

## 10. Thay đổi chính sách

Mỗi lần thay đổi, chúng tôi tạo một phiên bản mới và thông báo trong ứng dụng. Nếu thay đổi ảnh hưởng tới các lựa chọn đồng ý, chúng tôi sẽ hỏi lại phụ huynh trước khi tiếp tục xử lý dữ liệu liên quan.

Nếu bản tiếng Việt và bản tiếng Anh của chính sách này khác nhau, áp dụng bản có lợi hơn cho bạn.
$policy$,
   '2026-10-08T00:00:00Z', false),
  ('PRIVACY_POLICY', 1, 'en', 'Privacy Policy', $policy$# VionX Privacy Policy

> **DRAFT, version 1.** Not yet reviewed by a lawyer and not legally in force. It must be reviewed under Vietnamese personal-data protection law (including the cross-border transfer impact assessment) before release. Items in square brackets are filled in by the product owner. If the Vietnamese and English versions differ, the version more favourable to you applies.

Last updated: [release date]

## 1. Who we are

VionX is a study and family organiser for Grade 1-12 students and their families. The app has a Parent mode and a Child mode. The data controller is [legal entity], enterprise code [code], [address]; privacy contact: [email], phone: [phone number].

VionX's personal data protection officer: [name or title], email [email], phone [phone number].

VionX accounts are created by a parent or guardian (the child's legal representative). A child needs no phone number, email or Google account to use VionX.

## 2. Data we collect

**Parents:** the phone number or email used to sign in (OTP or Google), display name, household name, time zone, consent choices and the policy versions you accepted.

**Children:** display name, birth year, grade, a preset avatar (no real photos), a `vx-…` login id, a PIN (stored only as a hash; we cannot read it), device session information, and learning data created while using the app (answers, progress, tasks, rewards).

**Technical data:** a random device id created by the app, error logs and access logs for security.

We do **not** collect a child's precise location, do **not** upload camera images or video, and do **not** upload a child's voice.

## 3. Purposes and consent choices

Each kind of processing of a child's data happens only after the parent has consented to that kind specifically. No choice is pre-selected, and accepting this policy does not replace any of the consents below. Parents can review and withdraw each consent at any time under **Privacy** in the app; withdrawal takes effect immediately. Parents can see the record of every consent, with its time, content and policy version, and download these records with the data export.

| Consent | What it covers |
|---|---|
| Core service (`CORE_SERVICE`) | Creating the child's profile and login, storing answers and progress so the app works. Required: without it the child cannot sign in. |
| Transfer of data abroad (`CROSS_BORDER_TRANSFER`) | Storing the child's data on servers abroad and sending it to the recipients abroad listed in section 4. Asked separately, right after the core service. Required for the child to sign in: the service cannot run without storage in Singapore. The parent may decline; we then cannot create the child's account. |
| Learning analytics (`EDUCATION_ANALYTICS`) | Statistics about the child's learning for suggestions and parent reports. |
| AI personalisation (`AI_PERSONALIZATION`) | Sending the question content and the child's skill state (without the name) to an AI service in the United States for explanations, hints and writing feedback. Can be turned on only after the parent has consented to the transfer of data abroad. |
| Microphone for speaking practice (`MICROPHONE_SPEAKING`) | Using the microphone in speaking or reading exercises the child starts. Audio is processed on the phone and never uploaded. |
| Activity via Health Connect (`HEALTH_CONNECT_ACTIVITY`) | Reading steps and active minutes from Health Connect. No heart rate, no GPS routes. |
| Competition area (`COMPETITION_AREA`) | Using the province, city or district chosen by the parent to suggest suitable competitions. |

**Child assent:** for children aged 7 or older, AI, microphone and Health Connect features are switched on only when the child also agrees on a child-facing screen, in addition to the parent's consent. The child may decline.

**Sensitive personal data:** under Decree 356/2025/ND-CP, the following may be sensitive personal data: (a) steps and active minutes read from Health Connect; (b) data about the child's learning activity and use of the app used for learning analytics. We process this data only when the parent (and, for Health Connect, the child if aged 7 or older) has consented separately to each of these types in the table above, and we apply enhanced protection. Activity data is never shared with any insurer, healthcare provider or advertiser and is never sent to the AI service.

**AI-generated content:** AI only gives explanations, hints and feedback. It does not automatically decide the child's scores, rankings or access to the service. All AI-generated content is clearly labelled as AI-generated in the app. Parents can ask us at [email] why the AI gave a suggestion.

When this policy changes in a way that needs renewed consent, the affected features pause until the parent confirms the new version.

## 4. Where data is stored and cross-border transfers

Family data is stored on **Supabase** infrastructure in **Singapore** (Amazon Web Services region ap-southeast-1). Storage abroad and sending data to the recipients below are transfers of personal data outside Vietnam. We transfer a child's data only after the parent has consented to this separately (`CROSS_BORDER_TRANSFER`, see section 3); accepting this policy is not treated as that consent.

| Recipient | Role and purpose | Data | Storage location, recipient's country | Safeguards |
|---|---|---|---|---|
| Supabase Inc. | Storage, authentication, running VionX's servers | All account and learning data | Servers in Singapore (AWS ap-southeast-1); company in [country, to be confirmed under the data processing agreement] | Data processing agreement; encryption in transit and at rest |
| Anthropic PBC | Claude AI models, only when the parent turns on AI personalisation | Question content, grade, skill state, a pseudonymous id; no name, phone number or login id | United States | Data processing agreement; encryption in transit; not used to train models |
| Google LLC | Google sign-in, if the parent uses it | The parent's email address and Google account id | United States [to be confirmed] | Google's terms of service; encryption in transit |
| [SMS provider name] | Sending sign-in OTP codes by text message | The parent's phone number, the OTP code | [country] | Data processing agreement; encryption in transit |
| Functional Software, Inc. (Sentry) | App error monitoring | Technical error logs, the random device id; no names or answers | [country, to be confirmed for the chosen data region] | Data processing agreement; encryption in transit and at rest |

Under Anthropic's current commercial terms, API data is not used to train models and is deleted after at most [N] days, unless kept longer to investigate usage-policy violations [to be confirmed against the data processing agreement dated ...].

Data is encrypted in transit and at rest. Each processor may use data only on our instructions, under a written data processing agreement with confidentiality, incident notification and deletion at the end of the service. We prepare the cross-border transfer impact assessment and file it with the personal data protection authority of the Ministry of Public Security as required by law.

Shared learning content (questions, passages) is created with AI assistance and reviewed by people; that library contains no personal data.

## 5. Sharing

We do not sell personal data and do not use children's data for advertising. Data is shared only with the processors that help us run the service, all listed in the table in section 4. We may disclose data to competent authorities when the law requires it.

## 6. Retention

Data is kept while the family uses VionX. When a parent asks for deletion:

- the account or child profile is **disabled immediately**;
- during these 14 days the parent can cancel the request with **Cancel deletion request** in the app's **Privacy** section, which re-enables the account or child profile;
- after **14 days** the data is **permanently deleted** and cannot be recovered, no later than 20 days after the request;
- reward and transaction ledgers are **anonymised** instead of deleted (ids are replaced by random ids that cannot be linked back), so totals stay correct but can no longer be linked to the child or family;
- a record that the request was fulfilled (ids only, no names) is kept as proof of compliance;
- related audit logs and system event logs are kept for **1 year** after the deletion, holding only pseudonymous ids (no names, phone numbers, email addresses or other personal data), and are then deleted. Pseudonymised data is still personal data and is protected as such.

Data export files can be downloaded for **24 hours** and are then deleted.

## 7. Rights of parents and children

As the child's legal representative, a parent has the right to be informed about processing; to consent or refuse, and to withdraw consent; to view, access and correct data; to delete data; to restrict processing; to object to processing; to receive the data; to complain, sue and claim compensation; and to ask for data protection measures.

Under **Privacy** in the app, a parent can:

- review and withdraw each consent for each child, with its history;
- see the policy versions they accepted;
- **export** the whole household's data as a ZIP file (JSON) with a download link valid for 24 hours;
- **delete a child's profile**;
- **delete the account and all household data**. This can also be done on the web page [account deletion URL] without installing the app.

A child can ask a parent to use these rights; a child aged 7 or older can decline their own agreement for AI, microphone and Health Connect in the app.

Parents can also contact [email] or the data protection officer (section 1) to correct data, restrict processing, object to processing or complain. We confirm receipt within **2 working days** and complete:

- withdrawal of consent, restriction or objection: within **15 days** at most (in the app, withdrawal takes effect immediately);
- providing or correcting data: within **10 days** at most;
- deleting data: within **20 days** at most.

If we need an extension, we tell you the reason before the deadline.

Parents have the right to complain to the personal data protection authority of the Ministry of Public Security.

## 8. Security

PINs are stored only as hashes; child sessions use random tokens that parents can revoke; wrong PIN attempts are limited. The app never accesses the database directly: every request goes through our server and sees only the family's own data. Every admin access to a child's data is logged.

**Incident notification:** if we discover an incident in which personal data is disclosed or lost in a way that may cause harm, we notify the personal data protection authority of the Ministry of Public Security within **72 hours** of discovery, and notify the affected parents in the app and by [email/SMS] with guidance on protecting themselves.

## 9. Children

VionX is designed for students. Children use VionX only through an account created and managed by a parent. The app has no public messaging between children.

## 10. Changes

Every change creates a new version, announced in the app. If a change affects consent choices, we ask the parent again before continuing the affected processing.
$policy$,
   '2026-10-08T00:00:00Z', false),
  ('TERMS_OF_SERVICE', 1, 'vi', 'Điều khoản sử dụng', $policy$# Điều khoản sử dụng VionX

> **BẢN NHÁP (DRAFT), phiên bản 1.** Văn bản này chưa được luật sư rà soát và chưa có hiệu lực pháp lý. Các mục trong ngoặc vuông do chủ sản phẩm điền. Nếu bản tiếng Việt và bản tiếng Anh khác nhau, áp dụng bản có lợi hơn cho bạn.

Cập nhật lần cuối: [ngày phát hành]

## 1. Chấp nhận điều khoản

Khi tạo tài khoản VionX, bạn xác nhận mình là cha, mẹ hoặc người giám hộ hợp pháp của các con được thêm vào gia đình, đã đủ 18 tuổi, và đồng ý với Điều khoản sử dụng này cùng Chính sách quyền riêng tư. Việc đồng ý với các văn bản này không thay cho các lựa chọn đồng ý riêng về dữ liệu của con được mô tả trong Chính sách quyền riêng tư.

## 2. Tài khoản

- Phụ huynh đăng nhập bằng số điện thoại (mã OTP) hoặc tài khoản Google và chịu trách nhiệm về mọi hoạt động trong tài khoản gia đình.
- Mỗi con có một mã đăng nhập và mã PIN do phụ huynh quản lý. Hãy giữ PIN cẩn thận; phụ huynh có thể đặt lại PIN, đăng xuất con trên mọi thiết bị hoặc tạm khoá tài khoản của con bất kỳ lúc nào.
- Con chỉ đăng nhập được sau khi phụ huynh đồng ý với dịch vụ cốt lõi và, trong một bước riêng, đồng ý cho chuyển dữ liệu của con ra nước ngoài.

## 3. Sử dụng đúng mục đích

Bạn không được dùng VionX để vi phạm pháp luật, xâm phạm quyền của người khác, phá hoại hệ thống, dò tìm mã PIN hoặc truy cập dữ liệu của gia đình khác.

## 4. Nội dung học tập và AI

Nội dung học tập bám theo chương trình giáo dục phổ thông 2018 và được tạo với sự hỗ trợ của AI, sau đó được kiểm tra tự động và kiểm duyệt. Dù vậy, nội dung có thể còn sai sót; VionX hỗ trợ việc học chứ không thay thế giáo viên và sách giáo khoa. Nếu thấy nội dung sai, vui lòng báo cho chúng tôi trong ứng dụng hoặc qua [email].

Các gợi ý và nhận xét do AI tạo chỉ có khi phụ huynh bật tính năng Cá nhân hoá bằng AI (và con từ 7 tuổi trở lên cũng đồng ý). Mọi giải thích, gợi ý và nhận xét do AI tạo ra đều được đánh dấu "AI" trong ứng dụng.

## 5. Điểm thưởng

Điểm kinh nghiệm (XP) và xu trong VionX chỉ có giá trị trong ứng dụng, không quy đổi thành tiền. Phần thưởng thực tế do phụ huynh tự đặt và tự chịu trách nhiệm thực hiện.

## 6. Phí dịch vụ

Trong giai đoạn thử nghiệm, VionX được cung cấp miễn phí. Nếu sau này có gói trả phí, chúng tôi sẽ thông báo trước và không tự động thu phí khi bạn chưa đồng ý.

## 7. Chấm dứt và xoá tài khoản

Bạn có thể xoá tài khoản bất kỳ lúc nào trong ứng dụng (mục Quyền riêng tư) hoặc tại [địa chỉ trang xoá tài khoản]. Tài khoản bị khoá ngay và dữ liệu bị xoá vĩnh viễn sau 14 ngày như mô tả trong Chính sách quyền riêng tư. Chúng tôi có thể tạm ngừng tài khoản vi phạm Điều khoản này sau khi thông báo cho bạn, trừ trường hợp cần ngăn chặn ngay một hành vi gây hại.

## 8. Trách nhiệm

Chúng tôi cố gắng để dịch vụ hoạt động ổn định và sẽ khắc phục lỗi trong thời gian sớm nhất. Chúng tôi chịu trách nhiệm theo quy định của pháp luật, bao gồm pháp luật về bảo vệ quyền lợi người tiêu dùng và bảo vệ dữ liệu cá nhân. Không điều khoản nào trong văn bản này loại trừ hoặc hạn chế trách nhiệm mà pháp luật bắt buộc chúng tôi phải chịu.

## 9. Bảo vệ thông tin

Chúng tôi bảo vệ thông tin của bạn và của con theo Chính sách quyền riêng tư và chỉ thu thập, sử dụng thông tin đó trong phạm vi bạn đã đồng ý, trừ trường hợp pháp luật có quy định khác.

## 10. Thay đổi Điều khoản

Khi thay đổi Điều khoản này, chúng tôi thông báo trong ứng dụng ít nhất [15] ngày trước khi thay đổi có hiệu lực. Nếu không đồng ý với nội dung mới, bạn có thể ngừng sử dụng dịch vụ và xoá tài khoản mà không mất bất kỳ chi phí nào.

## 11. Luật áp dụng và giải quyết tranh chấp

Điều khoản này được điều chỉnh bởi pháp luật Việt Nam. Tranh chấp được ưu tiên giải quyết bằng thương lượng. Nếu không thành, bạn có quyền yêu cầu tổ chức xã hội tham gia bảo vệ quyền lợi người tiêu dùng hỗ trợ, khiếu nại đến cơ quan quản lý nhà nước về bảo vệ quyền lợi người tiêu dùng, hoặc khởi kiện tại toà án có thẩm quyền tại Việt Nam.

## 12. Liên hệ

[tên pháp nhân], mã số doanh nghiệp [mã số], [địa chỉ], [email], [số điện thoại].
$policy$,
   '2026-10-08T00:00:00Z', false),
  ('TERMS_OF_SERVICE', 1, 'en', 'Terms of Service', $policy$# VionX Terms of Service

> **DRAFT, version 1.** Not yet reviewed by a lawyer and not legally in force. Items in square brackets are filled in by the product owner. If the Vietnamese and English versions differ, the version more favourable to you applies.

Last updated: [release date]

## 1. Acceptance

By creating a VionX account you confirm that you are the parent or legal guardian of the children you add to your household, that you are at least 18, and that you accept these Terms and the Privacy Policy. Accepting these documents does not replace the separate consents about your child's data described in the Privacy Policy.

## 2. Accounts

- Parents sign in with a phone number (OTP) or a Google account and are responsible for all activity in the household account.
- Each child has a login id and a PIN managed by the parent. Keep the PIN safe; a parent can reset it, sign the child out on every device or turn the child's login off at any time.
- A child can sign in only after the parent has consented to the core service and, in a separate step, to the transfer of the child's data abroad.

## 3. Acceptable use

You may not use VionX to break the law, infringe others' rights, disrupt the system, guess PINs or access another household's data.

## 4. Learning content and AI

Learning content follows the 2018 general education programme and is created with AI assistance, then checked automatically and reviewed. It may still contain mistakes; VionX supports learning and does not replace teachers or textbooks. Please report mistakes in the app or at [email].

AI-generated hints and feedback appear only when the parent turns on AI personalisation (and, for children aged 7 or older, the child also agrees). All AI-generated explanations, hints and feedback are labelled "AI" in the app.

## 5. Rewards

XP and coins in VionX have value only inside the app and cannot be exchanged for money. Real-world rewards are set and fulfilled by the parent.

## 6. Fees

During the trial period VionX is free. If paid plans are introduced we will announce them in advance and never charge without your agreement.

## 7. Termination and account deletion

You can delete your account at any time in the app (Privacy) or at [account deletion URL]. The account is disabled immediately and the data is permanently deleted after 14 days as described in the Privacy Policy. We may suspend an account that breaches these Terms after notifying you, unless immediate action is needed to stop harm.

## 8. Liability

We aim to keep the service running reliably and will fix faults as soon as we can. We are liable as provided by law, including consumer protection and personal data protection law. Nothing in these Terms excludes or limits any liability that the law requires us to bear.

## 9. Protection of information

We protect your and your child's information as described in the Privacy Policy and collect and use it only within the scope you consented to, unless the law provides otherwise.

## 10. Changes to these Terms

When we change these Terms, we announce it in the app at least [15] days before the change takes effect. If you do not agree with the new version, you can stop using the service and delete your account at no cost.

## 11. Governing law and disputes

These Terms are governed by Vietnamese law. Disputes are first settled by negotiation. If that fails, you may ask a social organisation that protects consumer rights for help, complain to the state consumer protection authority, or bring a claim before a competent court in Vietnam.

## 12. Contact

[legal entity], enterprise code [code], [address], [email], [phone number].
$policy$,
   '2026-10-08T00:00:00Z', false);
