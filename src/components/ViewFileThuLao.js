import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ExcelGrid from "./ExcelGrid.jsx";
import { parseWorkbook } from "./excelModel";
import { base64ToBytes } from "../utils/common";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";

// Trang xem file thù lao render bằng HTML <table> thuần qua <ExcelGrid>.
// Cùng UI/luồng với ViewFileDHN, khác 2 điểm:
//
// 1. FUNC = ZFM_THULAO_FILE_BASE64 (FM SAP trả { E_BASE64, E_TYPE }).
// 2. Chấp nhận CẢ HAI kiểu response nên chạy được dù backend đã đăng ký
//    controller hay chưa:
//    - { success, sheets }        : dispatcher LIMS đã có case riêng (parse ở server,
//                                   giống getDhnFileModel) -> dùng luôn model.
//    - { RESPONSE: { E_BASE64 } } : chưa có case -> rơi vào default của
//                                   handleRequest -> callFMSAP trả raw SAP;
//                                   client tự parse bằng excelModel.parseWorkbook.
//    Body chỉ gửi DATA.I_BUDAT -> controller phía backend phải đọc ngày từ
//    req.body.DATA.I_BUDAT (khác getDhnFileModel đọc req.body.date).
//
// I_BUDAT phải là YYYYMMDD — gửi DD.MM.YYYY thì SAP trả E_BASE64 rỗng.
// Mở qua /view-file-thulao?date=20260719 (nhận cả 19.07.2026 / 19/07/2026 / 2026-07-19)
const ViewFileThuLao = ({ func = "ZFM_THULAO_FILE_BASE64" }) => {
  const [searchParams] = useSearchParams();
  const rawDate = searchParams.get("date") || searchParams.get("budat") || "";
  const budat = normalizeBudat(rawDate);

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
          body: JSON.stringify({
            FUNC: func,
            DATA: { I_BUDAT: budat },
          }),
        });

        // Đọc JSON trước cả khi !res.ok để lấy được `msg` server trả về (vd lỗi SAP).
        let data = null;
        try {
          data = await res.json();
        } catch (e) {
          throw new Error(`HTTP ${res.status}`);
        }
        if (cancelled) return;

        // (1) Backend đã parse sẵn
        if (data && data.success && Array.isArray(data.sheets)) {
          setModel({ sheets: data.sheets });
          return;
        }

        // (2) Raw SAP -> parse ở client
        const resp = data?.RESPONSE;
        const b64 = pickBase64(resp?.E_BASE64);
        const eType = String(resp?.E_TYPE || "").toLowerCase();

        if (b64) {
          if (eType && !eType.includes("xls")) {
            setError(
              `File thù lao định dạng "${eType}" không hiển thị được ở dạng lưới Excel.`
            );
            return;
          }
          const parsed = await parseWorkbook(base64ToBytes(b64));
          if (cancelled) return;
          setModel(parsed);
          return;
        }

        setError(
          data?.msg ||
            `Không có dữ liệu file thù lao cho ngày ${budat || "(chưa truyền)"}.`
        );
        setModel(null);
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

// SAP cần YYYYMMDD. Nhận thêm DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD cho tiện dán link.
function normalizeBudat(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^\d{8}$/.test(s)) return s;

  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); // DD.MM.YYYY
  if (m) return m[3] + m[2].padStart(2, "0") + m[1].padStart(2, "0");

  m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/); // YYYY-MM-DD
  if (m) return m[1] + m[2].padStart(2, "0") + m[3].padStart(2, "0");

  return s; // để nguyên, SAP sẽ tự báo không có dữ liệu
}

// E_BASE64 có thể là chuỗi, hoặc mảng [{ BASE64 }] tuỳ FM (giống ViewFile).
function pickBase64(v) {
  if (typeof v === "string") return v || "";
  return v?.[0]?.BASE64 || v?.[0]?.E_BASE64 || "";
}

const centerBox = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export default ViewFileThuLao;
