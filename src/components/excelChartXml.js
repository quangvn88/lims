// Đọc BIỂU ĐỒ (chart) và ẢNH NHÚNG trong file .xlsx.
//
// LÝ DO CẦN MODULE NÀY:
//  1. ExcelJS KHÔNG đọc được chart (không có API nào trả về chart, và khi ghi
//     lại file thì chart bị mất).
//  2. ExcelJS chỉ nhận drawing khai bằng TIỀN TỐ `xdr:` (`<xdr:wsDr>`). File do
//     openpyxl/Apache POI sinh ra dùng NAMESPACE MẶC ĐỊNH (`<wsDr xmlns=...>`)
//     -> ExcelJS 4.4.0 parse ra undefined rồi NÉM LỖI ngay trong xlsx.load
//     ("Cannot read properties of undefined (reading 'anchors')"). Vì thế ảnh
//     cũng được đọc ở đây (dùng so khớp theo localName, bỏ qua prefix) để không
//     phụ thuộc vào ExcelJS.
//
// Cách làm: tự mở file .xlsx (thực chất là file zip) và đọc XML:
//
//   xl/workbook.xml                     -> danh sách sheet theo thứ tự + r:id
//   xl/_rels/workbook.xml.rels          -> r:id -> worksheets/sheetN.xml
//   xl/worksheets/sheetN.xml            -> <drawing r:id="..."/>
//   xl/worksheets/_rels/sheetN.xml.rels -> r:id -> ../drawings/drawingN.xml
//   xl/drawings/drawingN.xml            -> neo (anchor) + <c:chart r:id> + <xdr:pic>
//   xl/drawings/_rels/drawingN.xml.rels -> r:id -> ../charts/chartN.xml | ../media/imageN.png
//   xl/charts/chartN.xml                -> loại chart, series, số liệu đã cache
//
// Số liệu lấy từ CACHE (c:numCache/c:strCache) mà Excel ghi kèm chart, nên không
// cần tính lại công thức — đúng bằng những gì Excel đang hiển thị.
//
// JSZip đi kèm ExcelJS nhưng vẫn khai báo trong package.json để không phụ thuộc
// vào dependency lồng (transitive) của thư viện khác.

const EMU_PER_PX = 9525; // 1 px = 9525 EMU (đơn vị đo của OOXML drawing)

const local = (n) =>
  n.localName || String(n.nodeName || "").replace(/^.*:/, "");

/** Các phần tử CON TRỰC TIẾP có tên `name` (bỏ qua namespace prefix). */
function kids(node, name) {
  if (!node) return [];
  const out = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && local(c) === name) out.push(c);
  }
  return out;
}
const kid = (node, name) => kids(node, name)[0] || null;

/** Mọi phần tử con-cháu có tên `name`. */
function all(node, name) {
  if (!node || !node.getElementsByTagNameNS) return [];
  return Array.from(node.getElementsByTagNameNS("*", name));
}

const attr = (node, name) => (node ? node.getAttribute(name) : null);
const valOf = (node) => (node ? node.getAttribute("val") : null);

const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function relId(el) {
  if (!el) return null;
  return (
    (el.getAttributeNS && el.getAttributeNS(R_NS, "id")) ||
    el.getAttribute("r:id") ||
    el.getAttribute("id")
  );
}

/** "xl/drawings/" + "../charts/chart1.xml" -> "xl/charts/chart1.xml" */
function resolvePath(baseDir, target) {
  if (!target) return null;
  if (target.startsWith("/")) return target.slice(1);
  const parts = (baseDir + target).split("/");
  const out = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}
const dirOf = (p) => p.slice(0, p.lastIndexOf("/") + 1);
const baseOf = (p) => p.slice(p.lastIndexOf("/") + 1);
const relsPathOf = (p) => dirOf(p) + "_rels/" + baseOf(p) + ".rels";

// ------------------------------------------------------------------ màu -------

/** <a:solidFill><a:srgbClr val="C00000"/> -> "#c00000". schemeClr -> map gần đúng. */
const SCHEME = {
  accent1: "#4472c4",
  accent2: "#ed7d31",
  accent3: "#a5a5a5",
  accent4: "#ffc000",
  accent5: "#5b9bd5",
  accent6: "#70ad47",
  dk1: "#000000",
  dk2: "#44546a",
  lt1: "#ffffff",
  lt2: "#e7e6e6",
  tx1: "#000000",
  tx2: "#44546a",
  bg1: "#ffffff",
  bg2: "#e7e6e6",
};
function fillColor(spPr) {
  if (!spPr) return null;
  const noFill = kid(spPr, "noFill");
  if (noFill) return "transparent";
  const solid = kid(spPr, "solidFill");
  if (solid) return colorOf(solid);
  const grad = kid(spPr, "gradFill");
  if (grad) {
    const stop = all(grad, "gs")[0];
    return stop ? colorOf(stop) : null;
  }
  return null;
}
function colorOf(container) {
  const srgb = all(container, "srgbClr")[0];
  if (srgb) return "#" + String(valOf(srgb) || "000000").toLowerCase();
  const scheme = all(container, "schemeClr")[0];
  if (scheme) return SCHEME[String(valOf(scheme) || "").toLowerCase()] || null;
  const sys = all(container, "sysClr")[0];
  if (sys) {
    const v = attr(sys, "lastClr");
    if (v) return "#" + v.toLowerCase();
  }
  return null;
}
/** Màu đường viền/đường line của series. */
function lineColor(spPr) {
  const ln = spPr && kid(spPr, "ln");
  if (!ln) return null;
  if (kid(ln, "noFill")) return "transparent";
  const solid = kid(ln, "solidFill");
  return solid ? colorOf(solid) : null;
}
function lineWidthPx(spPr) {
  const ln = spPr && kid(spPr, "ln");
  const w = ln && attr(ln, "w");
  return w ? Math.max(1, Math.round(+w / 12700)) : null; // EMU -> pt ~ px
}

// -------------------------------------------------------------- cache --------

/** c:strCache | c:numCache -> mảng giá trị theo idx (giữ đúng chỗ trống). */
function readCache(refNode) {
  if (!refNode) return null;
  const cache =
    kid(refNode, "numCache") ||
    kid(refNode, "strCache") ||
    kid(refNode, "multiLvlStrCache");
  if (!cache) return null;
  const count = +(valOf(kid(cache, "ptCount")) || 0);
  const fmt = textOf(kid(cache, "formatCode"));
  const arr = new Array(count).fill(null);
  for (const pt of kids(cache, "pt")) {
    const i = +(attr(pt, "idx") || 0);
    const v = textOf(kid(pt, "v"));
    arr[i] = v;
  }
  // multiLvlStrCache: nhiều cấp nhãn -> gộp cấp trong cùng.
  const lvls = kids(cache, "lvl");
  if (lvls.length) {
    const lvl = lvls[0];
    for (const pt of kids(lvl, "pt")) {
      const i = +(attr(pt, "idx") || 0);
      arr[i] = textOf(kid(pt, "v"));
    }
  }
  return { values: arr, formatCode: fmt || null };
}
function textOf(node) {
  return node ? String(node.textContent || "") : "";
}

/** c:cat | c:val | c:xVal | c:yVal -> { values, formatCode, ref } */
function readAxisData(holder, numeric) {
  if (!holder) return null;
  const ref =
    kid(holder, "numRef") ||
    kid(holder, "strRef") ||
    kid(holder, "multiLvlStrRef");
  if (ref) {
    const c = readCache(ref);
    return {
      ref: textOf(kid(ref, "f")) || null,
      values: c
        ? c.values.map((v) => (numeric ? toNum(v) : v))
        : [],
      formatCode: c ? c.formatCode : null,
    };
  }
  const lit = kid(holder, "numLit") || kid(holder, "strLit");
  if (lit) {
    const count = +(valOf(kid(lit, "ptCount")) || 0);
    const arr = new Array(count).fill(null);
    for (const pt of kids(lit, "pt")) {
      arr[+(attr(pt, "idx") || 0)] = textOf(kid(pt, "v"));
    }
    return { ref: null, values: numeric ? arr.map(toNum) : arr, formatCode: null };
  }
  return null;
}
function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

/** Địa chỉ ô nguồn ("'Sheet'!$A$1:$A$5") của c:tx, dùng khi file không có cache. */
function refOfHolder(node) {
  if (!node) return null;
  const ref =
    kid(node, "strRef") ||
    kid(node, "numRef") ||
    kid(node, "multiLvlStrRef");
  return ref ? textOf(kid(ref, "f")) || null : null;
}

/** Gom text của c:tx / c:title (rich text a:t rời rạc). */
function richText(node) {
  if (!node) return "";
  const strRef = kid(node, "strRef");
  if (strRef) {
    const c = readCache(strRef);
    if (c && c.values.length) return c.values.filter(Boolean).join(" ");
  }
  const v = kid(node, "v");
  if (v) return textOf(v);
  const ts = all(node, "t");
  return ts.map((t) => textOf(t)).join("");
}

// -------------------------------------------------------------- chart --------

const PLOT_TYPES = [
  "barChart",
  "bar3DChart",
  "lineChart",
  "line3DChart",
  "pieChart",
  "pie3DChart",
  "doughnutChart",
  "ofPieChart",
  "areaChart",
  "area3DChart",
  "scatterChart",
  "bubbleChart",
  "radarChart",
  "stockChart",
  "surfaceChart",
];

function parseChartXml(doc) {
  const space = doc.documentElement;
  const chart = kid(space, "chart");
  if (!chart) return null;

  const titleNode = kid(chart, "title");
  const titleDeleted = valOf(kid(chart, "autoTitleDeleted")) === "1";
  const title = titleDeleted ? "" : richText(titleNode);

  const plotArea = kid(chart, "plotArea");
  if (!plotArea) return null;

  const legendNode = kid(chart, "legend");
  const legend = legendNode
    ? { pos: valOf(kid(legendNode, "legendPos")) || "r" }
    : null;

  const plots = [];
  for (let c = plotArea.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 1) continue;
    const name = local(c);
    if (!PLOT_TYPES.includes(name)) continue;
    plots.push(parsePlot(c, name));
  }

  // Trục: lấy nhãn + mã định dạng để hiện đúng "23,885" thay vì "23885".
  const axes = {};
  for (const axName of ["catAx", "valAx", "dateAx", "serAx"]) {
    for (const ax of kids(plotArea, axName)) {
      const id = textOf(kid(ax, "axId")) || valOf(kid(ax, "axId"));
      axes[axName + ":" + (id || Object.keys(axes).length)] = {
        kind: axName,
        title: richText(kid(ax, "title")),
        numFmt: attr(kid(ax, "numFmt"), "formatCode"),
        deleted: valOf(kid(ax, "delete")) === "1",
        majorGridlines: !!kid(ax, "majorGridlines"),
        max: toNum(valOf(kid(kid(ax, "scaling") || ax, "max"))),
        min: toNum(valOf(kid(kid(ax, "scaling") || ax, "min"))),
        reverse:
          valOf(kid(kid(ax, "scaling") || ax, "orientation")) === "maxMin",
      };
    }
  }

  const is3d = plots.some((p) => /3D/.test(p.type)) || !!kid(chart, "view3D");

  return {
    title,
    legend,
    plots,
    axes: Object.values(axes),
    is3d,
    plotVisOnly: valOf(kid(chart, "plotVisOnly")) !== "0",
  };
}

function parsePlot(node, type) {
  const sers = kids(node, "ser").map(parseSeries);
  return {
    type,
    barDir: valOf(kid(node, "barDir")) || null, // col = cột dọc, bar = thanh ngang
    grouping: valOf(kid(node, "grouping")) || null, // clustered|stacked|percentStacked|standard
    varyColors: valOf(kid(node, "varyColors")) === "1",
    overlap: toNum(valOf(kid(node, "overlap"))),
    gapWidth: toNum(valOf(kid(node, "gapWidth"))),
    holeSize: toNum(valOf(kid(node, "holeSize"))),
    marker: valOf(kid(node, "marker")) !== "0",
    series: sers,
    dLbls: parseDLbls(kid(node, "dLbls")),
  };
}

function parseDLbls(node) {
  if (!node) return null;
  if (valOf(kid(node, "delete")) === "1") return null;
  return {
    showVal: valOf(kid(node, "showVal")) === "1",
    showCatName: valOf(kid(node, "showCatName")) === "1",
    showSerName: valOf(kid(node, "showSerName")) === "1",
    showPercent: valOf(kid(node, "showPercent")) === "1",
    numFmt: attr(kid(node, "numFmt"), "formatCode"),
    pos: valOf(kid(node, "dLblPos")) || null,
  };
}

function parseSeries(ser) {
  const spPr = kid(ser, "spPr");
  const color = fillColor(spPr);
  // dPt = định dạng riêng cho TỪNG điểm (vd cột "Ngày 01" xanh, còn lại đỏ).
  const pointColors = {};
  for (const dp of kids(ser, "dPt")) {
    const i = toNum(valOf(kid(dp, "idx")));
    const c = fillColor(kid(dp, "spPr"));
    if (i !== null && c) pointColors[i] = c;
  }
  const cat = readAxisData(kid(ser, "cat"), false);
  const val = readAxisData(kid(ser, "val"), true);
  const xVal = readAxisData(kid(ser, "xVal"), true);
  const yVal = readAxisData(kid(ser, "yVal"), true);

  return {
    idx: toNum(valOf(kid(ser, "idx"))) || 0,
    order: toNum(valOf(kid(ser, "order"))) || 0,
    name: richText(kid(ser, "tx")),
    // File do thư viện khác sinh ra (openpyxl, POI...) thường KHÔNG ghi cache
    // -> giữ địa chỉ ô để excelModel tự lấy số liệu từ sheet.
    nameRef: refOfHolder(kid(ser, "tx")),
    color,
    borderColor: lineColor(spPr),
    lineWidth: lineWidthPx(spPr),
    pointColors,
    cat,
    val: val || yVal,
    xVal,
    smooth: valOf(kid(ser, "smooth")) === "1",
    marker: markerOf(kid(ser, "marker")),
    dLbls: parseDLbls(kid(ser, "dLbls")),
  };
}
function markerOf(node) {
  if (!node) return null;
  const symbol = valOf(kid(node, "symbol"));
  if (symbol === "none") return { symbol: "none" };
  return {
    symbol: symbol || "auto",
    size: toNum(valOf(kid(node, "size"))),
    color: fillColor(kid(node, "spPr")),
  };
}

// ------------------------------------------------------------- drawing -------

/** xdr:from / xdr:to -> { col, colOff, row, rowOff } (offset đổi sang px). */
function anchorPoint(node) {
  if (!node) return null;
  return {
    col: +(textOf(kid(node, "col")) || 0),
    colOff: Math.round(+(textOf(kid(node, "colOff")) || 0) / EMU_PER_PX),
    row: +(textOf(kid(node, "row")) || 0),
    rowOff: Math.round(+(textOf(kid(node, "rowOff")) || 0) / EMU_PER_PX),
  };
}

/** Đọc drawingN.xml -> { charts: [{anchor, chartRelId}], pics: [{anchor, embedRelId}] } */
function parseDrawingXml(doc) {
  const charts = [];
  const pics = [];
  const root = doc.documentElement;
  for (let c = root.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 1) continue;
    const kind = local(c); // twoCellAnchor | oneCellAnchor | absoluteAnchor

    const ext = kid(c, "ext");
    const size = ext
      ? {
          w: Math.round(+(attr(ext, "cx") || 0) / EMU_PER_PX),
          h: Math.round(+(attr(ext, "cy") || 0) / EMU_PER_PX),
        }
      : null;
    // absoluteAnchor neo theo toạ độ tuyệt đối (xdr:pos) chứ không theo ô.
    const pos = kid(c, "pos");
    const from = pos
      ? {
          col: 0,
          row: 0,
          colOff: Math.round(+(attr(pos, "x") || 0) / EMU_PER_PX),
          rowOff: Math.round(+(attr(pos, "y") || 0) / EMU_PER_PX),
        }
      : anchorPoint(kid(c, "from"));
    const to = kind === "twoCellAnchor" ? anchorPoint(kid(c, "to")) : null;
    const anchor = { kind, from, to, size, editAs: attr(c, "editAs") || null };

    const frame = kid(c, "graphicFrame");
    const chartRef = frame ? all(frame, "chart")[0] : null;
    if (chartRef) {
      charts.push({ ...anchor, chartRelId: relId(chartRef) });
      continue;
    }

    // Ảnh: <xdr:pic><xdr:blipFill><a:blip r:embed="rIdN"/>
    const pic = kid(c, "pic");
    const blip = pic ? all(pic, "blip")[0] : null;
    if (blip) {
      const embed =
        (blip.getAttributeNS && blip.getAttributeNS(R_NS, "embed")) ||
        blip.getAttribute("r:embed");
      if (embed) pics.push({ ...anchor, embedRelId: embed });
    }
  }
  return { charts, pics };
}

const IMG_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
  emf: "image/emf",
  wmf: "image/wmf",
};

// ----------------------------------------------------------------- API -------

/** Đọc file .rels -> { rId: target } */
function parseRels(doc) {
  const map = {};
  for (const rel of all(doc.documentElement, "Relationship")) {
    map[attr(rel, "Id")] = attr(rel, "Target");
  }
  return map;
}

/**
 * Đọc toàn bộ biểu đồ + ảnh nhúng trong workbook.
 * @param {Uint8Array|ArrayBuffer} bytes nội dung file .xlsx
 * @returns {Promise<Object>} { [tên sheet]: { charts: [...], images: [...] } }
 *          charts[i] = { from:{col,row,colOff,rowOff}, to, size, chart }
 *          images[i] = { from, to, size, src (data URL) }
 */
export async function parseDrawings(bytes) {
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
      const txt = await f.async("string");
      const doc = parser.parseFromString(txt, "application/xml");
      if (doc.getElementsByTagName("parsererror").length) return null;
      return doc;
    };

    const wbDoc = await readXml("xl/workbook.xml");
    if (!wbDoc) return {};
    const wbRelsDoc = await readXml("xl/_rels/workbook.xml.rels");
    const wbRels = wbRelsDoc ? parseRels(wbRelsDoc) : {};

    const result = {};

    for (const sh of all(wbDoc.documentElement, "sheet")) {
      const name = attr(sh, "name") || "";
      const target = wbRels[relId(sh)];
      if (!target) continue;
      const sheetPath = resolvePath("xl/", target);
      const sheetDoc = await readXml(sheetPath);
      if (!sheetDoc) continue;

      const drawingRefs = all(sheetDoc.documentElement, "drawing");
      if (!drawingRefs.length) continue;

      const sheetRelsDoc = await readXml(relsPathOf(sheetPath));
      const sheetRels = sheetRelsDoc ? parseRels(sheetRelsDoc) : {};

      const charts = [];
      const images = [];
      for (const dref of drawingRefs) {
        const dTarget = sheetRels[relId(dref)];
        if (!dTarget) continue;
        const drawingPath = resolvePath(dirOf(sheetPath), dTarget);
        const drawingDoc = await readXml(drawingPath);
        if (!drawingDoc) continue;

        const dRelsDoc = await readXml(relsPathOf(drawingPath));
        const dRels = dRelsDoc ? parseRels(dRelsDoc) : {};
        const dDir = dirOf(drawingPath);

        const { charts: frames, pics } = parseDrawingXml(drawingDoc);

        for (const frame of frames) {
          const cTarget = dRels[frame.chartRelId];
          if (!cTarget) continue;
          const chartDoc = await readXml(resolvePath(dDir, cTarget));
          if (!chartDoc) continue;
          const chart = parseChartXml(chartDoc);
          if (!chart) continue;
          charts.push({
            from: frame.from,
            to: frame.to,
            size: frame.size,
            chart,
          });
        }

        for (const pic of pics) {
          const iTarget = dRels[pic.embedRelId];
          if (!iTarget) continue;
          const mediaPath = resolvePath(dDir, iTarget);
          const f = zip.file(mediaPath);
          if (!f) continue;
          const ext = (mediaPath.split(".").pop() || "png").toLowerCase();
          const b64 = await f.async("base64");
          images.push({
            from: pic.from,
            to: pic.to,
            size: pic.size,
            src: `data:${IMG_MIME[ext] || "image/" + ext};base64,${b64}`,
          });
        }
      }
      if (charts.length || images.length) result[name] = { charts, images };
    }

    return result;
  } catch (e) {
    // Chart/ảnh chỉ là phần "trang trí": lỗi ở đây không được làm sập trang xem file.
    console.warn("[excelChartXml] không đọc được chart/ảnh:", e);
    return {};
  }
}

/**
 * Bỏ toàn bộ drawing khỏi file .xlsx và trả về ArrayBuffer mới.
 * Dùng khi ExcelJS ném lỗi ở xlsx.load vì drawing khai namespace mặc định
 * (`<wsDr>` thay vì `<xdr:wsDr>`) — bỏ drawing thì ExcelJS nạp được, còn ảnh và
 * biểu đồ vẫn hiển thị vì parseDrawings() đọc từ bytes GỐC.
 */
export async function stripDrawings(bytes) {
  const JSZip = (await import("jszip")).default || (await import("jszip"));
  const ab =
    bytes instanceof ArrayBuffer
      ? bytes
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const zip = await JSZip.loadAsync(ab);

  for (const path of Object.keys(zip.files)) {
    if (/^xl\/drawings\//.test(path)) zip.remove(path);
  }
  // Bỏ luôn thẻ <drawing r:id="..."/> trong sheet, nếu không ExcelJS vẫn tra
  // model.drawings[name] rồi lỗi undefined ở worksheet-xform.
  for (const path of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/sheet[^/]*\.xml$/.test(path)) continue;
    const xml = await zip.file(path).async("string");
    zip.file(path, xml.replace(/<(\w+:)?drawing\b[^>]*\/>/g, ""));
  }
  return zip.generateAsync({ type: "arraybuffer" });
}

export default parseDrawings;
