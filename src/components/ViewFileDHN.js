import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ExcelGrid from "./ExcelGrid.jsx";
import { fetchExcelModel, toYmd } from "./excelFileResponse";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";

// Trang xem Excel DHN render bằng HTML <table> thuần qua <ExcelGrid>.
//
// Hợp đồng request:
//   POST {BASE_URL}{API}  (server lấy từ path param, vd "dev" trong /dev/lims/plx/api/)
//   Basic Auth, body { FUNC, date, DATA: { I_BUDAT } }
//   Ngày LUÔN gửi dạng YYYYMMDD — đã đo: gửi "31.07.2026" thì controller prd
//   trả { success:false, msg:"Không có dữ liệu file" }, gửi "20260731" trả 288 dòng.
//
// Toàn bộ phần "gọi API -> chọn nhánh base64 hay sheets -> dựng model" nằm ở
// `excelFileResponse.fetchExcelModel`, dùng chung với ViewFileThuLao. Xem giải
// thích đầy đủ về hai kiểu response và mẹo FUNC viết thường ở đầu file đó.
//
// Mở qua /view-file-dhn?date=20260719 (nhận cả 19.07.2026 / 19/07/2026 / 2026-07-19)
const ViewFileDHN = ({ func = "ZFM_DHN_FILE_BASE64" }) => {
  const [searchParams] = useSearchParams();
  // Chấp nhận cả `date` (đúng tên tham số controller) lẫn `budat` (link cũ).
  const rawDate = searchParams.get("date") || searchParams.get("budat") || "";
  const budat = toYmd(rawDate);

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

        const r = await fetchExcelModel({
          endpoint: `${BASE_URL}${API}`,
          authHeader: `Basic ${btoa(`${API_USER}:${API_PASSWORD}`)}`,
          func,
          budat,
          label: "view-file-dhn",
        });
        if (cancelled) return;

        if (r.model) {
          setModel(r.model);
          return;
        }

        if (r.eType && !r.eType.includes("xls")) {
          setError(`File định dạng "${r.eType}" không hiển thị được dạng lưới.`);
          return;
        }

        // Log nguyên response để soi nhanh trong Console khi server báo lỗi.
        console.warn("[view-file-dhn] response:", r.data);
        setError(
          (r.data?.msg || r.data?.message || `Không lấy được dữ liệu file`) +
            ` (date=${budat || "(rỗng)"})`
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

const centerBox = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export default ViewFileDHN;
