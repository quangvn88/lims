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
