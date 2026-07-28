import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { renderAsync as renderDocx } from "docx-preview";
import { init as initPptx } from "pptx-preview";
import * as pdfjsLib from "pdfjs-dist";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";

// Render PDF bằng canvas (pdfjs-dist) thay vì <iframe src="blob:...">.
// Iframe dùng PDF viewer gốc của Chrome, bị Chrome chặn hiển thị khi trang này
// bị nhúng lồng trong iframe của trang khác (Firefox không có hạn chế này).
pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL}/pdf.worker.min.mjs`;

// Map E_TYPE (định dạng file do SAP trả về) -> MIME type để hiển thị đúng.
// E_TYPE có thể là "PDF", "PNG", "DOCX", "application/pdf"... nên chuẩn hoá linh hoạt.
const resolveMime = (eType) => {
  const t = (eType || "").trim().toLowerCase();
  if (!t) return "";
  if (t.includes("/")) return t; // đã là MIME type đầy đủ
  switch (t.replace(/^\./, "")) {
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
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    default:
      return `application/${t}`;
  }
};

// Phân loại cách hiển thị dựa trên MIME.
const getKind = (mime) => {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("wordprocessingml") || mime === "application/msword")
    return "docx";
  if (
    mime.includes("presentationml") ||
    mime === "application/vnd.ms-powerpoint"
  )
    return "pptx";
  return "other";
};

// Chuyển chuỗi base64 -> Uint8Array (bỏ tiền tố data: và khoảng trắng/xuống dòng).
const base64ToBytes = (base64) => {
  const clean = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  const byteChars = atob(clean);
  const len = byteChars.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = byteChars.charCodeAt(i);
  return bytes;
};

const ViewFile = ({ func = "ZFM_BI_TTXD_BASE64", defaultType = "" }) => {
  const [searchParams] = useSearchParams();
  const BUDAT = searchParams.get("budat") || "";

  const [file, setFile] = useState(null); // { kind, mime, bytes, url }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const officeRef = useRef(null);

  const fetchFileBase64 = async () => {
    try {
      setLoading(true);
      setError("");

      const token = btoa(`${API_USER}:${API_PASSWORD}`);
      const body = {
        FUNC: func,
        DATA: { I_BUDAT: BUDAT },
      };

      const res = await fetch(`${BASE_URL}${API}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      const resp = data?.RESPONSE;
      const tData = resp?.E_BASE64;

      /*** 👇 LẤY FILE BASE64 TRẢ VỀ TỪ SAP 👇 ***/
      // E_BASE64 có thể là chuỗi base64 trực tiếp, hoặc mảng [{ BASE64: ... }]
      const b64 =
        typeof tData === "string"
          ? tData
          : (tData?.[0]?.BASE64 ?? tData?.[0]?.E_BASE64);

      // E_TYPE: định dạng file do SAP trả về (PDF/PNG/DOCX/PPTX...)
      const eType =
        resp?.E_TYPE ?? (Array.isArray(tData) ? tData?.[0]?.E_TYPE : undefined);

      if (b64) {
        // Ưu tiên E_TYPE từ SAP; nếu thiếu thì dùng defaultType.
        const mime =
          resolveMime(eType) ||
          resolveMime(defaultType) ||
          "application/octet-stream";
        const kind = getKind(mime);
        const bytes = base64ToBytes(b64);
        // image/other dùng object URL; pdf/docx/pptx render trực tiếp từ bytes.
        const url =
          kind === "image" || kind === "other"
            ? URL.createObjectURL(new Blob([bytes], { type: mime }))
            : null;

        setFile((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return { kind, mime, bytes, url };
        });
      } else {
        setFile((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return null;
        });
      }
    } catch (err) {
      console.error(err);
      setError("Không thể kết nối tới API hoặc dữ liệu lỗi.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFileBase64();
  }, [BUDAT, func, defaultType]);

  // Render docx/pptx/pdf vào container (vẽ trực tiếp vào DOM, không qua iframe).
  useEffect(() => {
    if (!file || !officeRef.current) return;
    if (file.kind !== "docx" && file.kind !== "pptx" && file.kind !== "pdf")
      return;

    const container = officeRef.current;
    container.innerHTML = "";
    let cancelled = false;
    let pdfDoc = null;
    let renderTasks = [];
    let rerenderTimer = null;
    const MAX_CANVAS_DIM = 6000; // giới hạn an toàn, tránh vượt kích thước canvas tối đa của browser

    // Vẽ lại toàn bộ trang PDF ở độ phân giải cao hơn khi người dùng pinch-zoom,
    // vì canvas là ảnh raster cố định nên zoom vào ảnh đã vẽ sẽ luôn bị mờ.
    const renderPdf = async (zoomFactor) => {
      if (!pdfDoc || cancelled) return;
      renderTasks.forEach((t) => t.cancel());
      renderTasks = [];
      container.innerHTML = "";
      const dpr = window.devicePixelRatio || 1;
      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        if (cancelled) break;
        const page = await pdfDoc.getPage(pageNum);
        const cssScale =
          (container.clientWidth || window.innerWidth) /
          page.getViewport({ scale: 1 }).width;
        const cssViewport = page.getViewport({ scale: cssScale });

        let renderScale = cssScale * dpr * zoomFactor;
        const rawWidth = page.getViewport({ scale: 1 }).width * renderScale;
        if (rawWidth > MAX_CANVAS_DIM) renderScale *= MAX_CANVAS_DIM / rawWidth;
        const viewport = page.getViewport({ scale: renderScale });

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
        renderTasks.push(task);
        await task.promise.catch(() => {});
      }
    };

    (async () => {
      try {
        if (file.kind === "docx") {
          await renderDocx(file.bytes, container, undefined, {
            inWrapper: true,
            className: "docx-view",
          });
        } else if (file.kind === "pptx") {
          const previewer = initPptx(container, {
            width: container.clientWidth || window.innerWidth,
            height: container.clientHeight || window.innerHeight,
          });
          await previewer.preview(file.bytes.buffer);
        } else {
          pdfDoc = await pdfjsLib.getDocument({ data: file.bytes.slice() })
            .promise;
          await renderPdf(1);
        }
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setError("Không hiển thị được nội dung file.");
        }
      }
    })();

    // Khi người dùng pinch-zoom trên điện thoại, visualViewport.scale tăng lên ->
    // vẽ lại canvas ở độ phân giải cao hơn tương ứng để chữ luôn nét.
    const vv = window.visualViewport;
    const onZoom = () => {
      clearTimeout(rerenderTimer);
      rerenderTimer = setTimeout(() => {
        const zoom = Math.min(Math.max(vv.scale || 1, 1), 5);
        renderPdf(zoom);
      }, 200);
    };
    if (file.kind === "pdf" && vv) {
      vv.addEventListener("resize", onZoom);
    }

    return () => {
      cancelled = true;
      clearTimeout(rerenderTimer);
      renderTasks.forEach((t) => t.cancel());
      if (vv) vv.removeEventListener("resize", onZoom);
    };
  }, [file]);

  // Revoke object URL khi rời trang.
  useEffect(() => {
    return () => {
      if (file?.url) URL.revokeObjectURL(file.url);
    };
  }, [file]);

  const renderFile = () => {
    if (!file) {
      return (
        !loading && (
          <div style={centerBox}>
            <span style={{ color: "#fff", fontSize: 16 }}>Không có file</span>
          </div>
        )
      );
    }

    switch (file.kind) {
      case "image":
        return (
          <img
            src={file.url}
            alt="preview"
            style={{ ...fullFill, objectFit: "contain", background: "#000" }}
          />
        );
      case "pdf":
      case "docx":
      case "pptx":
        return (
          <div
            ref={officeRef}
            style={{ ...fullFill, overflow: "auto", background: "#fff" }}
          />
        );
      default:
        return (
          <div style={centerBox}>
            <a
              href={file.url}
              download="file"
              style={{ color: "#4da3ff", fontSize: 16 }}
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
        background: "#000",
        overflow: "hidden",
      }}
    >
      {/* Hiển thị file full màn hình theo đúng định dạng */}
      {renderFile()}

      {/* Loading overlay */}
      {loading && (
        <div style={{ ...centerBox, color: "#fff", fontWeight: 500, zIndex: 3 }}>
          ⏳ Đang tải dữ liệu...
        </div>
      )}

      {/* Error overlay */}
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

export default ViewFile;
