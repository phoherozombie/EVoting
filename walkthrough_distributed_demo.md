# Hướng dẫn Demo: Hệ thống E-Voting Phân tán (Multi-Key FHE)

Chào bạn, dựa trên yêu cầu của thầy giáo về việc **"3 máy giữ 3 code khác nhau / Key ai nấy giữ"**, hệ thống đã được tách thành hai phần độc lập: **VoterApp** và **ServerApp**.

---

## 🏗️ Kiến trúc Hệ thống

| Thành phần | Vị trí cài đặt | Trách nhiệm chính | Dữ liệu nhạy cảm chiếm giữ |
| :--- | :--- | :--- | :--- |
| **VoterApp** | 3 Máy WSL (Client) | Tạo khóa, Bỏ phiếu, Giải mã một phần | **Secret Key (`sk.bin`)** - Tuyệt đối không gửi đi. |
| **ServerApp** | Máy Ubuntu (Server) | Thiết lập hệ thống, Tổng hợp khóa/phiếu, Hợp nhất kết quả | **Joint Public Key** - Chỉ dùng để tính toán mã hóa. |

---

## 🏃 Quy trình vận hành Demo (9 Bước)

### 🔴 Giai đoạn 1: Thiết lập (Tại Server)
1. **Server chạy setup:**
   ```bash
   cd ServerApp && mkdir -p build && cd build
   cmake .. && make
   ./setup
   ```
   *=> Tạo ra `crypto_params.bin`. Bạn dùng `scp` gửi file này cho 3 máy WSL.*

### 🟢 Giai đoạn 2: Đăng ký & Tạo khóa (Tại 3 máy WSL)
2. **Client 1 tạo khóa:**
   ```bash
   cd VoterApp && mkdir -p build && cd build
   cmake .. && make
   ./client_keygen 1
   ```
   *=> Gửi `pk_share1.bin` lên Server.*

3. **Client 2 & 3 tiếp tục chuỗi:**
   * Lấy `pk_share` của người trước từ Server về.
   * Chạy: `./client_keygen [ID] ../server/pk_share[ID-1].bin`
   * Gửi `pk_share[ID].bin` mới lên Server.

### 🔴 Giai đoạn 3: Tổng hợp Khóa (Tại Server)
4. **Server chạy Aggregate:**
   ```bash
   ./server_key_aggregate
   ```
   *=> Tạo ra `joint_pk.bin`. Gửi file này cho cả 3 máy WSL để chuẩn bị bỏ phiếu.*

### 🟢 Giai đoạn 4: Bỏ phiếu (Tại 3 máy WSL)
5. **Mỗi máy WSL tự bỏ phiếu:**
   ```bash
   ./client_vote [ID] [0 hoặc 1]
   ```
   *=> Gửi file `vote[ID].bin` lên Server.*

### 🔴 Giai đoạn 5: Kiểm phiếu mã hóa (At Server)
6. **Server chạy Tally:**
   ```bash
   ./server_tally
   ```
   *=> Tạo ra `tally.bin` (Vẫn bị mã hóa). Gửi file này cho 3 máy WSL.*

### 🟢 Giai đoạn 6: Giải mã một phần (At 3 máy WSL)
7. **Mỗi máy WSL nộp share giải mã:**
   ```bash
   ./client_partial_decrypt [ID]
   ```
   *=> Gửi `partial_dec[ID].bin` lên Server.*

### 🔴 Giai đoạn 7: Kết quả cuối cùng (At Server)
8. **Server chạy Fusion:**
   ```bash
   ./server_fusion
   ```
   *=> In ra kết quả tổng số phiếu bầu công khai.*

---

## 💡 Điểm nhấn để Demo với Thầy giáo

1. **Minh chứng "Key ai nấy giữ":** 
   Mở thư mục `VoterApp/build/client1/` trên máy WSL 1 để cho thầy thấy file `sk.bin`. Sau đó mở thư mục `ServerApp` trên máy Server để thấy **không hề có** file `sk.bin` nào.
   
2. **Tính an toàn:** 
   Giải thích rằng Server chỉ làm nhiệm vụ "cộng các đống rác mã hóa" (`tally`). Server không thể tự ý xem kết quả nếu không có đủ 3 mảnh giải mã từ 3 cử tri.

3. **Thí nghiệm phá vỡ:** 
   Bạn có thể thử chỉ gửi 2 mảnh giải mã của Client 1 và 2 lên Server, rồi chạy `server_fusion`. Kết quả sẽ báo lỗi hoặc ra con số vô nghĩa. Điều này chứng minh cơ chế **Threshold Decryption** (phải đủ tất cả mới ra kết quả).
