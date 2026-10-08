import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

// Các mức của nút − / +. Chụm hai ngón thì zoom LIÊN TỤC nên chỉ bị chặn bởi
// ZOOM_MIN/ZOOM_MAX, không bám theo danh sách này.
const ZOOMS = [
  0.25, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
];
const ZOOM_MIN = ZOOMS[0];
const ZOOM_MAX = ZOOMS[ZOOMS.length - 1];
const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
const ROW_HDR_W = 46;

export default function ExcelGrid({ model }) {
  const [si, setSi] = useState(0);
  const [sel, setSel] = useState(null); // {r1,c1,r2,c2} - toạ độ 1-based (theo Excel)
  const [showHidden, setShowHidden] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [geom, setGeom] = useState(null); // { colLeft[], rowTop[], rowH[], headH }
  // "auto" = tự bỏ ghim khi chỗ còn lại quá chật (xem col/rowFreezeActive).
  const [colFreezeMode, setColFreezeMode] = useState("auto"); // auto | on | off
  const [rowFreezeMode, setRowFreezeMode] = useState("auto");
  const [resizeTick, setResizeTick] = useState(0);
  const selecting = useRef(false);
  const lastPtr = useRef("mouse"); // loại con trỏ của thao tác gần nhất
  const tableRef = useRef(null);
  const scrollRef = useRef(null);
  const wrapRef = useRef(null);
  // Zoom hiện tại dưới dạng ref: listener pinch gắn 1 lần nên không đọc được
  // state qua closure.
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const pinching = useRef(false); // đang chụm hai ngón -> hoãn đo lại lưới
  // Trục nào đang có ghim (dùng trong listener pinch, xem onStart).
  const freezeOn = useRef({ row: false, col: false });
  // Điểm neo của lần đổi zoom gần nhất: { mx,my } toạ độ trong khung nhìn và
  // { x,y } điểm nội dung (chưa zoom) phải nằm đúng chỗ đó sau khi zoom.
  const anchor = useRef(null);

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
    if (!tbl || !wrap || !sheet || !tbl.tHead || !tbl.tBodies[0]) {
      setGeom(null);
      return;
    }
    // Đang chụm hai ngón: giữ geom cũ. geom đã ở hệ toạ độ CHƯA zoom nên không
    // đổi theo zoom; đo lại giữa cử chỉ chỉ tốn vài trăm getBoundingClientRect
    // mỗi frame -> pinch giật. Đo lại một lần khi nhả tay (resizeTick).
    if (pinching.current) return;

    const z = zoom || 1;
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

    // Bề rộng/chiều cao khối đóng băng (đã gồm cột số dòng và dải tiêu đề cột)
    // và cỡ khung nhìn — dùng để quyết định có ghim hay không khi chỗ quá chật
    // (xem colFreezeActive / rowFreezeActive). Tất cả ở hệ toạ độ CHƯA zoom,
    // giống colLeft/rowTop; cỡ khung nhìn chia cho z nên khi zoom to thì
    // "khung nhìn quy đổi" nhỏ lại -> tự bỏ ghim, đúng như cảm nhận thật.
    const fc = (sheet.freeze && sheet.freeze.cols) || 0;
    let frozenW = 0;
    if (fc > 0) {
      let p = -1;
      visIdx.forEach((c0, k) => {
        if (c0 + 1 <= fc) p = k;
      });
      if (p >= 0) frozenW = (colLeft[p + 1] || 0) + (colW[p + 1] || 0);
    }
    const fr = (sheet.freeze && sheet.freeze.rows) || 0;
    let frozenH = 0;
    if (fr > 0) {
      let p = -1;
      visRows.forEach((r0, k) => {
        if (r0 + 1 <= fr) p = k;
      });
      if (p >= 0) frozenH = (rowTop[p] || 0) + (rowH[p] || 0);
    }
    const viewW = (scrollRef.current?.clientWidth || wrapRect.width) / z;
    const viewH = (scrollRef.current?.clientHeight || wrapRect.height) / z;

    setGeom({
      colLeft,
      colW,
      rowTop,
      rowH,
      headH,
      frozenW,
      frozenH,
      viewW,
      viewH,
    });
    // `sheet` và `visIdx` CỐ Ý không nằm trong deps: `colHidden` fallback về `[]`
    // mới mỗi lần render nên visIdx có thể đổi identity liên tục -> effect chạy
    // lại -> setGeom -> render -> vòng lặp. Chúng chỉ đổi cùng lúc với
    // model/si/showHidden, đã có trong deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [si, showHidden, zoom, model, visIdx.length, visRows.length, resizeTick]);

  // --- Zoom -----------------------------------------------------------------
  // Đổi zoom kèm ĐIỂM NEO: điểm nội dung `at.x/at.y` (đơn vị chưa zoom) phải
  // vẫn nằm ở `at.mx/at.my` trong khung nhìn sau khi zoom, nếu không lưới sẽ
  // nhảy đi mất chỗ đang xem. Việc chỉnh scrollLeft/Top làm ở useLayoutEffect
  // bên dưới, sau khi DOM đã áp zoom mới.
  const applyZoom = useCallback((z, at) => {
    const nz = clampZoom(z);
    anchor.current = at || null;
    zoomRef.current = nz;
    setZoom(nz);
  }, []);

  useLayoutEffect(() => {
    const sc = scrollRef.current;
    const at = anchor.current;
    anchor.current = null;
    if (!sc || !at) return;
    sc.scrollLeft = at.x * zoom - at.mx;
    sc.scrollTop = at.y * zoom - at.my;
  }, [zoom]);

  // Chụm hai ngón để zoom (và Ctrl+lăn chuột / chụm trên trackpad).
  //
  // Listener phải gắn TAY với { passive:false }: React đăng ký touchmove/wheel
  // ở root dạng passive, preventDefault() trong onTouchMove/onWheel của React
  // không có tác dụng -> Safari sẽ zoom CẢ TRANG thay vì để ta zoom lưới.
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;

    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    // Điểm nội dung (chưa zoom) đang nằm dưới toạ độ màn hình (cx, cy).
    const at = (cx, cy, z) => {
      const r = sc.getBoundingClientRect();
      const mx = cx - r.left;
      const my = cy - r.top;
      return { mx, my, x: (sc.scrollLeft + mx) / z, y: (sc.scrollTop + my) / z };
    };

    let start = null; // { d0, z0, sl0, st0, at, last }

    const onStart = (e) => {
      if (e.touches.length !== 2) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      const z = zoomRef.current;
      const d0 = dist(a, b);
      if (!d0) return;
      pinching.current = true;
      const r = sc.getBoundingClientRect();
      // ĐIỂM NEO của cử chỉ. Bình thường neo vào tâm hai ngón cho tự nhiên,
      // NHƯNG trục nào đang có dải đóng băng thì neo vào MÉP khung nhìn (mx/my
      // = 0): dải đóng băng bám ở mép, nếu neo giữa màn hình thì trong lúc chụm
      // nó bị scale trôi đi rồi khi nhả tay sticky ghim lại -> nhảy giật (đo
      // được 253px với 6 dòng tiêu đề của DHN). Neo vào mép thì mép trên/trái
      // của dải là điểm cố định, dải chỉ nở ra chứ không dịch chỗ.
      const mx = freezeOn.current.col ? 0 : (a.clientX + b.clientX) / 2 - r.left;
      const my = freezeOn.current.row ? 0 : (a.clientY + b.clientY) / 2 - r.top;
      start = {
        d0,
        z0: z,
        last: z,
        sl0: sc.scrollLeft,
        st0: sc.scrollTop,
        at: {
          mx,
          my,
          x: (sc.scrollLeft + mx) / z,
          y: (sc.scrollTop + my) / z,
        },
      };
      if (wrapRef.current) wrapRef.current.classList.add("xlpinch");
    };

    // TRONG lúc chụm chỉ dùng `transform: scale()`, KHÔNG đổi `zoom` và KHÔNG
    // setState.
    //
    // Vì sao: đổi `zoom` bắt trình duyệt layout lại toàn bộ bảng (DHN ~290 dòng
    // × ~20 cột) VÀ tính lại vị trí của mọi ô position:sticky, mỗi frame một
    // lần. Dải dòng đóng băng ở trên vì thế cứ chực bám lại chỗ cũ trong lúc
    // phần còn lại đã phóng to -> trông như bị trễ/giật đúng ở mấy hàng đầu.
    // transform thì chỉ chạy ở compositor: cả lưới (kể cả dải đóng băng) phóng
    // to như một tấm ảnh, không layout, không tính lại sticky. Khi nhả tay mới
    // commit `zoom` thật một lần và ghim lại sticky.
    //
    // Toạ độ: scroll KHÔNG đổi trong lúc chụm, nên điểm neo (đang ở scroller-x
    // = sl0 + mx) sau khi scale k sẽ nhảy tới (sl0 + mx) * k - sl0; cần dịch
    // thêm S để nó về lại mx. Giá trị translate viết trong hệ CSS của .xlwrap
    // (đang bị `zoom: z0` nhân lên) nên phải chia lại cho z0.
    const onMove = (e) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault(); // chặn pinch-zoom + cuộn của trình duyệt
      const wrap = wrapRef.current;
      if (!wrap) return;
      const { z0, sl0, st0 } = start;
      // Kẹp ngay trên k để lúc nhả tay không bị "giật" về mức đã kẹp.
      const k = clampZoom(z0 * (dist(e.touches[0], e.touches[1]) / start.d0)) / z0;
      const sx = start.at.mx + sl0 - (sl0 + start.at.mx) * k;
      const sy = start.at.my + st0 - (st0 + start.at.my) * k;
      start.last = z0 * k;
      wrap.style.transform = `translate(${sx / z0}px, ${sy / z0}px) scale(${k})`;
    };

    const onEnd = () => {
      if (!start) return;
      const { last, at: anchorAt } = start;
      start = null;
      pinching.current = false;
      const wrap = wrapRef.current;
      if (wrap) {
        // Bỏ transform và commit zoom trong CÙNG một lượt xử lý sự kiện: React
        // 18 flush trước khi vẽ frame kế tiếp nên không thấy nháy về cỡ cũ.
        wrap.style.transform = "";
        wrap.classList.remove("xlpinch");
      }
      applyZoom(last, anchorAt); // commit state + con số % ở thanh trạng thái
      setResizeTick((t) => t + 1); // đo lại lưới sau khi nhả tay
    };

    // Safari còn phát gesturestart/gesturechange riêng; không chặn thì vẫn zoom
    // cả trang song song với zoom lưới.
    const onGesture = (e) => e.preventDefault();

    const onWheel = (e) => {
      if (!e.ctrlKey) return; // chụm trackpad / Ctrl+lăn = zoom, còn lại là cuộn
      e.preventDefault();
      const z = zoomRef.current;
      applyZoom(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), at(e.clientX, e.clientY, z));
    };

    sc.addEventListener("touchstart", onStart, { passive: false });
    sc.addEventListener("touchmove", onMove, { passive: false });
    sc.addEventListener("touchend", onEnd);
    sc.addEventListener("touchcancel", onEnd);
    sc.addEventListener("gesturestart", onGesture);
    sc.addEventListener("gesturechange", onGesture);
    sc.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      sc.removeEventListener("touchstart", onStart);
      sc.removeEventListener("touchmove", onMove);
      sc.removeEventListener("touchend", onEnd);
      sc.removeEventListener("touchcancel", onEnd);
      sc.removeEventListener("gesturestart", onGesture);
      sc.removeEventListener("gesturechange", onGesture);
      sc.removeEventListener("wheel", onWheel);
    };
  }, [applyZoom]);

  // Quay ngang máy / đổi cỡ cửa sổ / thanh địa chỉ Safari co lại -> đo lại
  // viewW để tính lại việc ghim cột.
  //
  // Theo dõi bằng ResizeObserver trên chính khung cuộn, KHÔNG chỉ nghe window
  // resize: có trường hợp khung nhìn đổi kích thước mà window không phát resize
  // (đã gặp khi đổi cỡ viewport bằng emulation của DevTools) -> geom giữ viewW
  // cũ, ghim cột tính sai. Zoom không làm .xlscroll đổi cỡ (chỉ .xlwrap bên
  // trong bị scale) nên không có vòng lặp observer.
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    const bump = () => setResizeTick((t) => t + 1);
    let ro = null;
    if (sc && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(bump);
      ro.observe(sc);
    }
    // Giữ CẢ hai: callback của ResizeObserver được phát trong vòng render của
    // trang nên tab bị ẩn/không vẽ frame thì không tới (đã đo), còn listener
    // resize thì chạy ngay.
    window.addEventListener("resize", bump);
    window.addEventListener("orientationchange", bump);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", bump);
      window.removeEventListener("orientationchange", bump);
    };
  }, []);

  // Đổi sheet thì về góc trên-trái, tránh giữ vị trí cuộn của sheet trước.
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (sc) {
      sc.scrollTop = 0;
      sc.scrollLeft = 0;
    }
  }, [si]);

  if (!sheet) return null;

  const freeze = sheet.freeze || null;

  // Nút − / + : nhảy tới mức kế tiếp trong ZOOMS, neo vào TÂM khung nhìn.
  const zoomStep = (dir) => {
    const sc = scrollRef.current;
    const next =
      dir > 0
        ? ZOOMS.find((v) => v > zoom + 1e-4) ?? ZOOM_MAX
        : [...ZOOMS].reverse().find((v) => v < zoom - 1e-4) ?? ZOOM_MIN;
    let at = null;
    if (sc) {
      const mx = sc.clientWidth / 2;
      const my = sc.clientHeight / 2;
      at = { mx, my, x: (sc.scrollLeft + mx) / zoom, y: (sc.scrollTop + my) / zoom };
    }
    applyZoom(next, at);
  };

  // Bấm vào con số % : về 100%.
  // (KHÔNG làm "vừa bề rộng": bảng DHN rộng ~2500px, nhồi vào 375px là ~15% —
  // dưới cả ZOOM_MIN và chữ nhỏ tới mức không đọc được.)
  const zoomReset = () => {
    const sc = scrollRef.current;
    if (!sc) return applyZoom(1, null);
    // Neo mép trái, giữ nguyên vị trí dọc đang xem.
    applyZoom(1, { mx: 0, my: 0, x: 0, y: sc.scrollTop / zoom });
  };

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
  //
  // TRÊN MÀN HÌNH HẸP PHẢI BỎ GHIM CỘT. File DHN đóng băng tới cột "Nội dung"
  // (rộng ~250px) nên khối ghim + cột số dòng chiếm gần hết bề rộng điện thoại:
  // cuộn ngang thì phần ghim đứng im, chỉ còn vài chục pixel cho dữ liệu chạy
  // qua -> người dùng thấy "không kéo ngang được". Khi khối ghim chiếm > 55%
  // khung nhìn thì tự bỏ ghim cột (vẫn giữ ghim DÒNG tiêu đề); người dùng bật
  // lại được bằng ô "Ghim cột" ở thanh trạng thái.
  const colFreezeCramped =
    !!geom && geom.frozenW > 0 && geom.frozenW > geom.viewW * 0.55;
  const colFreezeActive =
    !!freeze &&
    freeze.cols > 0 &&
    (colFreezeMode === "on" ||
      (colFreezeMode === "auto" && !colFreezeCramped));

  // Dòng đóng băng cũng vậy: file DHN ghim 6 dòng tiêu đề, phóng to 300% thì
  // dải này cao gấp 3 và KHÔNG cuộn đi được -> chiếm nửa màn hình. Quá 50%
  // chiều cao khung nhìn thì tự bỏ ghim dòng.
  const rowFreezeCramped =
    !!geom && geom.frozenH > 0 && geom.frozenH > geom.viewH * 0.5;
  const rowFreezeActive =
    !!freeze &&
    freeze.rows > 0 &&
    (rowFreezeMode === "on" ||
      (rowFreezeMode === "auto" && !rowFreezeCramped));

  freezeOn.current = { row: rowFreezeActive, col: colFreezeActive };

  const isFrozenCol = (c1) => colFreezeActive && c1 <= freeze.cols; // c1: 1-based
  const isFrozenRow = (r1) => rowFreezeActive && r1 <= freeze.rows;

  // Ở mức zoom lẻ (125%, 150%...) chiều cao dòng thành số thập phân, Chrome làm
  // tròn vị trí ghim theo pixel thiết bị khác nhau ở mỗi dòng -> hở ~0,3px giữa
  // các dòng đã ghim và nội dung đang cuộn lộ qua. Lùi 0,5px cho các ô ghim CHỒNG
  // nhẹ lên nhau thay vì hở. Ở 100% thì không lùi để đường kẻ không bị nhoè.
  const bias = Math.abs(zoom - 1) < 1e-4 ? 0 : 0.5;

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
                          // Chỉ CHUỘT mới kéo-chọn vùng. Ngón tay kéo trên ô mà
                          // cũng chọn vùng thì mỗi lần di là một lần setState ->
                          // re-render giữa cử chỉ, cuộn ngang bị chặn/giật.
                          // Cảm ứng thì chỉ chạm 1 ô để xem địa chỉ (onClick).
                          onPointerDown={(e) => {
                            lastPtr.current = e.pointerType || "mouse";
                            if (lastPtr.current === "mouse")
                              start(cell.r, cell.c);
                          }}
                          onPointerEnter={(e) => {
                            if ((e.pointerType || "mouse") === "mouse")
                              move(cell.r, cell.c);
                          }}
                          onClick={() => {
                            if (lastPtr.current !== "mouse")
                              setSel({
                                r1: cell.r,
                                c1: cell.c,
                                r2: cell.r,
                                c2: cell.c,
                              });
                          }}
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
          {!!freeze && freeze.cols > 0 && (
            <label className="xlhiddentoggle" title="Ghim các cột đầu khi cuộn ngang">
              <input
                type="checkbox"
                checked={colFreezeActive}
                onChange={(e) =>
                  setColFreezeMode(e.target.checked ? "on" : "off")
                }
              />
              Ghim cột
            </label>
          )}
          {!!freeze && freeze.rows > 0 && (
            <label className="xlhiddentoggle" title="Ghim các dòng tiêu đề khi cuộn dọc">
              <input
                type="checkbox"
                checked={rowFreezeActive}
                onChange={(e) =>
                  setRowFreezeMode(e.target.checked ? "on" : "off")
                }
              />
              Ghim dòng
            </label>
          )}
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
              onClick={() => zoomStep(-1)}
              disabled={zoom <= ZOOM_MIN + 1e-4}
              title="Thu nhỏ"
            >
              −
            </button>
            <button
              type="button"
              className="xlzoomval"
              onClick={zoomReset}
              title="Về 100% (trên điện thoại chụm hai ngón để phóng to/thu nhỏ)"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => zoomStep(1)}
              disabled={zoom >= ZOOM_MAX - 1e-4}
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
