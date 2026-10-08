import { parseWorkbook, visibleSplitToIndex } from "./excelModel";
import { base64ToBytes } from "../utils/common";

// Lấy MỘT file Excel từ gateway LIMS rồi dựng model cho <ExcelGrid>.
// Dùng chung cho mọi trang xem file (ViewFileDHN, ViewFileThuLao, ...) để hai
// bên không trôi lệch nhau — bẫy dưới đây từng làm /view-file-dhn mất cột ẩn
// và freeze pane trong khi /view-file-thulao vẫn đúng, chỉ vì thứ tự nhánh khác.
//
// BẪY CHÍNH: cùng một FM, gateway có thể trả về HAI kiểu response khác hẳn nhau
//   { RESPONSE: { E_BASE64, E_TYPE } }  <- `default` của handleRequest -> callFMSAP
//                                          trả NGUYÊN file .xlsx. Client tự parse
//                                          nên giữ ĐỦ cột ẩn + freeze pane.
//   { success, sheets }                 <- gateway đã đăng ký case riêng, parse ở
//                                          server. Model này KHÔNG mang
//                                          colHidden/rowHidden/freeze -> lưới mất
//                                          cột ẩn và mất đóng băng dòng/cột.
// => LUÔN ưu tiên base64. Chỉ khi không có base64 mới dùng `sheets`.
//
// `handleRequest` so khớp FUNC PHÂN BIỆT HOA/THƯỜNG, còn SAP nhận tên FM không
// phân biệt hoa/thường. Nên gọi FUNC viết thường sẽ TRƯỢT case đã đăng ký, rơi
// vào `default` và lấy được file gốc. Đo thật ngày 06/08/2026:
//   ZFM_DHN_FILE_BASE64    -> 1.510.251 byte, { success, sheets }, không base64
//   zfm_dhn_file_base64    ->    37.427 byte, E_BASE64 (nhẹ hơn 40 lần, ~138 ms)
//   ZFM_THULAO_FILE_BASE64 -> chưa có case, cả hai cách đều trả E_BASE64
// Nếu sau này gateway đăng ký thêm tên viết thường, nhánh raw sẽ trả
// { success, sheets } và tự rơi xuống nhánh dự phòng — không vỡ giao diện.
//
// Cách sửa triệt để vẫn nằm ở server: trả kèm `E_BASE64`, hoặc bổ sung
// colHidden/rowHidden/freeze vào model do server parse.

/**
 * @returns {Promise<{
 *   model: object|null,                  // model cho <ExcelGrid>, null nếu không có dữ liệu
 *   source: 'base64'|'sheets'|'none',    // 'sheets' = THIẾU cột ẩn + freeze pane
 *   eType: string,                       // đuôi file SAP báo về ("xlsx", "pdf"...)
 *   data: any,                           // response thô, để lấy `msg` khi lỗi
 * }>}
 */
export async function fetchExcelModel({ endpoint, authHeader, func, budat, label }) {
  const post = (funcName) =>
    fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      // `date` cho controller đã đăng ký case, `DATA.I_BUDAT` cho nhánh default
      // (callFMSAP). Gửi cả hai để một body chạy được với mọi cấu hình gateway.
      body: JSON.stringify({
        FUNC: funcName,
        date: budat,
        DATA: { I_BUDAT: budat },
      }),
    });

  const rawFunc = String(func || "").toLowerCase();
  let res = await post(rawFunc);
  let data = await readJson(res);
  let b64 = pickBase64(data);

  // Nhánh raw không ra base64 -> gọi lại đúng tên FUNC gốc để ít nhất còn model
  // do server parse (hiển thị được, chỉ thiếu cột ẩn + freeze pane).
  if (!b64 && rawFunc !== func) {
    res = await post(func);
    data = await readJson(res);
    b64 = pickBase64(data);
  }

  const eType = String(
    data?.RESPONSE?.E_TYPE || data?.E_TYPE || ""
  ).toLowerCase();

  if (b64) {
    // Không phải Excel thì trả model rỗng kèm eType để trang tự báo lỗi.
    if (eType && !eType.includes("xls")) return { model: null, source: "none", eType, data };
    return { model: await parseWorkbook(base64ToBytes(b64)), source: "base64", eType, data };
  }

  if (data && Array.isArray(data.sheets) && data.sheets.length) {
    const norm = normalizeModel(data.sheets);
    if (!norm.hasLayout)
      console.warn(
        `[${label || "excel"}] Response chỉ có \`sheets\` do server parse và ` +
          "THIẾU colHidden/rowHidden/freeze -> không dựng được cột ẩn + freeze " +
          "pane. Cần server trả kèm E_BASE64, hoặc bổ sung 3 trường này.",
        {
          topKeys: Object.keys(data || {}),
          sheet0Keys: Object.keys(data.sheets[0] || {}),
          sheet0Cols: (data.sheets[0] || {}).cols,
        }
      );
    return { model: { sheets: norm.sheets }, source: "sheets", eType, data };
  }

  return { model: null, source: "none", eType, data };
}

// Đọc JSON trước cả khi !res.ok để lấy được `msg` server trả về (vd lỗi SAP).
async function readJson(res) {
  try {
    return await res.json();
  } catch (e) {
    throw new Error(`HTTP ${res.status}`);
  }
}

// Base64 của file nằm ở chỗ khác nhau tuỳ gateway đã đăng ký case hay chưa,
// và có khi là bảng (SAP trả internal table) -> gom hết các khả năng.
// Chặn chuỗi ngắn (vd E_TYPE="X") bằng ngưỡng độ dài.
export function pickBase64(data) {
  const cands = [
    data?.RESPONSE?.E_BASE64,
    data?.RESPONSE?.BASE64,
    data?.E_BASE64,
    data?.base64,
    data?.BASE64,
    data?.DATA?.E_BASE64,
  ];
  for (const c of cands) {
    if (typeof c === "string" && c.length > 100) return c;
    if (Array.isArray(c) && c.length) {
      const first = c[0];
      const s =
        typeof first === "string" ? first : first?.BASE64 || first?.E_BASE64 || "";
      // Bảng nhiều dòng: SAP cắt base64 thành từng đoạn -> nối lại.
      if (s && typeof first !== "string" && c.length > 1) {
        const all = c.map((r) => r?.BASE64 || r?.E_BASE64 || "").join("");
        if (all.length > 100) return all;
      }
      if (s.length > 100) return s;
    }
  }
  // Không trúng tên trường nào đã biết -> QUÉT ĐỆ QUY cả response.
  // Mỗi gateway đặt tên khác nhau (E_FILE, CONTENT, FILE_DATA...), thay vì đoán
  // tên thì nhận diện bằng NỘI DUNG: .xlsx là file ZIP, 4 byte đầu "PK\x03\x04"
  // -> base64 luôn bắt đầu bằng "UEsDB". Không thể dương tính giả với text thường.
  return deepFindXlsxBase64(data);
}

const XLSX_B64_HEAD = "UEsDB";
// Chuỗi rời, hoặc mảng các đoạn bị SAP cắt nhỏ (chỉ đoạn ĐẦU mang chữ ký).
function deepFindXlsxBase64(node, depth = 0) {
  if (!node || depth > 6) return "";

  if (typeof node === "string")
    return node.startsWith(XLSX_B64_HEAD) ? node : "";

  if (Array.isArray(node)) {
    // Mảng chuỗi: nối lại rồi kiểm tra chữ ký ở đầu.
    if (node.every((x) => typeof x === "string")) {
      const all = node.join("");
      return all.startsWith(XLSX_B64_HEAD) ? all : "";
    }
    // Mảng object: thử nối theo từng KHOÁ (SAP: [{BASE64:'UEsDB..'},{BASE64:'..'}]).
    const keys = new Set();
    node.forEach(
      (r) => r && typeof r === "object" && Object.keys(r).forEach((k) => keys.add(k))
    );
    for (const k of keys) {
      const all = node.map((r) => (typeof r?.[k] === "string" ? r[k] : "")).join("");
      if (all.startsWith(XLSX_B64_HEAD)) return all;
    }
    for (const it of node) {
      const hit = deepFindXlsxBase64(it, depth + 1);
      if (hit) return hit;
    }
    return "";
  }

  if (typeof node === "object") {
    for (const v of Object.values(node)) {
      const hit = deepFindXlsxBase64(v, depth + 1);
      if (hit) return hit;
    }
  }
  return "";
}

// Đưa model do server parse về đúng hợp đồng của <ExcelGrid>:
//   { name, cols[], colHidden[], rowHidden[], freeze:{rows,cols}|null, rows[] }
// hasLayout = server có gửi được thông tin cột ẩn / freeze hay không.
export function normalizeModel(sheets) {
  let hasLayout = false;
  const out = sheets.map((s) => {
    const cols = Array.isArray(s.cols) ? s.cols : [];
    const rows = Array.isArray(s.rows) ? s.rows : [];

    const rawColHidden = s.colHidden || s.hiddenCols || s.colsHidden;
    const rawRowHidden = s.rowHidden || s.hiddenRows || s.rowsHidden;
    if (Array.isArray(rawColHidden) || Array.isArray(rawRowHidden)) hasLayout = true;

    // Không có cờ ẩn: chỉ dám suy từ bề rộng/chiều cao = 0 (Excel coi là ẩn).
    // KHÔNG suy từ "cột hẹp": cột A ẩn của file MOI đi qua server chỉ còn
    // width 9px, không phân biệt được với một cột hẹp thật.
    const colHidden = toFlags(rawColHidden, cols.length, (i) => cols[i] === 0);
    const rowHidden = toFlags(rawRowHidden, rows.length, (i) => rows[i]?.h === 0);

    const fz = s.freeze || s.frozen || {};
    // `rows/cols`, `freezeRows/freezeCols`: server nói thẳng "ghim mấy dòng/cột"
    // -> dùng nguyên. `xSplit/ySplit`: tên theo OOXML nên mang đúng ngữ nghĩa
    // OOXML — đếm theo dòng/cột NHÌN THẤY — phải quy đổi qua cột/dòng ẩn, nếu
    // không thì file ẩn cột A (như file thù lao) sẽ ghim nhầm vào cột ẩn.
    const fRows =
      toInt(fz.rows ?? s.freezeRows) ||
      visibleSplitToIndex(toInt(fz.ySplit ?? s.ySplit), rowHidden, rows.length);
    const fCols =
      toInt(fz.cols ?? s.freezeCols) ||
      visibleSplitToIndex(toInt(fz.xSplit ?? s.xSplit), colHidden, cols.length);
    if (fRows || fCols) hasLayout = true;

    return {
      ...s,
      cols,
      rows,
      colHidden,
      rowHidden,
      freeze: fRows || fCols ? { rows: fRows, cols: fCols } : null,
    };
  });
  return { sheets: out, hasLayout };
}

// Nhận cả mảng cờ [true,false,...] / [0,1,...] và mảng CHỈ SỐ cột ẩn [0,7,12].
function toFlags(v, len, fallback) {
  const out = new Array(len).fill(false);
  if (Array.isArray(v) && v.length) {
    const looksIndexList =
      v.every((x) => Number.isInteger(x) && x >= 0 && x < Math.max(len, 1)) &&
      v.some((x) => x > 1);
    if (looksIndexList) v.forEach((i) => (out[i] = true));
    else
      v.forEach((x, i) => {
        if (i < len) out[i] = !!x;
      });
    return out;
  }
  for (let i = 0; i < len; i++) out[i] = !!fallback(i);
  return out;
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Tách chuỗi ngày về YYYYMMDD — nhận YYYYMMDD, YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY.
// SAP và controller đều cần YYYYMMDD: đã đo, gửi "31.07.2026" thì controller prd
// trả { success:false, msg:"Không có dữ liệu file" }, gửi "20260731" trả 288 dòng.
export function toYmd(v) {
  const s = String(v || "").trim();
  if (!s) return "";

  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/); // YYYYMMDD
  if (m) return s;

  m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/); // YYYY-MM-DD
  if (m) return m[1] + m[2].padStart(2, "0") + m[3].padStart(2, "0");

  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); // DD.MM.YYYY
  if (m) return m[3] + m[2].padStart(2, "0") + m[1].padStart(2, "0");

  return s; // để nguyên, SAP sẽ tự báo không có dữ liệu
}
