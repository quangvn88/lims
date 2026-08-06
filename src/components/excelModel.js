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
const THEME_COLORS = [
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

function colLetterToNum(s) {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
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

        const mm = String(rule.formulae[0]).match(
          /^\$([A-Z]+)(\d+)\s*=\s*"(.*)"$/
        );
        if (!mm) return;
        let css = "";
        if (st.font) {
          if (st.font.bold) css += "font-weight:600;";
          if (st.font.italic) css += "font-style:italic;";
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
          markerCol: colLetterToNum(mm[1]),
          anchorRow: +mm[2],
          value: mm[3],
          priority: rule.priority == null ? 9999 : +rule.priority,
          css,
          bd: st.border || null,
        });
      });
    });
    // Excel: priority nhỏ = ưu tiên cao. CSS thì khai báo sau thắng
    // -> xếp priority giảm dần để rule ưu tiên cao được ghi cuối.
    cfRules.sort((a, b) => b.priority - a.priority);
    // Các rule CF đang khớp ô (r,c), theo thứ tự ưu tiên tăng dần (cuối = thắng).
    const cfHits = (r, c) => {
      const hits = [];
      for (const rl of cfRules) {
        let fr = null;
        for (const rf of rl.refs)
          if (c >= rf.c1 && c <= rf.c2 && r >= rf.r1 && r <= rf.r2) {
            fr = rf.r1;
            break;
          }
        if (fr === null) continue;
        const refRow = rl.anchorRow + (r - fr);
        const mv = rawVal(ws.getRow(refRow).getCell(rl.markerCol));
        if (String(mv).trim() === rl.value) hits.push(rl);
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

    // Freeze pane: ws.views[0] = { state:'frozen', xSplit: số cột đóng băng,
    // ySplit: số dòng đóng băng }.
    const view = (ws.views || [])[0] || {};
    const freeze =
      view.state === "frozen" && ((view.xSplit || 0) > 0 || (view.ySplit || 0) > 0)
        ? { rows: view.ySplit || 0, cols: view.xSplit || 0 }
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
