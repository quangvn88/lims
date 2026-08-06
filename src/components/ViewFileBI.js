import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as pdfjsLib from "pdfjs-dist";
import ExcelGrid from "./ExcelGrid.jsx";
import { parseWorkbook } from "./excelModel";
import { base64ToBytes } from "../utils/common";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";

// Trang xem file BI. Gọi FM ZFM_BI_FILE_BASE64 với I_VIEW_BI + I_BUDAT, SAP trả
// { E_BASE64, E_TYPE }; FUNC này chưa có case riêng ở dispatcher LIMS nên đi
// nhánh default (callFMSAP) -> response dạng { RESPONSE: { E_BASE64, E_TYPE } }.
//
// E_TYPE thực tế nhiều lúc TRẢ RỖNG (probe với I_VIEW_BI = "" / "X" / "1" đều
// rỗng), nên khi thiếu E_TYPE thì tự nhận dạng bằng MAGIC BYTES của file
// (sniffMime) — "PK\x03\x04" + có entry "xl/" là .xlsx, "%PDF" là PDF...
//
// Hiển thị theo định dạng:
//   xlsx     -> <ExcelGrid> (lưới HTML giữ style, gộp ô, viền, định dạng số,
//               freeze pane, dòng/cột ẩn, ảnh nhúng và BIỂU ĐỒ của file gốc)
//   pdf      -> pdfjs vẽ canvas (KHÔNG dùng <iframe src="blob:">: Chrome chặn
//               PDF viewer gốc khi trang bị nhúng lồng trong iframe trang khác)
//   ảnh      -> <img>
//   xls (cũ) -> link tải: định dạng nhị phân BIFF, thư viện client không đọc được
//   còn lại  -> link tải file kèm mime để biết cần bổ sung định dạng nào
//
// I_BUDAT phải là YYYYMMDD — gửi DD.MM.YYYY thì SAP trả E_BASE64 rỗng.
// Mở qua /view-file-bi?view=<I_VIEW_BI>&date=20260719
pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL}/pdf.worker.min.mjs`;

const ViewFileBI = ({ func = "ZFM_BI_FILE_BASE64" }) => {
  const [searchParams] = useSearchParams();
  const viewBi =
    searchParams.get("view") ||
    searchParams.get("i_view_bi") ||
    searchParams.get("view_bi") ||
    "";
  const budat = toYmd(
    searchParams.get("date") || searchParams.get("budat") || ""
  );

  const [file, setFile] = useState(null); // { kind, mime, bytes, url, model }
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(""); // mô tả bước đang chạy cho overlay chờ
  const [error, setError] = useState("");
  const pdfRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setStage("Đang tải dữ liệu...");
        setError("");
        setFile(null);

        const token = btoa(`${API_USER}:${API_PASSWORD}`);
        const res = await fetch(`${BASE_URL}${API}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${token}`,
          },
          body: JSON.stringify({
            FUNC: func,
            DATA: { I_VIEW_BI: viewBi, I_BUDAT: budat },
          }),
        });

        let data = null;
        try {
          data = await res.json();
        } catch (e) {
          throw new Error(`HTTP ${res.status}`);
        }
        if (cancelled) return;

        const resp = data?.RESPONSE;
        const raw = resp?.E_BASE64;
        const b64 =
          typeof raw === "string" ? raw : raw?.[0]?.BASE64 || raw?.[0]?.E_BASE64;
        const eType =
          resp?.E_TYPE ?? (Array.isArray(raw) ? raw?.[0]?.E_TYPE : undefined);

        if (!b64) {
          setError(
            data?.msg ||
              data?.message ||
              `Không có dữ liệu file BI (view=${viewBi || "(rỗng)"}, ngày=${
                budat || "(rỗng)"
              }).`
          );
          return;
        }

        const bytes = base64ToBytes(b64);
        // E_TYPE ưu tiên; thiếu thì đoán từ nội dung file.
        const mime =
          resolveMime(eType) || sniffMime(bytes) || "application/octet-stream";
        const kind = getKind(mime);

        let model = null;
        if (kind === "xlsx") {
          setStage("Đang dựng bảng tính...");
          model = await parseWorkbook(bytes);
          if (cancelled) return;
        }

        // Chỉ ảnh và định dạng lạ cần object URL; pdf/xlsx render từ bytes.
        const url =
          kind === "image" || kind === "other" || kind === "xls"
            ? URL.createObjectURL(new Blob([bytes], { type: mime }))
            : null;

        setFile({ kind, mime, bytes, url, model });
      } catch (err) {
        console.error(err);
        if (!cancelled) setError(`Không đọc được file BI: ${err.message}`);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setStage("");
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [func, viewBi, budat]);

  // Thu hồi object URL khi đổi file / rời trang.
  useEffect(() => {
    return () => {
      if (file?.url) URL.revokeObjectURL(file.url);
    };
  }, [file]);

  // Vẽ PDF bằng canvas, vẽ lại khi cửa sổ đổi kích thước hoặc pinch-zoom.
  useEffect(() => {
    if (!file || file.kind !== "pdf" || !pdfRef.current) return;

    const container = pdfRef.current;
    let cancelled = false;
    let pdfDoc = null;
    let tasks = [];
    let timer = null;
    const MAX_CANVAS_DIM = 6000; // tránh vượt kích thước canvas tối đa của browser

    const draw = async (zoom) => {
      if (!pdfDoc || cancelled) return;
      tasks.forEach((t) => t.cancel());
      tasks = [];
      container.innerHTML = "";
      const dpr = window.devicePixelRatio || 1;
      for (let p = 1; p <= pdfDoc.numPages; p++) {
        if (cancelled) break;
        const page = await pdfDoc.getPage(p);
        const base = page.getViewport({ scale: 1 });
        const cssScale = (container.clientWidth || window.innerWidth) / base.width;
        const cssViewport = page.getViewport({ scale: cssScale });

        let scale = cssScale * dpr * zoom;
        if (base.width * scale > MAX_CANVAS_DIM)
          scale *= MAX_CANVAS_DIM / (base.width * scale);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${cssViewport.width}px`;
        canvas.style.height = `${cssViewport.height}px`;
        canvas.style.display = "block";
        canvas.style.margin = "0 auto 8px";
        container.appendChild(canvas);

        const task = page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
        });
        tasks.push(task);
        await task.promise.catch(() => {});
      }
    };

    (async () => {
      try {
        pdfDoc = await pdfjsLib.getDocument({ data: file.bytes.slice() })
          .promise;
        await draw(1);
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setError("Không hiển thị được nội dung PDF.");
        }
      }
    })();

    const vv = window.visualViewport;
    const onZoom = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => draw(Math.min(Math.max(vv?.scale || 1, 1), 5)),
        200
      );
    };
    if (vv) vv.addEventListener("resize", onZoom);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      tasks.forEach((t) => t.cancel());
      if (vv) vv.removeEventListener("resize", onZoom);
    };
  }, [file]);

  const renderFile = () => {
    if (!file) return null;

    switch (file.kind) {
      case "xlsx":
        return (
          <div style={{ ...fullFill, background: "#fff" }}>
            {file.model && <ExcelGrid model={file.model} />}
          </div>
        );
      case "pdf":
        return (
          <div
            ref={pdfRef}
            style={{ ...fullFill, overflow: "auto", background: "#fff" }}
          />
        );
      case "image":
        return (
          <img
            src={file.url}
            alt="BI"
            style={{ ...fullFill, objectFit: "contain", background: "#000" }}
          />
        );
      case "xls":
        return (
          <div style={{ ...centerBox, flexDirection: "column", gap: 10 }}>
            <span style={{ color: "#333", fontSize: 15, textAlign: "center" }}>
              File Excel định dạng cũ (.xls) không xem trực tiếp được trên web.
              <br />
              Hãy lưu lại thành .xlsx để xem đầy đủ định dạng.
            </span>
            <a
              href={file.url}
              download="bi-file.xls"
              style={{ color: "#0d6efd", fontSize: 16 }}
            >
              ⬇️ Tải file về
            </a>
          </div>
        );
      default:
        return (
          <div style={centerBox}>
            <a
              href={file.url}
              download="bi-file"
              style={{ color: "#0d6efd", fontSize: 16 }}
            >
              ⬇️ Tải file về ({file.mime || "không rõ định dạng"})
            </a>
          </div>
        );
    }
  };

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
      {renderFile()}

      {loading && (
        <div style={{ ...centerBox, color: "#333", fontWeight: 500, zIndex: 3 }}>
          ⏳ {stage || "Đang tải dữ liệu..."}
        </div>
      )}

      {!loading && !file && !error && (
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

// SAP cần YYYYMMDD. Nhận thêm DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD.
function toYmd(v) {
  const s = String(v || "").trim();
  if (!s || /^\d{8}$/.test(s)) return s;
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return m[3] + m[2].padStart(2, "0") + m[1].padStart(2, "0");
  m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (m) return m[1] + m[2].padStart(2, "0") + m[3].padStart(2, "0");
  return s;
}

// E_TYPE ("XLSX", "PDF", "PNG"... hoặc mime đầy đủ) -> mime.
function resolveMime(eType) {
  const t = String(eType || "")
    .trim()
    .toLowerCase();
  if (!t) return "";
  if (t.includes("/")) return t;
  switch (t.replace(/^\./, "")) {
    case "xlsx":
    case "xlsm":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "xls":
      return "application/vnd.ms-excel";
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    default:
      return `application/${t}`;
  }
}

/**
 * Nhận dạng định dạng bằng MAGIC BYTES khi SAP không trả E_TYPE.
 * .xlsx/.docx/.pptx đều là zip nên phải soi thêm tên entry bên trong.
 */
function sniffMime(bytes) {
  if (!bytes || bytes.length < 4) return "";
  const b = bytes;
  const is = (...sig) => sig.every((v, i) => b[i] === v);

  if (is(0x25, 0x50, 0x44, 0x46)) return "application/pdf"; // %PDF
  if (is(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (is(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (is(0x47, 0x49, 0x46, 0x38)) return "image/gif"; // GIF8
  if (is(0x42, 0x4d)) return "image/bmp";
  if (
    is(0x52, 0x49, 0x46, 0x46) &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return "image/webp";
  // OLE2 (Compound File) = Office nhị phân cũ: .xls/.doc/.ppt
  if (is(0xd0, 0xcf, 0x11, 0xe0)) return "application/vnd.ms-excel";
  // ZIP -> OOXML: tìm tên entry trong local header (đầu file) và central directory (cuối file)
  if (is(0x50, 0x4b, 0x03, 0x04)) {
    const probe = latin1(b, 0, 65536) + latin1(b, Math.max(0, b.length - 65536), 65536);
    if (probe.includes("word/document.xml"))
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (probe.includes("ppt/presentation.xml"))
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    // Mặc định coi zip là workbook (file BI luôn là bảng tính).
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "";
}
function latin1(bytes, start, len) {
  const end = Math.min(bytes.length, start + len);
  let s = "";
  const CHUNK = 0x4000;
  for (let i = start; i < end; i += CHUNK) {
    s += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(end, i + CHUNK))
    );
  }
  return s;
}

function getKind(mime) {
  if (mime.includes("spreadsheetml")) return "xlsx";
  if (mime === "application/vnd.ms-excel") return "xls";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  return "other";
}

const fullFill = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

const centerBox = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export default ViewFileBI;
