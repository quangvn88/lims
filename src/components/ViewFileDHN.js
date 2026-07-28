import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ExcelGrid from "./ExcelGrid.jsx";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";

// Trang xem Excel DHN render bằng HTML <table> thuần qua <ExcelGrid>.
//
// Khác các bản trước: file .xlsx được PARSE Ở SERVER. Gọi FUNC
// ZFM_DHN_FILE_BASE64 -> dispatcher LIMS route sang controller getDhnFileModel
// (D:\DATA\NodeJS\PLX\PLX-API-8001\controllers\LIMS\getDhnFileModel.js): lấy
// base64 từ SAP rồi ExcelJS parse -> JSON model, trả về { success, sheets }.
// Client chỉ nhận model đã sẵn sàng và render (không cần ExcelJS phía client).
//
// Hợp đồng request (khớp getDhnFileModel + dispatcher handleRequest/index.js):
//   POST {BASE_URL}{API}  (server lấy từ path param, vd "dev" trong /dev/lims/plx/api/)
//   Basic Auth, body { FUNC, date }   (date dạng DD.MM.YYYY — KHÔNG phải DATA.I_BUDAT)
//   -> { success: true, sheets: [...] }  hoặc  { success: false, msg }
// Mở qua /view-file-dhn?budat=19.07.2026 (hoặc ?date=19.07.2026)
const ViewFileDHN = ({ func = "ZFM_DHN_FILE_BASE64" }) => {
  const [searchParams] = useSearchParams();
  // Chấp nhận cả `date` (đúng tên tham số controller) lẫn `budat` (link cũ).
  const date = searchParams.get("date") || searchParams.get("budat") || "";

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
        const res = await fetch(`${BASE_URL}${API}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${token}`,
          },
          body: JSON.stringify({ FUNC: func, date }),
        });

        // Đọc JSON trước cả khi !res.ok để lấy được `msg` server trả về (vd lỗi SAP).
        let data = null;
        try {
          data = await res.json();
        } catch (e) {
          throw new Error(`HTTP ${res.status}`);
        }
        if (cancelled) return;

        if (data && data.success && Array.isArray(data.sheets)) {
          setModel({ sheets: data.sheets });
        } else {
          setError(data?.msg || `Không lấy được dữ liệu file (HTTP ${res.status}).`);
          setModel(null);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError("Không thể kết nối tới API hoặc dữ liệu lỗi.");
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
  }, [date, func]);

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
