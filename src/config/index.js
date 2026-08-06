// Rỗng ở môi trường dev (đi qua proxy CRA, xem .env.development). Dùng "" thay
// vì undefined để `${BASE_URL}${API}` không thành "undefined/dev/lims/...".
export const BASE_URL = process.env.REACT_APP_BASE_URL || "";
export const API = process.env.REACT_APP_API;

export const API_USER = "PLX_LIMS";
export const API_PASSWORD = "PLX_LIMS@!23";
