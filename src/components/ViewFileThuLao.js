import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ExcelGrid from "./ExcelGrid.jsx";
import { fetchExcelModel, toYmd } from "./excelFileResponse";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";

// Trang xem file thù lao render bằng HTML <table> thuần qua <ExcelGrid>.
// Cùng UI/luồng với ViewFileDHN, chỉ khác FUNC = ZFM_THULAO_FILE_BASE64.
//
// Toàn bộ phần "gọi API -> chọn nhánh base64 hay sheets -> dựng model" nằm ở
// `excelFileResponse.fetchExcelModel` dùng chung với ViewFileDHN, để hai trang
// không trôi lệch nhau. Bản trước của file này xếp nhánh `{success, sheets}`
// LÊN TRƯỚC base64 — đúng cái bẫy đã làm /view-file-dhn mất cột ẩn + freeze pane
// khi gateway đăng ký case parse ở server. Hiện gateway CHƯA có case cho
// ZFM_THULAO_FILE_BASE64 (đo 06/08/2026: cả /dev lẫn /prd đều trả
// { RESPONSE: { E_BASE64, E_TYPE:"xlsx" } }, prd b64len 19.296 cho budat
// 20260804) nên trang vẫn đang đúng — nhưng sẽ hỏng ngay khi backend thêm case.
//
// I_BUDAT phải là YYYYMMDD — gửi DD.MM.YYYY thì SAP trả E_BASE64 rỗng.
// Mở qua /view-file-thulao?date=20260804 (nhận cả 04.08.2026 / 04/08/2026 / 2026-08-04)
const ViewFileThuLao = ({ func = "ZFM_THULAO_FILE_BASE64" }) => {
  const [searchParams] = useSearchParams();
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
          label: "view-file-thulao",
        });
        if (cancelled) return;

        if (r.model) {
          setModel(r.model);
          return;
        }

        if (r.eType && !r.eType.includes("xls")) {
          setError(
            `File thù lao định dạng "${r.eType}" không hiển thị được ở dạng lưới Excel.`
          );
          return;
        }

        console.warn("[view-file-thulao] response:", r.data);
        setError(
          r.data?.msg ||
            r.data?.message ||
            `Không có dữ liệu file thù lao cho ngày ${budat || "(chưa truyền)"}.`
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

export default ViewFileThuLao;
