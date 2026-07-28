// Đọc .xlsx (bytes) -> JSON model cho <ExcelGrid> render (giá trị + style + gộp ô
// + conditional formatting "nướng" thẳng vào CSS từng ô). Chạy HOÀN TOÀN ở client
// bằng ExcelJS (bản lims không có server parse như dự án tham chiếu).
//
// Port nguyên logic từ D:\DATA\NodeJS\Excel\server\index.js (parseWorkbook), chỉ
// khác: nhận Uint8Array/ArrayBuffer thay cho Node Buffer, và ExcelJS được import
// ĐỘNG để không nặng bundle chính (~1MB, chỉ tải khi mở trang xem Excel).

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function argb(c) {
  if (!c) return null;
  if (c.argb) {
    const a = c.argb;
    return "#" + (a.length === 8 ? a.slice(2) : a);
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
function rawVal(cell) {
  if (!cell || cell.value == null) return "";
  const v = cell.value;
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (v.text != null) return v.text;
    if (v.result != null) return String(v.result);
    return "";
  }
  return String(v);
}

// bytes: Uint8Array | ArrayBuffer chứa nội dung file .xlsx
export async function parseWorkbook(bytes) {
  const ExcelJS = (await import("exceljs")).default || (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  // ExcelJS (bản browser) nhận ArrayBuffer.
  const ab =
    bytes instanceof ArrayBuffer
      ? bytes
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await wb.xlsx.load(ab);

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
    (ws.conditionalFormattings || []).forEach((g) => {
      const refs = String(g.ref || "")
        .split(/\s+/)
        .map(parseRange)
        .filter(Boolean);
      if (!refs.length) return;
      (g.rules || []).forEach((rule) => {
        if (rule.type !== "expression" || !rule.formulae || !rule.formulae[0])
          return;
        const mm = String(rule.formulae[0]).match(
          /^\$([A-Z]+)(\d+)\s*=\s*"(.*)"$/
        );
        if (!mm) return;
        const st = rule.style || {};
        let css = "";
        if (st.font) {
          if (st.font.bold) css += "font-weight:600;";
          if (st.font.italic) css += "font-style:italic;";
          const fc =
            st.font.color && st.font.color.argb
              ? "#" + st.font.color.argb.slice(2)
              : null;
          if (fc) css += "color:" + fc + ";";
        }
        if (
          st.fill &&
          st.fill.pattern !== "none" &&
          st.fill.bgColor &&
          st.fill.bgColor.argb
        )
          css += "background:#" + st.fill.bgColor.argb.slice(2) + ";";
        if (!css) return;
        cfRules.push({
          refs,
          markerCol: colLetterToNum(mm[1]),
          anchorRow: +mm[2],
          value: mm[3],
          css,
        });
      });
    });
    const cfFor = (r, c) => {
      let out = "";
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
        if (String(mv).trim() === rl.value) out += rl.css;
      }
      return out;
    };

    const colCount = ws.columnCount || 0;
    const rowCount = ws.rowCount || 0;
    const cols = [];
    for (let c = 1; c <= colCount; c++) {
      const w = ws.getColumn(c).width;
      cols.push(w ? Math.round(w * 7) + 5 : 64);
    }

    const rows = [];
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const h = row.height ? Math.round((row.height * 4) / 3) : 20;
      const cells = [];
      for (let c = 1; c <= colCount; c++) {
        if (covered[r + "_" + c]) continue;
        const cell = row.getCell(c);
        const st = cell.style || {};
        const hidden =
          cell.numFmt && String(cell.numFmt).replace(/ /g, "") === ";;;";

        let text = "";
        if (!hidden) {
          try {
            text =
              cell.text != null && cell.text !== "" ? cell.text : rawVal(cell);
          } catch (e) {
            text = "";
          }
          if (text && typeof text === "object") text = "";
        }
        text = esc(text).replace(/\n/g, "<br>");

        let s = "";
        const f = st.font || {};
        if (f.bold) s += "font-weight:600;";
        if (f.italic) s += "font-style:italic;";
        if (f.underline) s += "text-decoration:underline;";
        if (f.size) s += "font-size:" + Math.round((f.size * 4) / 3) + "px;";
        if (f.name) s += "font-family:'" + f.name + "',Arial,sans-serif;";
        const fc = argb(f.color);
        if (fc) s += "color:" + fc + ";";
        if (st.fill && st.fill.type === "pattern") {
          const bg = argb(st.fill.fgColor);
          if (bg) s += "background:" + bg + ";";
        }
        const al = st.alignment || {};
        if (al.horizontal) s += "text-align:" + al.horizontal + ";";
        else if (typeof cell.value === "number") s += "text-align:right;";
        if (al.vertical)
          s +=
            "vertical-align:" +
            (al.vertical === "middle" ? "middle" : al.vertical) +
            ";";
        if (al.wrapText) s += "white-space:normal;";
        const bd = st.border || {};
        const bs = (e) => {
          if (!e || !e.style) return null;
          const col = argb(e.color) || "#000";
          const w =
            e.style === "thick" || e.style === "medium" ? "2px" : "1px";
          const ty =
            e.style === "dotted"
              ? "dotted"
              : e.style === "dashed"
                ? "dashed"
                : "solid";
          return w + " " + ty + " " + col;
        };
        const bt = bs(bd.top);
        const bl = bs(bd.left);
        const bb = bs(bd.bottom);
        const br = bs(bd.right);
        if (bt) s += "border-top:" + bt + ";";
        if (bl) s += "border-left:" + bl + ";";
        if (bb) s += "border-bottom:" + bb + ";";
        if (br) s += "border-right:" + br + ";";
        s += cfFor(r, c);

        const mg = master[r + "_" + c];
        cells.push({
          r,
          c,
          rowspan: mg ? mg.rs : 1,
          colspan: mg ? mg.cs : 1,
          text,
          css: s,
        });
      }
      rows.push({ h, cells });
    }
    sheets.push({ name: ws.name, colCount, cols, rows });
  });

  return { sheets };
}
