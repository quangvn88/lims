import React, { useEffect, useRef, useState } from "react";
import { formatCellValue } from "../utils/excelNumFmt";

// Vẽ 1 biểu đồ của file Excel bằng ECharts, từ spec do excelChartXml.parseCharts
// trả về. ECharts được import ĐỘNG: sheet không có chart thì không tải thư viện.
//
// Excel 3D (bar3DChart/pie3DChart) được vẽ THÀNH 2D: ECharts không có cột 3D
// dạng Excel, mà số liệu/nhãn/màu là phần người dùng cần đọc nên vẽ 2D vẫn đúng
// nội dung, chỉ khác hiệu ứng khối.

// Bảng màu mặc định của Office, dùng cho series không khai màu riêng.
const PALETTE = [
  "#4472c4",
  "#ed7d31",
  "#a5a5a5",
  "#ffc000",
  "#5b9bd5",
  "#70ad47",
  "#264478",
  "#9e480e",
  "#636363",
  "#997300",
];

const fmt = (v, code) => {
  if (v == null) return "";
  if (!code) return typeof v === "number" ? formatCellValue(v, "#,##0.###").text : String(v);
  try {
    return formatCellValue(v, code).text;
  } catch (e) {
    return String(v);
  }
};

const LEGEND_POS = {
  t: { top: 6, left: "center", orient: "horizontal" },
  b: { bottom: 2, left: "center", orient: "horizontal" },
  l: { left: 2, top: "middle", orient: "vertical" },
  r: { right: 2, top: "middle", orient: "vertical" },
  tr: { right: 2, top: 6, orient: "vertical" },
};

function isPieLike(type) {
  return /pie|doughnut/i.test(type);
}

/** spec chart -> option của ECharts. `width` dùng để chia bề rộng nhãn trục. */
function buildOption(chart, width) {
  const plots = chart.plots || [];
  const allSeries = [];
  let categories = null;
  let horizontal = false;
  let pieLike = false;
  let radarLike = false;
  let valueFmt = null;

  const valAx = (chart.axes || []).find((a) => a.kind === "valAx");
  const catAx = (chart.axes || []).find(
    (a) => a.kind === "catAx" || a.kind === "dateAx"
  );

  plots.forEach((plot) => {
    const type = plot.type;
    if (isPieLike(type)) pieLike = true;
    if (/radar/i.test(type)) radarLike = true;
    if (/bar/i.test(type) && plot.barDir === "bar") horizontal = true;

    const stack =
      plot.grouping === "stacked" || plot.grouping === "percentStacked"
        ? "st-" + type
        : undefined;

    (plot.series || []).forEach((ser, si) => {
      const cat = ser.cat && ser.cat.values ? ser.cat.values : [];
      if (!categories && cat.length) categories = cat.map((v) => (v == null ? "" : String(v)));
      const vals = (ser.val && ser.val.values) || [];
      if (!valueFmt && ser.val && ser.val.formatCode) valueFmt = ser.val.formatCode;

      const baseColor = ser.color && ser.color !== "transparent"
        ? ser.color
        : PALETTE[(ser.order != null ? ser.order : si) % PALETTE.length];
      const pc = ser.pointColors || {};
      const hasPointColors = Object.keys(pc).length > 0;
      // Nền từng cột khác nhau (dPt) -> itemStyle nhận hàm theo dataIndex.
      const itemColor = hasPointColors
        ? (p) => pc[p.dataIndex] || baseColor
        : baseColor;

      const dl = ser.dLbls || plot.dLbls;
      const labelFmtCode =
        (dl && dl.numFmt) || (ser.val && ser.val.formatCode) || null;
      const label = dl
        ? {
            show: !!(dl.showVal || dl.showPercent || dl.showCatName),
            position: pieLike ? "outside" : horizontal ? "right" : "top",
            fontSize: 11,
            formatter: (p) => {
              const parts = [];
              if (dl.showCatName) parts.push(p.name);
              if (dl.showVal) parts.push(fmt(pieLike ? p.value : p.value, labelFmtCode));
              if (dl.showPercent) parts.push(Math.round(p.percent) + "%");
              return parts.join(" ");
            },
          }
        : { show: false };

      if (isPieLike(type)) {
        const hole = plot.holeSize != null ? plot.holeSize : /doughnut/i.test(type) ? 50 : 0;
        allSeries.push({
          type: "pie",
          name: ser.name || "",
          radius: hole ? [hole + "%", "72%"] : "72%",
          center: ["50%", "55%"],
          label,
          labelLine: { show: !!(label && label.show) },
          data: vals.map((v, i) => ({
            name: cat[i] != null ? String(cat[i]) : "",
            value: v,
            itemStyle: { color: pc[i] || PALETTE[i % PALETTE.length] },
          })),
        });
        return;
      }

      if (/scatter|bubble/i.test(type)) {
        const xs = (ser.xVal && ser.xVal.values) || [];
        allSeries.push({
          type: "scatter",
          name: ser.name || "",
          itemStyle: { color: baseColor },
          symbolSize: 8,
          label,
          data: vals.map((v, i) => [xs[i] != null ? xs[i] : i, v]),
        });
        return;
      }

      if (/radar/i.test(type)) {
        allSeries.push({
          type: "radar",
          name: ser.name || "",
          itemStyle: { color: baseColor },
          data: [{ value: vals, name: ser.name || "" }],
        });
        return;
      }

      if (/line/i.test(type)) {
        allSeries.push({
          type: "line",
          name: ser.name || "",
          stack,
          smooth: !!ser.smooth,
          symbol:
            ser.marker && ser.marker.symbol === "none" ? "none" : "circle",
          symbolSize: 6,
          lineStyle: { width: ser.lineWidth || 2, color: baseColor },
          itemStyle: { color: baseColor },
          label,
          connectNulls: false,
          data: vals,
        });
        return;
      }

      if (/area/i.test(type)) {
        allSeries.push({
          type: "line",
          name: ser.name || "",
          stack: stack || "area",
          areaStyle: { color: baseColor, opacity: 0.65 },
          lineStyle: { width: 1, color: baseColor },
          itemStyle: { color: baseColor },
          showSymbol: false,
          label,
          data: vals,
        });
        return;
      }

      // barChart / bar3DChart / mặc định
      allSeries.push({
        type: "bar",
        name: ser.name || "",
        stack,
        barMaxWidth: 60,
        itemStyle: {
          color: itemColor,
          borderColor:
            ser.borderColor && ser.borderColor !== "transparent"
              ? ser.borderColor
              : undefined,
        },
        label,
        data: vals,
      });
    });
  });

  const seriesNames = allSeries.map((s) => s.name).filter(Boolean);
  // Theo đúng file: có thẻ <c:legend> thì hiện chú thích (Excel cũng vậy, kể cả
  // khi chỉ có 1 series). Chart không khai legend thì không hiện.
  const showLegend = !!chart.legend && (seriesNames.length > 0 || pieLike);
  const legendPos = showLegend ? chart.legend.pos || "r" : null;
  // Chú thích dọc bên phải/trái phải được CHỪA CHỖ theo độ dài tên series, nếu
  // không chữ bị cắt mất ở rìa khung biểu đồ.
  const legendW = showLegend
    ? Math.min(
        Math.round((width || 480) * 0.42),
        Math.ceil(
          Math.max(0, ...seriesNames.map((s) => String(s).length * 6.3)) + 28
        )
      )
    : 0;
  const legendCfg = showLegend
    ? {
        ...(LEGEND_POS[legendPos] || LEGEND_POS.r),
        type: "scroll",
        itemWidth: 14,
        itemHeight: 9,
        textStyle: { fontSize: 11 },
        ...(legendPos === "r" || legendPos === "l" || legendPos === "tr"
          ? { width: legendW }
          : {}),
      }
    : { show: false };

  const axisLabelFmt = (v) => fmt(v, valAx && valAx.numFmt ? valAx.numFmt : valueFmt);

  const valueAxis = {
    type: "value",
    show: !(valAx && valAx.deleted),
    min: valAx && valAx.min != null ? valAx.min : undefined,
    max: valAx && valAx.max != null ? valAx.max : undefined,
    inverse: !!(valAx && valAx.reverse),
    name: (valAx && valAx.title) || "",
    nameTextStyle: { fontSize: 11 },
    axisLabel: { fontSize: 11, formatter: axisLabelFmt },
    splitLine: { show: !valAx || valAx.majorGridlines !== false },
  };
  const catData =
    categories || allSeries[0]?.data?.map((_, i) => String(i + 1)) || [];
  // Nhãn trục dài (tên mặt hàng) phải XUỐNG DÒNG thay vì bị ẩn: hideOverlap sẽ
  // âm thầm bỏ bớt nhãn -> người xem tưởng thiếu dữ liệu.
  const slotW = Math.max(
    24,
    Math.floor(((width || 480) - 70) / Math.max(1, catData.length)) - 4
  );
  const catLabelLong = catData.some((s) => String(s).length * 6 > slotW);
  const categoryAxis = {
    type: "category",
    show: !(catAx && catAx.deleted),
    data: catData,
    name: (catAx && catAx.title) || "",
    nameTextStyle: { fontSize: 11 },
    axisLabel: {
      fontSize: 11,
      interval: 0,
      hideOverlap: false,
      ...(catLabelLong
        ? { width: slotW, overflow: "break", lineHeight: 12 }
        : {}),
    },
    axisTick: { alignWithLabel: true },
  };

  const option = {
    animation: false,
    textStyle: { fontFamily: "Calibri, Arial, sans-serif" },
    title: chart.title
      ? {
          text: chart.title,
          left: "center",
          top: 4,
          textStyle: { fontSize: 13, fontWeight: 600, color: "#333" },
        }
      : { show: false },
    tooltip: {
      trigger: pieLike || radarLike ? "item" : "axis",
      axisPointer: { type: "shadow" },
      valueFormatter: (v) => fmt(v, valueFmt),
    },
    legend: legendCfg,
    grid: {
      left: legendPos === "l" ? legendW + 8 : 8,
      right: legendPos === "r" || legendPos === "tr" ? legendW + 8 : 16,
      top: (chart.title ? 30 : 14) + (legendPos === "t" ? 18 : 0),
      bottom: legendPos === "b" ? 26 : 8,
      containLabel: true,
    },
    series: allSeries,
  };

  if (pieLike) {
    // pie không có trục
  } else if (radarLike) {
    option.radar = {
      indicator: (categories || []).map((c) => ({ name: c })),
      radius: "62%",
    };
  } else if (allSeries.some((s) => s.type === "scatter")) {
    option.xAxis = { type: "value", axisLabel: { fontSize: 11 } };
    option.yAxis = valueAxis;
  } else if (horizontal) {
    option.xAxis = valueAxis;
    option.yAxis = { ...categoryAxis, inverse: true };
  } else {
    option.xAxis = categoryAxis;
    option.yAxis = valueAxis;
  }

  // percentStacked: Excel hiển thị theo % tổng -> chuẩn hoá số liệu.
  if (plots.some((p) => p.grouping === "percentStacked")) {
    const len = Math.max(...allSeries.map((s) => (s.data || []).length), 0);
    for (let i = 0; i < len; i++) {
      const total = allSeries.reduce((t, s) => t + (Number(s.data[i]) || 0), 0);
      if (!total) continue;
      allSeries.forEach((s) => {
        if (s.data[i] != null) s.data[i] = (Number(s.data[i]) / total) * 100;
      });
    }
    if (option.yAxis && option.yAxis.type === "value")
      option.yAxis.axisLabel = { fontSize: 11, formatter: (v) => v + "%" };
  }

  return option;
}

export default function ExcelChart({ chart, width, height }) {
  const boxRef = useRef(null);
  const instRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let ro = null;

    (async () => {
      try {
        const echarts = await import("echarts");
        if (disposed || !boxRef.current) return;
        const inst = echarts.init(boxRef.current, null, { renderer: "canvas" });
        instRef.current = inst;
        inst.setOption(buildOption(chart, width), true);
        // Chart nằm trong lưới có thể đổi kích thước khi zoom/đổi sheet.
        if (typeof ResizeObserver !== "undefined") {
          ro = new ResizeObserver(() => inst.resize());
          ro.observe(boxRef.current);
        }
      } catch (e) {
        console.warn("[ExcelChart] không vẽ được biểu đồ:", e);
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      if (ro) ro.disconnect();
      if (instRef.current) {
        instRef.current.dispose();
        instRef.current = null;
      }
    };
  }, [chart, width]);

  if (failed) {
    return (
      <div className="xlchart xlchart-failed" style={{ width, height }}>
        <span>📊 {chart.title || "Biểu đồ"} (không hiển thị được)</span>
      </div>
    );
  }

  return <div className="xlchart" ref={boxRef} style={{ width, height }} />;
}
