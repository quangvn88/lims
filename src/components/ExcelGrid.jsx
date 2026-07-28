import React, { useRef, useState } from "react";
import "./ExcelGrid.css";

// Lưới hiển thị Excel bằng HTML <table> thuần (không dùng canvas/Univer).
// Nhận `model` do excelModel.parseWorkbook (ExcelJS) tạo ra:
//   model.sheets[].{ name, cols:[width], rows:[{ h, cells:[{ r,c,rowspan,colspan,css,text }] }] }
// text là HTML đã escape (\n -> <br>); css là chuỗi CSS inline đã "nướng" sẵn
// định dạng + conditional formatting cho TỪNG ô -> nền/chữ hiển thị đúng ở mọi
// cột (kể cả cột chữ D/E), khác với canvas Univer chỉ tô nền ở ô có giá trị số.
// Port từ D:\DATA\NodeJS\Excel\client\src\ExcelGrid.jsx.

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

export default function ExcelGrid({ model }) {
  const [si, setSi] = useState(0);
  const [sel, setSel] = useState(null); // {r1,c1,r2,c2} - toạ độ 1-based (theo Excel)
  const selecting = useRef(false);

  const sheet = model && model.sheets && model.sheets[si];
  if (!sheet) return null;

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

      <div className="xlscroll">
        <table className="xl">
          <colgroup>
            <col style={{ width: 46 }} />
            {sheet.cols.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="xlcorner"></th>
              {sheet.cols.map((w, i) => (
                <th
                  key={i}
                  className={
                    "xlcolhdr" +
                    (n && i + 1 >= n.ci && i + 1 <= n.ca ? " hl" : "")
                  }
                >
                  {colName(i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, ri) => {
              const rnum = ri + 1;
              return (
                <tr key={ri} style={{ height: row.h }}>
                  <th
                    className={
                      "xlrowhdr" +
                      (n && rnum >= n.ri && rnum <= n.ra ? " hl" : "")
                    }
                  >
                    {rnum}
                  </th>
                  {row.cells.map((cell, ci) => (
                    <td
                      key={ci}
                      rowSpan={cell.rowspan}
                      colSpan={cell.colspan}
                      className={inSel(cell.r, cell.c) ? "sel" : ""}
                      style={cssToObj(cell.css)}
                      onMouseDown={() => start(cell.r, cell.c)}
                      onMouseEnter={() => move(cell.r, cell.c)}
                      dangerouslySetInnerHTML={{ __html: cell.text }}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="xlsbar">{addr}</div>
    </div>
  );
}
