import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ExcelGrid from "./ExcelGrid.jsx";
import { parseWorkbook } from "./excelModel";
import { base64ToBytes } from "../utils/common";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";

// Trang xem Excel DHN render bằng HTML <table> thuần qua <ExcelGrid>.
//
// Hợp đồng request:
//   POST {BASE_URL}{API}  (server lấy từ path param, vd "dev" trong /dev/lims/plx/api/)
//   Basic Auth, body { FUNC, date, DATA: { I_BUDAT } }
//   Ngày LUÔN gửi dạng YYYYMMDD — đã đo: gửi "31.07.2026" thì controller prd trả
//   { success:false, msg:"Không có dữ liệu file" }, gửi "20260731" trả 288 dòng.
//
// Chấp nhận CẢ HAI kiểu response vì mỗi gateway cấu hình khác nhau:
//   - { RESPONSE: { E_BASE64 } } : gateway chưa đăng ký case -> rơi vào default
//                                  của handleRequest -> callFMSAP trả raw SAP.
//   - { success, sheets }        : gateway đã đăng ký case ZFM_DHN_FILE_BASE64
//                                  (getDhnFileModel parse ở server).
// ƯU TIÊN NHÁNH BASE64: model server parse thiếu colHidden/rowHidden/freeze nên
// lưới mất cột ẩn + freeze pane so với file gốc (đã đối chiếu file MOI: cột A
// hidden, pane xSplit=3/ySplit=6). Chỉ khi KHÔNG có base64 mới dùng `sheets`.
// Mở qua /view-file-dhn?date=20260719 (nhận cả 19.07.2026 / 19/07/2026 / 2026-07-19)
const ViewFileDHN = ({ func = "ZFM_DHN_FILE_BASE64" }) => {
  const [searchParams] = useSearchParams();
  // Chấp nhận cả `date` (đúng tên tham số controller) lẫn `budat` (link cũ).
  const rawDate = searchParams.get("date") || searchParams.get("budat") || "";
  const budat = toYmd(rawDate); // YYYYMMDD — dùng cho cả 2 nhánh

  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError("");
        setModel(null);

        const token = btoa(`${API_USER}:${API_PASSWORD}`);
        const post = (funcName) =>
          fetch(`${BASE_URL}${API}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Basic ${token}`,
            },
            // `date` cho controller, `DATA.I_BUDAT` cho nhánh default (callFMSAP).
            body: JSON.stringify({
              FUNC: funcName,
              date: budat,
              DATA: { I_BUDAT: budat },
            }),
          });

        // GỌI NHÁNH RAW TRƯỚC (rawFunc = func viết thường).
        //
        // handleRequest của gateway so khớp FUNC theo kiểu PHÂN BIỆT HOA/THƯỜNG:
        // đúng "ZFM_DHN_FILE_BASE64" -> case đã đăng ký -> getDhnFileModel parse
        // ở server và chỉ trả { success, sheets }; viết thường -> rơi vào default
        // -> callFMSAP trả nguyên { RESPONSE: { E_BASE64, E_TYPE } }. SAP nhận tên
        // FM không phân biệt hoa/thường nên vẫn đúng function.
        // Đã đo trên date=20260719:
        //   ZFM_DHN_FILE_BASE64 -> 1.510.251 byte JSON, KHÔNG có base64,
        //                          sheets[0] chỉ có {name,colCount,cols,rows}
        //   zfm_dhn_file_base64 ->    37.427 byte, E_BASE64 (file 28.010 byte,
        //                          E_TYPE "xlsx"), trong đó sheet XML có
        //                          <pane xSplit="3" ySplit="6" state="frozen"/>
        //                          và <col min="1" max="1" hidden="1"/>.
        // Nhánh raw vừa GIỮ ĐÚNG ĐỊNH DẠNG (cột ẩn + freeze pane) vừa nhẹ hơn 40 lần.
        //
        // Nếu sau này gateway đăng ký thêm cả tên viết thường (hoặc chuẩn hoá hoa
        // /thường), nhánh raw sẽ trả { success, sheets } -> tự động rơi xuống
        // nhánh (2) bên dưới, không vỡ giao diện.
        const rawFunc = String(func || "").toLowerCase();
        let res = await post(rawFunc);
        let data = await readJson(res);
        if (cancelled) return;

        let b64 = pickBase64(data);

        // Nhánh raw không ra base64 -> gọi lại đúng tên FUNC gốc để ít nhất còn
        // model do server parse (hiển thị được, chỉ thiếu cột ẩn + freeze).
        if (!b64 && rawFunc !== func) {
          res = await post(func);
          data = await readJson(res);
          if (cancelled) return;
          b64 = pickBase64(data);
        }

        // (1) CÓ base64 -> LUÔN parse ở client, kể cả khi response cũng gửi
        //     kèm `sheets`. Model do SERVER parse (getDhnFileModel) không mang
        //     colHidden/rowHidden/freeze, nên lưới mất cột ẩn (file MOI: cột A
        //     rộng 0,55 + hidden="1") và mất freeze pane (xSplit=3, ySplit=6).
        //     parseWorkbook đọc đủ hai thứ đó từ chính file .xlsx.
        const eType = String(
          data?.RESPONSE?.E_TYPE || data?.E_TYPE || ""
        ).toLowerCase();

        if (b64) {
          if (eType && !eType.includes("xls")) {
            setError(`File định dạng "${eType}" không hiển thị được dạng lưới.`);
            return;
          }
          const parsed = await parseWorkbook(base64ToBytes(b64));
          if (cancelled) return;
          setModel(parsed);
          return;
        }

        // (2) Chỉ có model server parse -> chuẩn hoá về đúng hợp đồng của
        //     <ExcelGrid>. Server nào gửi kèm thông tin ẩn/freeze (dù tên
        //     trường khác: hiddenCols / xSplit / ySplit...) thì vẫn dựng đúng;
        //     server không gửi thì KHÔNG suy ra được -> log cảnh báo.
        if (data && Array.isArray(data.sheets) && data.sheets.length) {
          const norm = normalizeModel(data.sheets);
          if (!norm.hasLayout)
            console.warn(
              "[view-file-dhn] Response chỉ có `sheets` do server parse và " +
                "THIẾU colHidden/rowHidden/freeze -> không dựng được cột ẩn + " +
                "freeze pane. Cần server trả kèm E_BASE64 (client tự parse) " +
                "hoặc bổ sung 3 trường này trong getDhnFileModel.",
              // In kèm hình dạng response để soi nhanh trường nào đang có.
              {
                topKeys: Object.keys(data || {}),
                sheet0Keys: Object.keys(data.sheets[0] || {}),
                sheet0Cols: (data.sheets[0] || {}).cols,
              }
            );
          setModel({ sheets: norm.sheets });
          return;
        }

        // Log nguyên response để soi nhanh trong Console khi server báo lỗi.
        console.warn("[view-file-dhn] response:", data);
        setError(
          (data?.msg || data?.message || `Không lấy được dữ liệu file`) +
            ` (HTTP ${res.status}, date=${budat || "(rỗng)"})`
        );
        setModel(null);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(`Không thể kết nối tới API hoặc dữ liệu lỗi: ${err.message}`);
          setModel(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [budat, func]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        background: "#fff",
        overflow: "hidden",
      }}
    >
      {model && <ExcelGrid model={model} />}

      {loading && (
        <div style={{ ...centerBox, color: "#333", fontWeight: 500, zIndex: 3 }}>
          ⏳ Đang tải dữ liệu...
        </div>
      )}

      {!loading && !model && !error && (
        <div style={centerBox}>
          <span style={{ color: "#333", fontSize: 16 }}>Không có file</span>
        </div>
      )}

      {error && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "12px 16px",
            color: "#fff",
            background: "rgba(200,0,0,0.8)",
            fontWeight: 600,
            zIndex: 3,
          }}
        >
          ⚠️ {error}
        </div>
      )}
    </div>
  );
};

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
function pickBase64(data) {
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
        typeof first === "string"
          ? first
          : first?.BASE64 || first?.E_BASE64 || "";
      // Bảng nhiều dòng: SAP cắt base64 thành từng đoạn -> nối lại.
      if (s && typeof first !== "string" && c.length > 1) {
        const all = c
          .map((r) => r?.BASE64 || r?.E_BASE64 || "")
          .join("");
        if (all.length > 100) return all;
      }
      if (s.length > 100) return s;
    }
  }
  // Không trúng tên trường nào đã biết -> QUÉT ĐỆ QUY cả response.
  // Mỗi gateway đặt tên khác nhau (E_FILE, CONTENT, FILE_DATA...), thay vì
  // đoán tên thì nhận diện bằng NỘI DUNG: .xlsx là file ZIP, 4 byte đầu
  // "PK\x03\x04" -> base64 luôn bắt đầu bằng "UEsDB". Không thể dương tính
  // giả với chuỗi text thường.
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
    node.forEach((r) => r && typeof r === "object"
      && Object.keys(r).forEach((k) => keys.add(k)));
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
function normalizeModel(sheets) {
  let hasLayout = false;
  const out = sheets.map((s) => {
    const cols = Array.isArray(s.cols) ? s.cols : [];
    const rows = Array.isArray(s.rows) ? s.rows : [];

    const rawColHidden = s.colHidden || s.hiddenCols || s.colsHidden;
    const rawRowHidden = s.rowHidden || s.hiddenRows || s.rowsHidden;
    if (Array.isArray(rawColHidden) || Array.isArray(rawRowHidden))
      hasLayout = true;

    // Không có cờ ẩn: chỉ dám suy từ bề rộng/chiều cao = 0 (Excel coi là ẩn).
    const colHidden = toFlags(rawColHidden, cols.length, (i) => cols[i] === 0);
    const rowHidden = toFlags(rawRowHidden, rows.length, (i) => rows[i]?.h === 0);

    const fz = s.freeze || s.frozen || {};
    const fRows = toInt(fz.rows ?? fz.ySplit ?? s.freezeRows ?? s.ySplit);
    const fCols = toInt(fz.cols ?? fz.xSplit ?? s.freezeCols ?? s.xSplit);
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
    else v.forEach((x, i) => { if (i < len) out[i] = !!x; });
    return out;
  }
  for (let i = 0; i < len; i++) out[i] = !!fallback(i);
  return out;
}
function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Tách chuỗi ngày về { d, m, y } — nhận YYYYMMDD, YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY.
function splitDate(v) {
  const s = String(v || "").trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/); // YYYYMMDD
  if (m) return { y: m[1], m: m[2], d: m[3] };

  m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/); // YYYY-MM-DD
  if (m) return { y: m[1], m: m[2].padStart(2, "0"), d: m[3].padStart(2, "0") };

  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); // DD.MM.YYYY
  if (m) return { y: m[3], m: m[2].padStart(2, "0"), d: m[1].padStart(2, "0") };

  return null;
}
// -> YYYYMMDD (định dạng cả FM SAP lẫn controller đều cần)
function toYmd(v) {
  const p = splitDate(v);
  return p ? `${p.y}${p.m}${p.d}` : String(v || "").trim();
}

const centerBox = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export default ViewFileDHN;
