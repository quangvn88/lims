// utils/common.js

// Lấy ngày hiện tại dạng yyyy-mm-dd
export const getToday = () => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

// Chuyển TIME HH:mm:ss thành tổng số giây
export const timeToSeconds = (time) => {
  if (!time) return 0;
  const [h, m, s = 0] = time.split(":").map(Number);
  return h * 3600 + m * 60 + s;
};

// Chuỗi base64 -> Uint8Array (bỏ tiền tố data: và khoảng trắng/xuống dòng).
export const base64ToBytes = (base64) => {
  const clean = String(base64 || "")
    .replace(/^data:[^;]+;base64,/, "")
    .replace(/\s/g, "");
  const chars = atob(clean);
  const bytes = new Uint8Array(chars.length);
  for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);
  return bytes;
};
