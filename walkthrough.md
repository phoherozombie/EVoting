# Báo cáo Chỉnh sửa Tài liệu Đồ án (DOCX)

Toàn bộ các cập nhật liên quan đến JWT Token và Cấu trúc triển khai hệ thống đa máy đã được chèn tự động, bảo toàn cấu trúc tệp DOCX gốc.

> [!NOTE]
> Để tránh vỡ cấu trúc XML nguyên bản (Corrupted Document), thay vì tự "unzip -> sửa tay", mình đã sử dụng thư viện `python-docx` để thao tác trực tiếp lên cấu trúc đối tượng của tài liệu. Việc này đảm bảo tính an toàn cao nhất cho file Đồ án của bạn. File đã được lưu với tên:
> **[Do_Hoang_Phuc_VNUK_Graduation_ thesis_Updated.docx](file:///Users/phucdo/.gemini/antigravity-ide/brain/9e817ed4-3924-415c-973c-389a57612fef/Do_Hoang_Phuc_VNUK_Graduation_%20thesis_Updated.docx)**

## Các thay đổi chính:

### 1. Cập nhật Mục 1.5 "Scope and Limitations"
- Đã bổ sung một nhận định về bảo mật vào phần hạn chế, làm rõ rằng hệ thống **đã loại bỏ việc định danh cứng qua CLIENT_ID** và tích hợp thành công cơ chế Đăng ký và Xác thực cử tri bằng **JWT Token**.

### 2. Cập nhật Mục 3.5.2 "API Security and CORS Policy Design"
- Đã ghi đè đoạn `Authorization Verification:` cũ thành nội dung mới mô tả chi tiết:
  > Hệ thống sử dụng JWT (JSON Web Token) như một lớp bảo mật bổ sung quan trọng để chống giả mạo danh tính cử tri, thay thế cho việc chỉ dựa vào CLIENT_ID ở client node. Luồng xác thực diễn ra như sau: cử tri gửi yêu cầu POST /register để ghi danh, sau đó dùng POST /login để nhận về một JWT hợp lệ. Token này bắt buộc phải được đính kèm vào header Authorization (dưới dạng Bearer <Token>) cho mọi route nhạy cảm...

### 3. Cập nhật Mục 4.3 "Implementation of the Server (Node.js)"
- Đã **thêm tiểu mục mới `4.3.4 JWT Authentication and Voter Registration`**.
- Trình bày về việc lưu trữ `server/data/voters.json` cũng như hoạt động của JWT middleware bảo vệ các route chia sẻ khóa và bỏ phiếu.

### 4. Cập nhật Mục 4.6 "Distributed Deployment Scripts"
- Đổi tên mục thành **4.6 Deployment and Multi-Machine Synchronization**.
- Đã bổ sung nội dung giải thích về kiến trúc **3 máy WSL** và việc không thể kết nối trực tiếp do NAT.
- Trình bày vai trò của **Server Ubuntu (172.20.1.152)** đóng vai trò trung chuyển.
- Đã chèn một **Sơ đồ kiến trúc Text-based** đơn giản để minh họa quy trình Push và Pull bằng các script bash:
  `[WSL 3 (Laptop)] ---> (SCP Push) ---> [Server Ubuntu trung chuyển] ---> (SCP Pull) ---> [WSL 1 & 2]`

## Hướng dẫn xem tài liệu
Do công cụ QuickLook (`qlmanage`) trên máy Mac của bạn kết xuất DOCX dưới dạng thẻ HTML thay vì từng trang PNG độc lập, hình ảnh screenshot không hiển thị chính xác ngắt trang của Word.

> [!IMPORTANT]
> **Vui lòng tải hoặc click vào file [Do_Hoang_Phuc_VNUK_Graduation_ thesis_Updated.docx](file:///Users/phucdo/evoting-system/Do_Hoang_Phuc_VNUK_Graduation_%20thesis_Updated.docx) và mở lên bằng Microsoft Word, LibreOffice hoặc Google Docs (trên máy khác hoặc trình duyệt) để kiểm tra độ chính xác của các đoạn text đã được chèn vào nhé!**
