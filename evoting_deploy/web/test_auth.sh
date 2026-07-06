#!/bin/bash
set -e

CENTRAL_URL="http://localhost:3001/api"
CLIENT_URL="http://localhost:3000"

echo "=== Đặt lại trạng thái Server ==="
curl -s "$CENTRAL_URL/reset" > /dev/null
echo "OK."

echo "=== 1. Test: Đăng ký cử tri mới (voter_id: 3) ==="
curl -s -X POST $CENTRAL_URL/register -H "Content-Type: application/json" -d '{"voter_id":"3","password":"123"}' | grep -q "thành công"
echo "OK."

echo "=== 2. Test: Đăng nhập (voter_id: 3) ==="
TOKEN=$(curl -s -X POST $CENTRAL_URL/login -H "Content-Type: application/json" -d '{"voter_id":"3","password":"123"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)
if [ -z "$TOKEN" ]; then
  echo "Lỗi: Không lấy được token"
  exit 1
fi
echo "OK. Lấy được Token."

echo "=== 3. Test: Vote không token -> Bị từ chối (trực tiếp upload lên central server) ==="
# Dummy vote file content
echo "dummy" > dummy.bin
RES=$(curl -s -X POST $CENTRAL_URL/upload \
  -F "type=vote" -F "id=3" -F "file=@dummy.bin" \
  -w "%{http_code}")
HTTP_STATUS=$(echo "$RES" | tail -c 4)
if [ "$HTTP_STATUS" != "401" ]; then
  echo "Lỗi: Vote không token không bị chặn đúng cách (Status: $HTTP_STATUS)"
  rm dummy.bin
  exit 1
fi
echo "OK. Bị chặn (401 Unauthorized)."

echo "=== 4. Test: Vote sai ID -> Bị từ chối ==="
RES=$(curl -s -X POST $CENTRAL_URL/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "type=vote" -F "id=99" -F "file=@dummy.bin" \
  -w "%{http_code}")
HTTP_STATUS=$(echo "$RES" | tail -c 4)
if [ "$HTTP_STATUS" != "403" ]; then
  echo "Lỗi: Vote sai ID không bị chặn đúng cách (Status: $HTTP_STATUS)"
  rm dummy.bin
  exit 1
fi
echo "OK. Bị chặn (403 Forbidden)."

rm dummy.bin
echo "=== 5. Test: Khởi động node server và vote qua API của Client Server ==="
echo "Note: Test này cần client_server.js và central_server.js đang chạy."
echo "Bạn có thể tự test trên trình duyệt."

echo "=== HOÀN TẤT KIỂM TRA CƠ BẢN ==="
