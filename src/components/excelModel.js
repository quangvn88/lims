// Đọc .xlsx (bytes) -> JSON model cho <ExcelGrid> render, giữ nguyên định dạng
// của file gốc: giá trị ĐÃ ÁP numFmt, style, gộp ô, viền, conditional formatting
// "nướng" thẳng vào CSS từng ô, dòng/cột ẩn, freeze pane, ảnh nhúng và biểu đồ.
//
// Chạy HOÀN TOÀN ở client bằng ExcelJS (bản lims không có server parse).
// ExcelJS được import ĐỘNG để không nặng bundle chính (~1MB, chỉ tải khi mở
// trang xem Excel).
//
// Model trả về:
//   { sheets: [{
//       name, colCount, cols[], colHidden[], rowHidden[],
//       freeze: { rows, cols } | null,
//       rows: [{ h, cells: [{ r, c, rowspan, colspan, text, css }] }],
//       images: [{ src, from:{col,row,colOff,rowOff}, to, size }],
//       charts: [{ from, to, size, chart }],
//   }] }
//
// Hai phần ExcelJS KHÔNG làm được, xử lý riêng:
//   - Định dạng số   -> ../utils/excelNumFmt (ExcelJS chỉ trả giá trị thô)
//   - Biểu đồ + ảnh  -> ./excelChartXml (ExcelJS không đọc chart, và sập khi
//                       drawing dùng namespace mặc định)

import { formatCellValue, cellRawValue } from "../utils/excelNumFmt";
import { parseDrawings, stripDrawings } from "./excelChartXml";

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Bảng màu theme mặc định của Office. File .xlsx rất hay dùng màu theme
// (font/fill khai `{ theme: 4, tint: 0.4 }` chứ không có argb) — nếu bỏ qua thì
// mất hết màu chữ/nền, đây là nguyên nhân phổ biến nhất làm lưới "nhạt" hơn gốc.
// Bảng màu theme MẶC ĐỊNH của Office (bộ "Office 2013+"). CHỈ dùng khi file
// không kèm xl/theme/theme1.xml — còn lại luôn đọc bảng màu THẬT trong file.
//
// Vì sao bắt buộc phải đọc từ file: file do SAP sinh ra dùng bộ theme Office
// 2007-2010, khác hẳn bảng dưới đây ở đúng những chỉ số đang được dùng:
//   accent5 (chỉ số 8): file #4bacc6  <-> mặc định #5b9bd5
//   accent6 (chỉ số 9): file #f79646  <-> mặc định #70ad47
// Biểu TỒN KHO tô nền cột "Tổng Xăng/DO/FO" bằng accent5 tint 0,8 và tô dòng
// mã "T" bằng accent6 tint 0,8 -> lấy bảng cứng thì ra xanh dương + xanh lá,
// trong khi Excel hiện xanh ngọc + cam nhạt.
const DEFAULT_THEME_COLORS = [
  "#ffffff", // 0 lt1 / bg1
  "#000000", // 1 dk1 / tx1
  "#e7e6e6", // 2 lt2 / bg2
  "#44546a", // 3 dk2 / tx2
  "#4472c4", // 4 accent1
  "#ed7d31", // 5 accent2
  "#a5a5a5", // 6 accent3
  "#ffc000", // 7 accent4
  "#5b9bd5", // 8 accent5
  "#70ad47", // 9 accent6
  "#0563c1", // 10 hlink
  "#954f72", // 11 folHlink
];

// Bảng màu theme của workbook ĐANG parse. Đặt ở mức module vì `argb()` được gọi
// từ rất nhiều chỗ; `parseWorkbook` gán lại ngay đầu mỗi lần chạy.
let THEME_COLORS = DEFAULT_THEME_COLORS;

/**
 * Đọc <a:clrScheme> trong xl/theme/theme1.xml thành bảng màu theo ĐÚNG chỉ số
 * mà styles.xml dùng ở thuộc tính theme="n".
 *
 * BẪY: thứ tự trong XML là dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink —
 * NHƯNG chỉ số theme của Excel lại ĐẢO hai cặp đầu: 0=lt1, 1=dk1, 2=lt2, 3=dk2.
 * Lấy thẳng thứ tự XML là sai màu chữ/nền.
 * Màu có thể khai bằng <a:srgbClr val="..."/> hoặc <a:sysClr lastClr="..."/>.
 */
function parseThemeColors(xml) {
  const m = /<a:clrScheme[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(xml || "");
  if (!m) return null;
  const byName = {};
  const re =
    /<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>[\s\S]*?(?:srgbClr val="([0-9A-Fa-f]{6})"|sysClr[^>]*lastClr="([0-9A-Fa-f]{6})")/g;
  let e;
  while ((e = re.exec(m[1])))
    byName[e[1]] = "#" + (e[2] || e[3]).toLowerCase();
  const order = [
    "lt1",
    "dk1",
    "lt2",
    "dk2",
    "accent1",
    "accent2",
    "accent3",
    "accent4",
    "accent5",
    "accent6",
    "hlink",
    "folHlink",
  ];
  const out = order.map((k, i) => byName[k] || DEFAULT_THEME_COLORS[i]);
  return Object.keys(byName).length ? out : null;
}

/** Áp tint của OOXML (xấp xỉ trên RGB, đủ chính xác cho việc xem file). */
function applyTint(hex, tint) {
  if (!tint) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    tint < 0
      ? Math.round(c * (1 + tint))
      : Math.round(c * (1 - tint) + 255 * tint)
  );
  return (
    "#" +
    ch.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("")
  );
}

/** Màu ExcelJS ({argb} | {theme,tint} | {indexed}) -> "#rrggbb". */
function argb(c) {
  if (!c) return null;
  if (c.argb) {
    const a = String(c.argb);
    // Bỏ 2 ký tự alpha đầu. KHÔNG được coi alpha 00 là "trong suốt": openpyxl và
    // nhiều bộ sinh file ghi màu đỏ là "00FF0000", còn Excel thì bỏ qua alpha.
    return "#" + (a.length === 8 ? a.slice(2) : a).toLowerCase();
  }
  if (c.theme != null) {
    const base = THEME_COLORS[c.theme];
    if (base) return applyTint(base, c.tint || 0);
  }
  return null;
}

/**
 * Đọc công thức của conditional formatting kiểu `expression` thành danh sách
 * điều kiện "so ô mốc với một chuỗi". Trả về null nếu gặp dạng chưa hỗ trợ —
 * khi đó rule bị bỏ qua chứ không tô sai.
 *
 * Hai dạng đang gặp trong biểu TỒN KHO DỰ TRỮ LƯU THÔNG:
 *   $A7="T"                              -> mốc theo DÒNG: cột A cố định, dòng trôi
 *                                           theo ô đang xét (tô cả dòng theo mã T/B/I/M/F/R).
 *   AND(D$6="Tổng Xăng", $D6<>"")        -> mốc theo CỘT: dòng 6 (tiêu đề) cố định,
 *                                           cột trôi theo ô đang xét; kèm điều kiện
 *                                           cột D của dòng đó không rỗng.
 *                                           Đây là cách tô nền xanh cho các cột
 *                                           "Tổng Xăng" / "Tổng DO" / "Tổng FO".
 * Dấu $ đứng trước CỘT hay trước DÒNG quyết định phần nào cố định — đọc đúng chỗ
 * này mới ra được cả hai dạng bằng một bộ máy.
 */
function parseCfConds(formula) {
  const s = String(formula || "").trim();
  const and = s.match(/^AND\s*\(([\s\S]*)\)$/i);
  const parts = and ? splitTopLevelArgs(and[1]) : [s];
  const conds = [];
  for (const p of parts) {
    // $?COL$?ROW  ( = | <> )  "chuỗi"
    const m = p.trim().match(/^(\$?)([A-Z]+)(\$?)(\d+)\s*(<>|=)\s*"([\s\S]*)"$/);
    if (!m) return null;
    conds.push({
      colAbs: m[1] === "$",
      col: colLetterToNum(m[2]),
      rowAbs: m[3] === "$",
      row: +m[4],
      neq: m[5] === "<>",
      value: m[6],
    });
  }
  return conds.length ? conds : null;
}

/** Cắt tham số của AND(...) theo dấu phẩy, BỎ QUA phẩy nằm trong "..." hoặc (). */
function splitTopLevelArgs(s) {
  const out = [];
  let cur = "";
  let q = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') q = !q;
    else if (!q && ch === "(") depth++;
    else if (!q && ch === ")") depth--;
    if (ch === "," && !q && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function colLetterToNum(s) {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
// xSplit/ySplit của freeze pane -> chỉ số 1-based của cột/dòng CUỐI CÙNG trong
// khối ghim.
//
// Theo ECMA-376, khi state="frozen" thì xSplit là "số cột NHÌN THẤY trong pane
// bên trái", KHÔNG phải chỉ số cột. Nên khi có cột ẩn nằm trước biên ghim, hai
// con số lệch nhau: file thù lao ẩn cột A rồi ghim tới hết cột B, Excel ghi
// xSplit="1" (chỉ B là cột hiện) kèm <pane topLeftCell="C10"/> — C10 là ô đầu
// của vùng CHƯA ghim, tức khối ghim đúng là A+B.
// `hidden[i]` = true nếu cột/dòng thứ i+1 bị ẩn. File không có cột/dòng ẩn
// trước biên thì hàm trả về đúng `split` -> các file cũ (DHN) không đổi.
export function visibleSplitToIndex(split, hidden, count) {
  const n = Number(split) || 0;
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 1; i <= count; i++) {
    if (!(hidden && hidden[i - 1])) seen++;
    if (seen >= n) return i;
  }
  // Ghim nhiều hơn số cột/dòng đang hiện: ghim tới hết vùng dữ liệu.
  return Math.max(count, n);
}

function parseRange(r) {
  const m = String(r).match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
  if (!m) return null;
  return {
    c1: colLetterToNum(m[1]),
    r1: +m[2],
    c2: colLetterToNum(m[3]),
    r2: +m[4],
  };
}
// 1 cạnh viền ExcelJS { style:'thin', color:{argb} } -> "1px solid #000".
// dxf của conditional formatting dùng <color auto="1"/> => không có argb -> mặc định đen.
function edgeCss(e) {
  if (!e || !e.style) return null;
  const col = argb(e.color) || "#000";
  const w = e.style === "thick" || e.style === "medium" ? "2px" : "1px";
  const ty =
    e.style === "dotted" ? "dotted" : e.style === "dashed" ? "dashed" : "solid";
  return w + " " + ty + " " + col;
}
// Độ "mạnh" của 1 cạnh viền, dùng khi 2 ô kề nhau khai cùng 1 cạnh -> lấy cạnh mạnh hơn.
function edgeRank(e) {
  if (!e || !e.style) return 0;
  if (e.style === "thick") return 4;
  if (e.style === "medium" || e.style === "double") return 3;
  if (e.style === "dotted" || e.style === "hair") return 1;
  return 2; // thin, dashed...
}

// Cả 4 cạnh -> chuỗi CSS. Dùng chung cho style của ô và cho dxf của CF.
function borderCss(bd) {
  if (!bd) return "";
  let s = "";
  const sides = [
    ["top", "border-top"],
    ["left", "border-left"],
    ["bottom", "border-bottom"],
    ["right", "border-right"],
  ];
  for (const [k, prop] of sides) {
    const v = edgeCss(bd[k]);
    if (v) s += prop + ":" + v + ";";
  }
  return s;
}

// numFmt 4 vùng: duong;am;khong;text. Vung "khong" rong => Excel an gia tri 0.
// vd "0;;;" hoac ";;;" -> true.
function numFmtHidesZero(fmt) {
  if (!fmt) return false;
  // ExcelJS trả numFmt của dxf dạng object { id, formatCode }, của cell dạng chuỗi.
  const code = typeof fmt === "object" ? fmt.formatCode : fmt;
  if (!code) return false;
  const parts = String(code).split(";");
  return parts.length >= 3 && parts[2].trim() === "";
}

// Lay gia tri so cua o (ke ca o cong thuc) -> null neu khong phai so.
function numVal(cell) {
  if (!cell) return null;
  const v = cellRawValue(cell.value);
  return typeof v === "number" ? v : null;
}

/** Chuỗi thô của ô, dùng để so sánh điều kiện của conditional formatting. */
function rawVal(cell) {
  if (!cell || cell.value == null) return "";
  const v = cellRawValue(cell.value);
  if (v == null) return "";
  if (typeof v === "object") return v.error ? String(v.error) : "";
  return String(v);
}

// -------------------------------------------- số liệu nguồn cho biểu đồ -------

/**
 * Lấy số liệu của biểu đồ khi file KHÔNG ghi cache (c:numCache/c:strCache).
 * Excel luôn ghi cache, nhưng file do openpyxl/POI sinh ra thì không -> chart sẽ
 * rỗng nếu không tự đọc lại vùng ô mà series trỏ tới.
 * @param wb workbook ExcelJS
 * @param ref "'T08.2026'!$D$5:$D$8"
 */
function readRange(wb, ref, numeric) {
  if (!ref) return null;
  const areas = String(ref).split(",");
  const out = [];
  for (const area of areas) {
    const bang = area.lastIndexOf("!");
    if (bang < 0) continue;
    let sheetName = area.slice(0, bang).trim();
    if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
      sheetName = sheetName.slice(1, -1).replace(/''/g, "'");
    }
    const ws = wb.getWorksheet(sheetName);
    if (!ws) continue;
    const addr = area.slice(bang + 1).replace(/\$/g, "").toUpperCase();
    const m = addr.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
    if (!m) continue;
    const c1 = colLetterToNum(m[1]);
    const r1 = +m[2];
    const c2 = m[3] ? colLetterToNum(m[3]) : c1;
    const r2 = m[4] ? +m[4] : r1;
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
        const cell = ws.getRow(r).getCell(c);
        const v = cellRawValue(cell.value);
        if (numeric) {
          out.push(typeof v === "number" ? v : null);
        } else {
          out.push(
            v == null || (typeof v === "object" && !(v instanceof Date))
              ? ""
              : formatCellValue(cell.value, cell.numFmt).text
          );
        }
      }
    }
  }
  return out.length ? out : null;
}

/** Bù số liệu/nhãn còn thiếu của mọi series trong chart từ vùng ô nguồn. */
function fillChartData(wb, charts) {
  for (const item of charts) {
    for (const plot of item.chart.plots || []) {
      for (const ser of plot.series || []) {
        if (ser.val && !ser.val.values.some((v) => v != null)) {
          const v = readRange(wb, ser.val.ref, true);
          if (v) ser.val.values = v;
        }
        if (ser.cat && !ser.cat.values.some((v) => v != null && v !== "")) {
          const v = readRange(wb, ser.cat.ref, false);
          if (v) ser.cat.values = v;
        }
        if (ser.xVal && !ser.xVal.values.some((v) => v != null)) {
          const v = readRange(wb, ser.xVal.ref, true);
          if (v) ser.xVal.values = v;
        }
        if (!ser.name && ser.nameRef) {
          const v = readRange(wb, ser.nameRef, false);
          if (v) ser.name = v.filter(Boolean).join(" ");
        }
      }
    }
  }
}

// ------------------------------------------------------------ ảnh nhúng -------

function bytesToBase64(buf) {
  const u8 =
    buf instanceof Uint8Array
      ? buf
      : new Uint8Array(buf.buffer ? buf.buffer : buf);
  let s = "";
  const CHUNK = 0x8000; // chia nhỏ để không tràn stack với ảnh lớn
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

const EMU_PER_PX = 9525;

/**
 * ws.getImages() + wb.getImage() -> [{ src, from, to, size }]
 * Chỉ dùng làm PHƯƠNG ÁN DỰ PHÒNG: ảnh chính lấy từ excelChartXml.parseDrawings
 * (đọc thẳng zip, không phụ thuộc prefix `xdr:` như ExcelJS).
 */
function readImages(wb, ws) {
  let list = [];
  try {
    list = ws.getImages ? ws.getImages() || [] : [];
  } catch (e) {
    return [];
  }
  const out = [];
  for (const im of list) {
    try {
      const media = wb.getImage(im.imageId);
      if (!media || !media.buffer) continue;
      const ext = (media.extension || "png").toLowerCase();
      const mime =
        ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "gif"
            ? "image/gif"
            : ext === "svg"
              ? "image/svg+xml"
              : "image/" + ext;
      const rng = im.range || {};
      const tl = rng.tl || {};
      const br = rng.br || null;
      out.push({
        src: `data:${mime};base64,${bytesToBase64(media.buffer)}`,
        from: {
          col: tl.nativeCol != null ? tl.nativeCol : Math.floor(tl.col || 0),
          row: tl.nativeRow != null ? tl.nativeRow : Math.floor(tl.row || 0),
          colOff: Math.round((tl.nativeColOff || 0) / EMU_PER_PX),
          rowOff: Math.round((tl.nativeRowOff || 0) / EMU_PER_PX),
        },
        to: br
          ? {
              col: br.nativeCol != null ? br.nativeCol : Math.floor(br.col || 0),
              row: br.nativeRow != null ? br.nativeRow : Math.floor(br.row || 0),
              colOff: Math.round((br.nativeColOff || 0) / EMU_PER_PX),
              rowOff: Math.round((br.nativeRowOff || 0) / EMU_PER_PX),
            }
          : null,
        size: rng.ext
          ? {
              w: Math.round(rng.ext.width),
              h: Math.round(rng.ext.height),
            }
          : null,
      });
    } catch (e) {
      /* ảnh lỗi thì bỏ qua, không làm sập cả file */
    }
  }
  return out;
}

// ------------------------------------------------------------------ main ------

/**
 * @param {Uint8Array|ArrayBuffer} bytes nội dung file .xlsx
 * @returns {Promise<{sheets: Array}>}
 */
/** Lấy bảng màu theme từ xl/theme/theme1.xml trong zip; null nếu không có. */
async function readThemeColors(bytes) {
  try {
    const JSZip = (await import("jszip")).default || (await import("jszip"));
    const ab =
      bytes instanceof ArrayBuffer
        ? bytes
        : bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          );
    const zip = await JSZip.loadAsync(ab);
    // Tên file theme không cố định là theme1.xml -> quét cả thư mục.
    const f =
      zip.file("xl/theme/theme1.xml") ||
      zip.file(/^xl\/theme\/theme\d*\.xml$/)[0];
    if (!f) return null;
    return parseThemeColors(await f.async("string"));
  } catch (e) {
    console.warn("[excelModel] không đọc được theme màu:", e && e.message);
    return null;
  }
}

// ExcelJS đọc `<b val="0"/>` thành bold:true — BooleanXform của nó chỉ xét sự CÓ
// MẶT của thẻ và bỏ qua attribute `val`. Với style tĩnh thì gần như vô hại (Excel
// chỉ ghi `<b/>` khi ô thật sự đậm), nhưng dxf của conditional formatting lại
// dùng `val="0"` để TẮT: `<font><b val="0"/><i/></font>` nghĩa là "in nghiêng,
// KHÔNG đậm". Hiểu sai thành đậm+nghiêng làm mọi ô bị CF phủ đều bôi đậm/nghiêng
// sai so với file gốc.
//
// -> Đọc lại xl/styles.xml để lấy đúng 3 trạng thái: true = bật, false = TẮT
// (phải đè style tĩnh của ô), undefined = dxf không khai (giữ style của ô).
// Khớp ngược về từng rule theo (tên sheet, priority): ExcelJS không trả dxfId,
// còn priority thì duy nhất trong một sheet.
/** @returns {Promise<Object|null>} { [tênSheet]: { [priority]: {bold, italic} } } */
async function readCfFontFlags(bytes) {
  try {
    const JSZip = (await import("jszip")).default || (await import("jszip"));
    const ab =
      bytes instanceof ArrayBuffer
        ? bytes
        : bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          );
    const zip = await JSZip.loadAsync(ab);
    const parser = new DOMParser();
    const readXml = async (path) => {
      const f = zip.file(path);
      if (!f) return null;
      const doc = parser.parseFromString(
        await f.async("string"),
        "application/xml"
      );
      return doc.getElementsByTagName("parsererror").length ? null : doc;
    };

    const stylesDoc = await readXml("xl/styles.xml");
    const dxfs = stylesDoc && stylesDoc.getElementsByTagName("dxfs")[0];
    if (!dxfs) return null;
    // Boolean của OOXML: thiếu `val` = true; "0"/"false" = false.
    const flagOf = (el) => {
      if (!el) return undefined;
      const v = el.getAttribute("val");
      return v == null || v === "" ? true : v !== "0" && v !== "false";
    };
    const dxfFlags = [];
    const dxfList = dxfs.getElementsByTagName("dxf");
    for (let i = 0; i < dxfList.length; i++) {
      const fo = dxfList[i].getElementsByTagName("font")[0];
      dxfFlags.push({
        bold: fo ? flagOf(fo.getElementsByTagName("b")[0]) : undefined,
        italic: fo ? flagOf(fo.getElementsByTagName("i")[0]) : undefined,
      });
    }

    const wbDoc = await readXml("xl/workbook.xml");
    const relsDoc = await readXml("xl/_rels/workbook.xml.rels");
    if (!wbDoc || !relsDoc) return null;
    const rels = {};
    const relEls = relsDoc.getElementsByTagName("Relationship");
    for (let i = 0; i < relEls.length; i++) {
      rels[relEls[i].getAttribute("Id")] = relEls[i].getAttribute("Target");
    }

    const out = {};
    const sheetEls = wbDoc.getElementsByTagName("sheet");
    for (let i = 0; i < sheetEls.length; i++) {
      const target = rels[sheetEls[i].getAttribute("r:id")];
      if (!target) continue;
      // Target thường là "worksheets/sheet1.xml" (tương đối với xl/), nhưng có
      // file ghi tuyệt đối "/xl/worksheets/sheet1.xml".
      let path = String(target).replace(/^\.\//, "");
      path = path.startsWith("/")
        ? path.slice(1)
        : path.startsWith("xl/")
          ? path
          : "xl/" + path;
      const shDoc = await readXml(path);
      if (!shDoc) continue;
      const byPriority = {};
      const rules = shDoc.getElementsByTagName("cfRule");
      for (let k = 0; k < rules.length; k++) {
        const pri = rules[k].getAttribute("priority");
        const dxfId = rules[k].getAttribute("dxfId");
        if (pri == null || dxfId == null) continue;
        const fl = dxfFlags[+dxfId];
        if (fl) byPriority[pri] = fl;
      }
      out[sheetEls[i].getAttribute("name") || ""] = byPriority;
    }
    return out;
  } catch (e) {
    console.warn(
      "[excelModel] không đọc được dxf của conditional formatting:",
      e && e.message
    );
    return null;
  }
}

export async function parseWorkbook(bytes) {
  const ExcelJS = (await import("exceljs")).default || (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  // ExcelJS (bản browser) nhận ArrayBuffer.
  const ab =
    bytes instanceof ArrayBuffer
      ? bytes
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  // Chart + ảnh đọc trực tiếp từ zip (ExcelJS không đọc được chart). Làm TRƯỚC
  // khi nạp ExcelJS vì ExcelJS có thể sửa/consume buffer.
  const drawingsBySheet = await parseDrawings(bytes);

  // Bảng màu theme phải lấy từ CHÍNH FILE (ExcelJS không expose clrScheme).
  // Không đọc thì mọi màu khai kiểu theme="n" đều sai — xem chú thích ở
  // DEFAULT_THEME_COLORS.
  THEME_COLORS = (await readThemeColors(bytes)) || DEFAULT_THEME_COLORS;

  // bold/italic thật của dxf conditional formatting (ExcelJS đọc sai `val="0"`).
  const cfFontFlags = (await readCfFontFlags(bytes)) || {};

  try {
    await wb.xlsx.load(ab);
  } catch (e) {
    // ExcelJS 4.4.0 ném lỗi khi drawing khai namespace mặc định (`<wsDr>`), gặp
    // ở file do openpyxl/POI sinh ra. Bỏ drawing rồi nạp lại: bảng vẫn đầy đủ,
    // ảnh/chart đã đọc xong ở trên nên không mất.
    console.warn("[excelModel] nạp lại sau khi bỏ drawing:", e && e.message);
    await wb.xlsx.load(await stripDrawings(bytes));
  }

  for (const name of Object.keys(drawingsBySheet)) {
    fillChartData(wb, drawingsBySheet[name].charts || []);
  }

  const sheets = [];

  wb.eachSheet((ws) => {
    // gộp ô
    const merges = (ws.model && ws.model.merges) || [];
    const master = {};
    const covered = {};
    merges.forEach((rng) => {
      const p = parseRange(rng);
      if (!p) return;
      master[p.r1 + "_" + p.c1] = { rs: p.r2 - p.r1 + 1, cs: p.c2 - p.c1 + 1 };
      for (let r = p.r1; r <= p.r2; r++)
        for (let c = p.c1; c <= p.c2; c++)
          if (!(r === p.r1 && c === p.c1)) covered[r + "_" + c] = 1;
    });

    // conditional formatting kiểu biểu thức $COL{row}="value"
    const cfRules = [];
    // conditional formatting kiểu numFmt "0;;;" (ẩn ô có giá trị 0)
    const zeroRules = [];
    (ws.conditionalFormattings || []).forEach((g) => {
      const refs = String(g.ref || "")
        .split(/\s+/)
        .map(parseRange)
        .filter(Boolean);
      if (!refs.length) return;
      (g.rules || []).forEach((rule) => {
        if (rule.type !== "expression" || !rule.formulae || !rule.formulae[0])
          return;
        const st = rule.style || {};

        // Rule dạng =C10:I10=0 + dxf numFmt "0;;;" -> ô bằng 0 để trống.
        // Không cần eval công thức vì nó tự tham chiếu chính ô đang xét.
        if (
          numFmtHidesZero(st.numFmt) &&
          /=\s*0\s*$/.test(String(rule.formulae[0]))
        ) {
          zeroRules.push(refs);
          return;
        }

        const conds = parseCfConds(rule.formulae[0]);
        if (!conds) return;
        let css = "";
        if (st.font) {
          // Lấy bold/italic đọc lại từ file nếu có (xem readCfFontFlags);
          // false = dxf TẮT hẳn -> phải khai 400/normal để đè style của ô.
          const fl = (cfFontFlags[ws.name] || {})[String(rule.priority)];
          const bold = fl ? fl.bold : st.font.bold;
          const italic = fl ? fl.italic : st.font.italic;
          if (bold === true) css += "font-weight:600;";
          else if (bold === false) css += "font-weight:400;";
          if (italic === true) css += "font-style:italic;";
          else if (italic === false) css += "font-style:normal;";
          const fc = argb(st.font.color);
          if (fc) css += "color:" + fc + ";";
        }
        if (st.fill && st.fill.pattern !== "none") {
          const bg = argb(st.fill.bgColor) || argb(st.fill.fgColor);
          if (bg) css += "background:" + bg + ";";
        }
        // Đường kẻ của dxf (vd rule vàng $A="Y" có thin border 4 cạnh) KHÔNG gộp
        // vào css ở đây: nó được đưa vào bảng cạnh (hEdge/vEdge) cùng với viền
        // tĩnh của ô, để cạnh nào cũng được khai ở cả 2 ô kề nhau.
        if (!css && !st.border) return;
        cfRules.push({
          refs,
          conds,
          priority: rule.priority == null ? 9999 : +rule.priority,
          css,
          bd: st.border || null,
        });
      });
    });
    // Excel: priority nhỏ = ưu tiên cao. CSS thì khai báo sau thắng
    // -> xếp priority giảm dần để rule ưu tiên cao được ghi cuối.
    cfRules.sort((a, b) => b.priority - a.priority);
    // Một rule CF quét lại vài ô mốc cho MỌI ô trong vùng (vùng hay khai tới
    // hàng 3000) -> nhớ lại text của ô mốc, nếu không sẽ gọi getCell hàng trăm
    // nghìn lần cho một sheet vài trăm dòng.
    const markerCache = new Map();
    const markerText = (rr, cc) => {
      const k = rr + "_" + cc;
      let v = markerCache.get(k);
      if (v === undefined) {
        v = rawVal(ws.getRow(rr).getCell(cc)).trim();
        markerCache.set(k, v);
      }
      return v;
    };

    // Các rule CF đang khớp ô (r,c), theo thứ tự ưu tiên tăng dần (cuối = thắng).
    const cfHits = (r, c) => {
      const hits = [];
      for (const rl of cfRules) {
        let fr = null;
        let fc = null;
        for (const rf of rl.refs)
          if (c >= rf.c1 && c <= rf.c2 && r >= rf.r1 && r <= rf.r2) {
            fr = rf.r1;
            fc = rf.c1;
            break;
          }
        if (fr === null) continue;
        // Toạ độ tương đối được dịch theo GÓC TRÊN-TRÁI của vùng, đúng như Excel:
        // ô mốc $A7 (cột tuyệt đối) -> luôn cột A, dòng trôi theo ô đang xét;
        // ô mốc D$6 (dòng tuyệt đối) -> luôn dòng 6, cột trôi theo ô đang xét.
        let ok = true;
        for (const cd of rl.conds) {
          const cc = cd.colAbs ? cd.col : cd.col + (c - fc);
          const rr = cd.rowAbs ? cd.row : cd.row + (r - fr);
          if (rr < 1 || cc < 1) {
            ok = false;
            break;
          }
          const eq = markerText(rr, cc) === cd.value;
          if (cd.neq ? eq : !eq) {
            ok = false;
            break;
          }
        }
        if (ok) hits.push(rl);
      }
      return hits;
    };
    const cfFor = (r, c) =>
      cfHits(r, c)
        .map((rl) => rl.css)
        .join("");
    // Viền do CF áp: rule ưu tiên cao (đứng sau) thắng theo từng cạnh.
    const cfBdFor = (r, c) => {
      let bd = null;
      for (const rl of cfHits(r, c)) {
        if (!rl.bd) continue;
        bd = { ...(bd || {}) };
        for (const k of ["top", "left", "bottom", "right"])
          if (rl.bd[k] && rl.bd[k].style) bd[k] = rl.bd[k];
      }
      return bd;
    };
    const zeroHiddenAt = (r, c) =>
      zeroRules.some((refs) =>
        refs.some((rf) => c >= rf.c1 && c <= rf.c2 && r >= rf.r1 && r <= rf.r2)
      );

    const colCount = ws.columnCount || 0;
    const rowCount = ws.rowCount || 0;
    const cols = [];
    const colHidden = [];
    for (let c = 1; c <= colCount; c++) {
      const col = ws.getColumn(c);
      const w = col.width;
      cols.push(w ? Math.round(w * 7) + 5 : 64);
      colHidden.push(!!col.hidden || w === 0);
    }

    // --- Bảng cạnh (edge map) ----------------------------------------------
    // Excel vẽ mỗi đường kẻ 1 lần, nhưng HTML border-collapse thì 2 ô kề nhau
    // TRANH CHẤP cạnh chung: cùng width + cùng style thì ô phía trên/bên trái
    // thắng. Vì .xlgrid cho mọi ô một viền xám mặc định, viền đen 1px của ô dưới
    // bị viền xám của ô trên đè -> mất nét (đã kiểm chứng bằng Chrome).
    // Cách chữa: gom mọi cạnh vào 1 bảng rồi khai LẠI cho CẢ HAI ô kề cạnh đó,
    // nên hai bên luôn cùng màu/độ dày -> không còn tranh chấp.
    // hEdge["r_c"] = cạnh ngang phía TRÊN ô (r,c); vEdge["r_c"] = cạnh dọc bên TRÁI ô (r,c).
    const hEdge = {};
    const vEdge = {};
    const putEdge = (map, key, e) => {
      if (!e || !e.style) return;
      const cur = map[key];
      if (!cur || edgeRank(e) > edgeRank(cur)) map[key] = e;
    };
    for (let r = 1; r <= rowCount; r++) {
      for (let c = 1; c <= colCount; c++) {
        const bdS = (ws.getRow(r).getCell(c).style || {}).border || {};
        const bdC = cfBdFor(r, c) || {};
        const side = (k) => (bdC[k] && bdC[k].style ? bdC[k] : bdS[k]);
        putEdge(hEdge, r + "_" + c, side("top"));
        putEdge(hEdge, r + 1 + "_" + c, side("bottom"));
        putEdge(vEdge, r + "_" + c, side("left"));
        putEdge(vEdge, r + "_" + (c + 1), side("right"));
      }
    }
    // Cạnh của 1 ô (kể cả ô gộp): quét hết bề rộng/cao của ô, lấy cạnh mạnh nhất.
    const spanEdge = (map, fixed, from, to, horizontal) => {
      let best = null;
      for (let i = from; i <= to; i++) {
        const e = map[horizontal ? fixed + "_" + i : i + "_" + fixed];
        if (e && (!best || edgeRank(e) > edgeRank(best))) best = e;
      }
      return best;
    };

    const rows = [];
    const rowHidden = [];
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const h = row.height ? Math.round((row.height * 4) / 3) : 20;
      rowHidden.push(!!row.hidden || row.height === 0);
      const cells = [];
      for (let c = 1; c <= colCount; c++) {
        if (covered[r + "_" + c]) continue;
        const cell = row.getCell(c);
        const st = cell.style || {};
        const hidden =
          (cell.numFmt && String(cell.numFmt).replace(/ /g, "") === ";;;") ||
          (numVal(cell) === 0 && zeroHiddenAt(r, c));

        // Giá trị hiển thị: ÁP numFmt của ô (ExcelJS không tự làm việc này) nên
        // 23885155 -> "23,885,155", 0.7412 -> "74%", lỗi -> "#DIV/0!".
        let text = "";
        let fmtColor = null;
        if (!hidden) {
          try {
            const f = formatCellValue(cell.value, cell.numFmt);
            text = f.text;
            fmtColor = f.color;
          } catch (e) {
            text = "";
          }
        }
        const rawIsNumber = typeof cellRawValue(cell.value) === "number";
        text = esc(text).replace(/\n/g, "<br>");

        let s = "";
        const f = st.font || {};
        if (f.bold) s += "font-weight:600;";
        if (f.italic) s += "font-style:italic;";
        const deco = [];
        if (f.underline) deco.push("underline");
        if (f.strike) deco.push("line-through");
        if (deco.length) s += "text-decoration:" + deco.join(" ") + ";";
        if (f.size) s += "font-size:" + Math.round((f.size * 4) / 3) + "px;";
        if (f.name) s += "font-family:'" + f.name + "',Arial,sans-serif;";
        const fc = argb(f.color);
        if (fc) s += "color:" + fc + ";";
        if (st.fill && st.fill.type === "pattern") {
          // pattern "none" = không tô; solid dùng fgColor, gradient lấy stop đầu.
          const bg =
            st.fill.pattern === "none"
              ? null
              : argb(st.fill.fgColor) || argb(st.fill.bgColor);
          if (bg) s += "background:" + bg + ";";
        }
        const al = st.alignment || {};
        if (al.horizontal && al.horizontal !== "general")
          s += "text-align:" + (al.horizontal === "centerContinuous" ? "center" : al.horizontal) + ";";
        else if (rawIsNumber) s += "text-align:right;";
        if (al.vertical)
          s +=
            "vertical-align:" +
            (al.vertical === "middle" ? "middle" : al.vertical) +
            ";";
        if (al.wrapText) s += "white-space:normal;";
        if (al.indent) s += "padding-left:" + (al.indent * 9 + 5) + "px;";
        if (al.textRotation === "vertical")
          s += "writing-mode:vertical-rl;text-orientation:upright;";
        // Màu do numFmt khai ([Red] cho số âm) ưu tiên hơn màu font tĩnh.
        if (fmtColor) s += "color:" + fmtColor + ";";
        s += cfFor(r, c);

        const mg = master[r + "_" + c];
        const rs = mg ? mg.rs : 1;
        const cs = mg ? mg.cs : 1;
        const rEnd = r + rs - 1;
        const cEnd = c + cs - 1;
        // Viền lấy từ bảng cạnh, không lấy trực tiếp st.border: với ô gộp thì
        // cạnh dưới/phải nằm ở ô biên (vd B8:B9 -> cạnh dưới là của B9), còn ô
        // thường thì cạnh được khai cả 2 bên nên không bị ô kề đè mất.
        s += borderCss({
          top: spanEdge(hEdge, r, c, cEnd, true),
          bottom: spanEdge(hEdge, rEnd + 1, c, cEnd, true),
          left: spanEdge(vEdge, c, r, rEnd, false),
          right: spanEdge(vEdge, cEnd + 1, r, rEnd, false),
        });

        cells.push({ r, c, rowspan: rs, colspan: cs, text, css: s });
      }
      rows.push({ h, cells });
    }

    // Freeze pane: ws.views[0] = { state:'frozen', xSplit, ySplit, topLeftCell }.
    //
    // xSplit/ySplit đếm theo cột/dòng NHÌN THẤY nên phải quy đổi qua cột/dòng ẩn
    // (xem visibleSplitToIndex). Lấy thẳng xSplit làm số cột ghim thì file thù
    // lao (ẩn cột A, xSplit=1) chỉ ghim đúng cột A đang ẩn -> cuộn ngang không
    // có cột nào đứng yên, trong khi Excel ghim cột B.
    const view = (ws.views || [])[0] || {};
    const freeze =
      view.state === "frozen" && ((view.xSplit || 0) > 0 || (view.ySplit || 0) > 0)
        ? {
            rows: visibleSplitToIndex(view.ySplit, rowHidden, rowCount),
            cols: visibleSplitToIndex(view.xSplit, colHidden, colCount),
          }
        : null;

    const drawings = drawingsBySheet[ws.name] || {};
    sheets.push({
      name: ws.name,
      colCount,
      cols,
      colHidden,
      rowHidden,
      freeze,
      rows,
      // Ưu tiên ảnh đọc từ zip; nếu không có thì thử API của ExcelJS.
      images:
        drawings.images && drawings.images.length
          ? drawings.images
          : readImages(wb, ws),
      charts: drawings.charts || [],
    });
  });

  return { sheets };
}

export default parseWorkbook;
