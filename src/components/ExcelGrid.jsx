import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import ExcelChart from "./ExcelChart.jsx";
import "./ExcelGrid.css";

// Lưới hiển thị Excel bằng HTML <table> thuần (không dùng canvas/Univer).
// Nhận `model` do excelModel.parseWorkbook (ExcelJS) tạo ra:
//   model.sheets[].{ name, cols[], colHidden[], rowHidden[], freeze,
//                    rows:[{ h, cells:[{ r,c,rowspan,colspan,css,text }] }],
//                    images[], charts[] }
// text là HTML đã escape (\n -> <br>) và ĐÃ áp numFmt; css là chuỗi CSS inline đã
// "nướng" sẵn định dạng + conditional formatting cho TỪNG ô -> nền/chữ hiển thị
// đúng ở mọi cột (kể cả cột chữ D/E), khác với canvas Univer chỉ tô nền ở ô có
// giá trị số.
//
// Ảnh nhúng và biểu đồ được vẽ ở LỚP PHỦ (overlay) đặt tuyệt đối bên trên bảng.
// Toạ độ px được ĐO THẬT từ offsetLeft/offsetTop của ô tiêu đề dòng/cột sau khi
// bảng đã layout, nên không bị lệch khi có ô gộp, cột ẩn hay dòng cao bất thường.

// "background:#fff;color:red;" -> { background:'#fff', color:'red' }
function cssToObj(css) {
  const o = {};
  (css || "").split(";").forEach((p) => {
    if (!p) return;
    const i = p.indexOf(":");
    if (i < 0) return;
    const k = p
      .slice(0, i)
      .trim()
      .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    o[k] = p.slice(i + 1).trim();
  });
  return o;
}
function colName(i) {
  let s = "";
  i++;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

const ZOOMS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const ROW_HDR_W = 46;

export default function ExcelGrid({ model }) {
  const [si, setSi] = useState(0);
  const [sel, setSel] = useState(null); // {r1,c1,r2,c2} - toạ độ 1-based (theo Excel)
  const [showHidden, setShowHidden] = useState(false);
  const [zoomIdx, setZoomIdx] = useState(ZOOMS.indexOf(1));
  const [geom, setGeom] = useState(null); // { colLeft[], rowTop[], rowH[], headH }
  const selecting = useRef(false);
  const tableRef = useRef(null);
  const scrollRef = useRef(null);
  const wrapRef = useRef(null);

  const sheet = model && model.sheets && model.sheets[si];

  // Dòng/cột bị ẩn trong file gốc (hidden="1" hoặc width/height = 0).
  const colHidden = (sheet && sheet.colHidden) || [];
  const rowHidden = (sheet && sheet.rowHidden) || [];
  const hiddenCount =
    colHidden.filter(Boolean).length + rowHidden.filter(Boolean).length;

  // Danh sách index 0-based các cột/dòng được render (giữ nguyên tên gốc A/B/C, 1/2/3)
  const visIdx = useMemo(() => {
    if (!sheet) return [];
    return sheet.cols
      .map((w, i) => i)
      .filter((i) => showHidden || !colHidden[i]);
  }, [sheet, showHidden, colHidden]);

  const visRows = useMemo(() => {
    if (!sheet) return [];
    return sheet.rows
      .map((_, i) => i)
      .filter((i) => showHidden || !rowHidden[i]);
  }, [sheet, showHidden, rowHidden]);

  // Vị trí hiển thị (0-based trong danh sách visible) của 1 cột/dòng gốc.
  const colPos = useMemo(() => {
    const m = new Map();
    visIdx.forEach((c0, k) => m.set(c0, k));
    return m;
  }, [visIdx]);
  const rowPos = useMemo(() => {
    const m = new Map();
    visRows.forEach((r0, k) => m.set(r0, k));
    return m;
  }, [visRows]);

  // Đo toạ độ thật của lưới sau khi layout -> dùng cho freeze pane + overlay.
  //
  // KHÔNG dùng offsetLeft/offsetTop của ô: Chrome CỘNG cả độ dịch do
  // position:sticky vào hai giá trị này (đã đo: ô cột A đóng băng có offsetLeft
  // 1 -> 56 sau khi cuộn ngang). Đo như vậy thì lần sau lại lệch thêm, sinh vòng
  // lặp làm lưới xô lệch khi đổi sheet.
  // Chỉ đọc những thứ KHÔNG bị sticky ảnh hưởng:
  //   - rect của <tr>  (tr không bao giờ sticky) -> vị trí dòng, chính xác lẻ px
  //   - rect.width của ô -> bề rộng cột, rồi cộng dồn
  // Chia cho `zoom` để về hệ toạ độ của chính .xlwrap (nơi sticky/overlay dùng).
  useLayoutEffect(() => {
    const tbl = tableRef.current;
    const wrap = wrapRef.current;
    if (!tbl || !wrap || !tbl.tHead || !tbl.tBodies[0]) {
      setGeom(null);
      return;
    }
    const z = ZOOMS[zoomIdx] || 1;
    const wrapRect = wrap.getBoundingClientRect();
    const head = tbl.tHead.rows[0];
    const colW = Array.from(head.cells).map(
      (c) => c.getBoundingClientRect().width / z
    );
    const rows = Array.from(tbl.tBodies[0].rows);
    const rowTop = rows.map(
      (tr) => (tr.getBoundingClientRect().top - wrapRect.top) / z
    );
    const rowH = rows.map((tr) => tr.getBoundingClientRect().height / z);

    const ref = rows[0] || head;
    let x = (ref.getBoundingClientRect().left - wrapRect.left) / z;
    const colLeft = [];
    for (const w of colW) {
      colLeft.push(x);
      x += w;
    }
    const headH = rowTop.length
      ? rowTop[0]
      : head.getBoundingClientRect().height / z;

    setGeom({ colLeft, colW, rowTop, rowH, headH });
  }, [si, showHidden, zoomIdx, model, visIdx.length, visRows.length]);

  // Đổi sheet thì về góc trên-trái, tránh giữ vị trí cuộn của sheet trước.
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (sc) {
      sc.scrollTop = 0;
      sc.scrollLeft = 0;
    }
  }, [si]);

  if (!sheet) return null;

  const zoom = ZOOMS[zoomIdx];
  const freeze = sheet.freeze || null;

  // Số cột hiển thị trong vùng merge [c, c+cs-1] -> colspan sau khi bỏ cột ẩn.
  const visSpan = (c, cs) => {
    let n2 = 0;
    for (let k = c; k < c + cs; k++) if (showHidden || !colHidden[k - 1]) n2++;
    return n2;
  };

  const n = sel
    ? {
        ri: Math.min(sel.r1, sel.r2),
        ra: Math.max(sel.r1, sel.r2),
        ci: Math.min(sel.c1, sel.c2),
        ca: Math.max(sel.c1, sel.c2),
      }
    : null;
  const inSel = (r, c) => n && r >= n.ri && r <= n.ra && c >= n.ci && c <= n.ca;

  const start = (r, c) => {
    selecting.current = true;
    setSel({ r1: r, c1: c, r2: r, c2: c });
  };
  const move = (r, c) => {
    if (selecting.current) setSel((s) => ({ ...s, r2: r, c2: c }));
  };
  const stop = () => {
    selecting.current = false;
  };

  const addr = n
    ? n.ri === n.ra && n.ci === n.ca
      ? colName(n.ci - 1) + n.ri
      : colName(n.ci - 1) + n.ri + ":" + colName(n.ca - 1) + n.ra
    : "Chọn ô để xem địa chỉ (kéo để chọn vùng)";

  // --- freeze pane -----------------------------------------------------------
  // Cột 1..freeze.cols và dòng 1..freeze.rows được ghim bằng position:sticky,
  // offset lấy từ toạ độ đo thật (colLeft/rowTop) nên khớp cả khi có cột ẩn.
  const isFrozenCol = (c1) => !!freeze && c1 <= freeze.cols; // c1: 1-based
  const isFrozenRow = (r1) => !!freeze && r1 <= freeze.rows;

  // Ở mức zoom lẻ (125%, 150%...) chiều cao dòng thành số thập phân, Chrome làm
  // tròn vị trí ghim theo pixel thiết bị khác nhau ở mỗi dòng -> hở ~0,3px giữa
  // các dòng đã ghim và nội dung đang cuộn lộ qua. Lùi 0,5px cho các ô ghim CHỒNG
  // nhẹ lên nhau thay vì hở. Ở 100% thì không lùi để đường kẻ không bị nhoè.
  const bias = zoom === 1 ? 0 : 0.5;

  const stickyColStyle = (c1) => {
    if (!isFrozenCol(c1) || !geom) return null;
    const k = colPos.get(c1 - 1);
    if (k == null || geom.colLeft[k + 1] == null) return null;
    return { position: "sticky", left: geom.colLeft[k + 1] - bias };
  };
  const stickyRowTop = (r0) => {
    if (!geom) return null;
    const k = rowPos.get(r0);
    if (k == null || geom.rowTop[k] == null) return null;
    return geom.rowTop[k] - bias;
  };

  // --- overlay: ảnh nhúng + biểu đồ ------------------------------------------
  // Neo theo (col,row) 0-based của Excel; cột/dòng đang ẩn thì lùi về vị trí
  // hiển thị gần nhất để hình không bị nhảy ra ngoài lưới.
  const xOf = (col0, off) => {
    if (!geom) return 0;
    const k = colPos.get(col0);
    // Cột có mặt: lấy CẠNH TRÁI của nó.
    if (k != null) return (geom.colLeft[k + 1] ?? ROW_HDR_W) + (off || 0);
    // Cột đang ẩn / vượt ngoài vùng dữ liệu: lấy CẠNH PHẢI của cột hiển thị gần
    // nhất phía trước — đúng bằng đường biên nơi Excel đặt hình.
    let c = col0;
    while (c > 0 && colPos.get(c) == null) c--;
    const k2 = colPos.get(c);
    if (k2 == null) return ROW_HDR_W + (off || 0);
    return (
      (geom.colLeft[k2 + 1] ?? ROW_HDR_W) + (geom.colW[k2 + 1] ?? 0) + (off || 0)
    );
  };
  const yOf = (row0, off) => {
    if (!geom) return 0;
    const k = rowPos.get(row0);
    if (k != null) return (geom.rowTop[k] ?? geom.headH) + (off || 0);
    let r = row0;
    while (r > 0 && rowPos.get(r) == null) r--;
    const k2 = rowPos.get(r);
    if (k2 == null) return geom.headH + (off || 0);
    return (geom.rowTop[k2] ?? geom.headH) + (geom.rowH[k2] ?? 0) + (off || 0);
  };
  const boxOf = (item) => {
    const left = xOf(item.from.col, item.from.colOff);
    const top = yOf(item.from.row, item.from.rowOff);
    let width;
    let height;
    if (item.to) {
      width = Math.max(8, xOf(item.to.col, item.to.colOff) - left);
      height = Math.max(8, yOf(item.to.row, item.to.rowOff) - top);
    } else if (item.size) {
      width = item.size.w;
      height = item.size.h;
    } else {
      width = 480;
      height = 288;
    }
    return { left, top, width, height };
  };

  const overlayReady = !!geom;
  const images = sheet.images || [];
  const charts = sheet.charts || [];

  // Hình/biểu đồ nằm ở lớp phủ tuyệt đối nên KHÔNG tự nới rộng .xlwrap ->
  // phải tự nới để còn cuộn tới xem được phần tràn ra ngoài bảng.
  let wrapMin = null;
  if (overlayReady && (images.length || charts.length)) {
    let w = 0;
    let h = 0;
    for (const it of [...images, ...charts]) {
      const b = boxOf(it);
      w = Math.max(w, b.left + b.width);
      h = Math.max(h, b.top + b.height);
    }
    wrapMin = { minWidth: Math.ceil(w) + 8, minHeight: Math.ceil(h) + 8 };
  }

  return (
    <div className="xlgrid" onMouseUp={stop} onMouseLeave={stop}>
      {model.sheets.length > 1 && (
        <div className="xltabs">
          {model.sheets.map((s, i) => (
            <div
              key={i}
              className={"xltab" + (i === si ? " active" : "")}
              onClick={() => {
                setSi(i);
                setSel(null);
              }}
            >
              {s.name}
            </div>
          ))}
        </div>
      )}

      <div className="xlscroll" ref={scrollRef}>
        {/* zoom (không phải transform) để position:sticky của freeze pane vẫn chạy */}
        <div className="xlwrap" ref={wrapRef} style={{ zoom, ...(wrapMin || {}) }}>
          <table className="xl" ref={tableRef}>
            <colgroup>
              <col style={{ width: ROW_HDR_W }} />
              {visIdx.map((i) => (
                <col key={i} style={{ width: sheet.cols[i] }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="xlcorner"></th>
                {visIdx.map((i) => {
                  // Cột đóng băng: ghim CẢ tiêu đề cột, nếu không thì chữ A/B/C
                  // trôi theo lúc cuộn ngang -> lệch với dữ liệu đang ghim.
                  const sc = stickyColStyle(i + 1);
                  return (
                    <th
                      key={i}
                      className={
                        "xlcolhdr" +
                        (n && i + 1 >= n.ci && i + 1 <= n.ca ? " hl" : "") +
                        (colHidden[i] ? " xlhiddencol" : "")
                      }
                      style={
                        sc ? { position: "sticky", left: sc.left, top: 0, zIndex: 7 } : undefined
                      }
                    >
                      {colName(i)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visRows.map((ri) => {
                const row = sheet.rows[ri];
                const rnum = ri + 1;
                const frozenRow = isFrozenRow(rnum);
                const top = frozenRow ? stickyRowTop(ri) : null;
                return (
                  <tr key={ri} style={{ height: row.h }}>
                    <th
                      className={
                        "xlrowhdr" +
                        (n && rnum >= n.ri && rnum <= n.ra ? " hl" : "") +
                        (rowHidden[ri] ? " xlhiddenrow" : "")
                      }
                      style={
                        frozenRow && top != null
                          ? // z-index phải CAO HƠN .xlrowhdr thường (4), nếu không
                            // số thứ tự dòng của các dòng đang cuộn sẽ đè lên.
                            { position: "sticky", left: 0, top, zIndex: 5 }
                          : undefined
                      }
                    >
                      {rnum}
                    </th>
                    {row.cells.map((cell, ci) => {
                      // Bỏ ô nằm trọn trong cột ẩn; ô merge chỉ bị co colspan lại.
                      const cs = visSpan(cell.c, cell.colspan || 1);
                      if (cs === 0) return null;
                      const base = cssToObj(cell.css);
                      const sc = stickyColStyle(cell.c);
                      let style = base;
                      if (sc || (frozenRow && top != null)) {
                        style = { ...base, position: "sticky" };
                        if (sc) style.left = sc.left;
                        if (frozenRow && top != null) style.top = top;
                        style.zIndex = sc && frozenRow ? 3 : 2;
                        // Ô sticky không có nền sẽ để lộ nội dung cuộn bên dưới.
                        if (!style.background && !style.backgroundColor)
                          style.background = "#fff";
                      }
                      return (
                        <td
                          key={ci}
                          rowSpan={cell.rowspan}
                          colSpan={cs}
                          className={inSel(cell.r, cell.c) ? "sel" : ""}
                          style={style}
                          onMouseDown={() => start(cell.r, cell.c)}
                          onMouseEnter={() => move(cell.r, cell.c)}
                          dangerouslySetInnerHTML={{ __html: cell.text }}
                        />
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {overlayReady && (images.length > 0 || charts.length > 0) && (
            <div className="xloverlay">
              {images.map((im, i) => {
                const b = boxOf(im);
                return (
                  <img
                    key={"img" + i}
                    className="xlimg"
                    src={im.src}
                    alt=""
                    style={{
                      left: b.left,
                      top: b.top,
                      width: b.width,
                      height: b.height,
                    }}
                  />
                );
              })}
              {charts.map((ch, i) => {
                const b = boxOf(ch);
                return (
                  <div
                    key={"ch" + i}
                    className="xlchartbox"
                    style={{
                      left: b.left,
                      top: b.top,
                      width: b.width,
                      height: b.height,
                    }}
                  >
                    <ExcelChart
                      chart={ch.chart}
                      width={b.width}
                      height={b.height}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="xlsbar">
        <span className="xladdr">{addr}</span>
        <span className="xltools">
          {hiddenCount > 0 && (
            <label className="xlhiddentoggle">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
              />
              Hiện dòng/cột ẩn ({hiddenCount})
            </label>
          )}
          <span className="xlzoom">
            <button
              type="button"
              onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
              disabled={zoomIdx === 0}
              title="Thu nhỏ"
            >
              −
            </button>
            <span className="xlzoomval">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() =>
                setZoomIdx((i) => Math.min(ZOOMS.length - 1, i + 1))
              }
              disabled={zoomIdx === ZOOMS.length - 1}
              title="Phóng to"
            >
              +
            </button>
          </span>
        </span>
      </div>
    </div>
  );
}
