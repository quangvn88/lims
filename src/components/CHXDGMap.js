import React, {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { useLocation } from "react-router-dom";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import MapTypeSelect from "./MapTypeSelect";
import "./CHXDGMap.css";

// Lượng bán (MENGE_BQ / MENGE_BQ_V) SAP trả dạng thập phân (535470.125) ->
// làm tròn về lít nguyên rồi mới format. Giá và chênh lệch giá giữ nguyên
// định dạng cũ, không làm tròn.
// Locale vi-VN: phân cách nghìn bằng dấu "." (18.530), thập phân bằng ","
// Nguong man hinh hep, trung voi media query trong CHXDGMap.css
const NARROW_PANEL_QUERY = "(max-width: 680px)";

const LOCALE = "vi-VN";
const fmtInt = (v) => Math.round(Number(v) || 0).toLocaleString(LOCALE);
// Lượng bán SAP trả theo lít (MEINS='L'); hiển thị quy đổi sang m3 cho gọn.
const fmtM3 = (v) => fmtInt((Number(v) || 0) / 1000);

// Nền bản đồ. Cả 2 lấy từ server.arcgisonline.com: tile OSM
// (tile.openstreetmap.org, kể cả {s}.tile...) bị chặn từ mạng nội bộ nên
// option "Đường phố" trước đây ra bản đồ trắng.
const TILE_LAYERS = {
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, Maxar, Earthstar Geographics",
    // World_Imagery nhieu vung o VN chi co anh den z18; z19 tra ve tile xam
    // "Map data not yet available" (la anh hop le nen Leaflet khong fallback
    // duoc) -> giu tran 18. Cung khong bat detectRetina vi no an bot 1 muc
    // zoom, doi lay do net khong dung o day.
    maxZoom: 18,
    maxNativeZoom: 18,
  },
  street: {
    // Doi tu Esri World_Street_Map sang OsmAnd HD: Esri gan nhu chi co truc
    // duong lon o VN, thieu ngo va ten duong. OsmAnd dung du lieu OSM nen day
    // du hon nhieu. Luu y thu tu tile la {z}/{x}/{y} (OSM), khac Esri {z}/{y}/{x}.
    url: "https://tile.osmand.net/hd/{z}/{x}/{y}.png",
    attribution:
      "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors, tiles: OsmAnd",
    // Tile HD la anh 512px cho dung 1 o tile chuan -> giu tileSize 256 de
    // trinh duyet thu nho lai, tuc la mat do diem gap doi (nhu tile @2x).
    // Vi vay KHONG bat detectRetina, neu khong Leaflet se lay them 1 muc zoom
    // nua va chu tren ban do bi nho di.
    tileSize: 256,
    // Da kiem tra Ha Noi + Cao Bang: co tile that den z19, z20 tra ve HTTP 404.
    maxZoom: 19,
    maxNativeZoom: 19,
    // tile.osmand.net khong tra header Access-Control-Allow-Origin, nen de
    // crossOrigin: true (mac dinh trong TILE_OPTIONS cho Esri) thi TOAN BO
    // tile bao loi va ban do trang. Khong cho nao doc pixel cua tile nen tat
    // duoc an toan.
    crossOrigin: false,
  },
};
// Tuy chon dung chung; gioi han zoom va detectRetina khai bao rieng tung nen
// trong TILE_LAYERS vi 2 service co muc chi tiet khac nhau.
const TILE_OPTIONS = {
  updateWhenZooming: false,
  updateWhenIdle: true,
  keepBuffer: 1,
  tileSize: 256,
  zoomOffset: 0,
  crossOrigin: true,
};

const CHXDGMap = () => {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const bukrsParam =
    searchParams.get("I_BUKRS") || searchParams.get("i_bukrs") || "";
  const chxdIdParam =
    searchParams.get("i_chxdid") || searchParams.get("I_CHXDID") || "";
  const matnrParam =
    searchParams.get("i_matnr") || searchParams.get("I_MATNR") || "";
  const targetId = chxdIdParam;
  // Không truyền i_matnr -> bỏ hẳn phần mặt hàng/giá. ZFM_CHXD_GMAP khi
  // I_MATNR rỗng chỉ trả về mặt hàng ĐẦU TIÊN của từng CHXD, nên mỗi cửa hàng
  // ra một loại nhiên liệu khác nhau (E5, RON95, DO...) - giá không so được.
  const hasMatnr = !!matnrParam;

  const mapRef = useRef(null);
  const markerGroupRef = useRef(null);
  const lineGroupRef = useRef(null);
  const showTextRef = useRef(false);
  const initialViewSet = useRef(false);
  const markerSizeCache = useRef(new Map());
  const fontSizeCache = useRef(new Map());
  // Layer/dữ liệu CHXD của các đơn vị khác (toàn quốc)
  const aroundGroupRef = useRef(null);
  const othersGroupRef = useRef(null);
  const othersRendererRef = useRef(null);
  const othersFetchedRef = useRef(false);

  const [coords, setCoords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showLines, setShowLines] = useState(false);
  const [showText, setShowText] = useState(false);
  const [showPrice_Change, setShowPrice_Change] = useState(hasMatnr);
  const [showPrice_Change_TT, setShowPrice_Change_TT] = useState(false);
  // Lượng bán bình quân: của chính CHXD (MENGE_BQ) và của CHXD PLX lân cận
  // trong vòng 10km (MENGE_BQ_V). Không phụ thuộc mặt hàng nên chạy cả khi
  // URL không có i_matnr.
  const [showMengeBQ, setShowMengeBQ] = useState(false);
  const [showMengeBQ_V, setShowMengeBQ_V] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapType, setMapType] = useState("satellite");
  const [showControls, setShowControls] = useState(true);
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showListPanel, setShowListPanel] = useState(true);
  const [categoryFilters, setCategoryFilters] = useState({
    PLX: true,
    PVI: true,
    OTH: true,
    NEW: true,
    TNNQ: true,
    DKDT: true,
  });
  // Man hinh hep: 3 panel se de len nhau -> thu gon bot va chi mo lan luot
  const [isNarrow, setIsNarrow] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(NARROW_PANEL_QUERY).matches
  );
  const [zoom, setZoom] = useState(6);
  const [imageReady, setImageReady] = useState(false);
  // URL anh dang mo o che do xem lon (lightbox); null = dang dong
  const [zoomedImage, setZoomedImage] = useState(null);

  // Cửa hàng xung quanh (ngoài BUKRS đang chọn) - mặc định bật
  const [showAround, setShowAround] = useState(true);
  const [othersCoords, setOthersCoords] = useState([]);
  const [othersLoading, setOthersLoading] = useState(false);
  // true sau khi view ban đầu đã được set -> mới bắt đầu tải dữ liệu xung quanh
  const [viewInitialized, setViewInitialized] = useState(false);
  // Khung nhìn hiện tại (cập nhật ở moveend) để lọc CHXD xung quanh
  const [viewBox, setViewBox] = useState(null);
  // CHXD đang chọn không thuộc BUKRS trên URL (mở từ lớp xung quanh)
  const [targetOutOfUnit, setTargetOutOfUnit] = useState(false);

  const [expandedCategories, setExpandedCategories] = useState({});

  const [bukrs_title, setBukrs_title] = useState("");

  // Constants
  const CONSTANTS = {
    MAP_CENTER: [15.5, 107],
    MAP_INITIAL_ZOOM: 6,
    MAP_TARGET_ZOOM: 15,
    MAX_TITLE_LENGTH: 20,
    MIN_TITLE_FONT_SCALE: 0.7,
    NEAREST_STATIONS_COUNT: 10,
    ZOOM_DEBOUNCE_MS: 100,
    EARTH_RADIUS_KM: 6371,
    // zoom <= giá trị này: vẽ toàn quốc dạng điểm; lớn hơn: vẽ marker đầy đủ
    OTHERS_ZOOM_MAX: 10,
    // giới hạn số marker "xung quanh" vẽ đầy đủ trong 1 khung nhìn
    AROUND_MAX_MARKERS: 300,
  };

  // Memoized helper functions
  const getFuelIcon = useCallback((matkl) => {
    const fuel = (matkl || "").toUpperCase();
    if (fuel.includes("0201")) return "/icons/xang92.svg";
    return "/icons/do.svg";
  }, []);

  // Mỗi mức zoom một cỡ riêng (không nhảy 2 bậc mới đổi) để phóng to/thu nhỏ
  // bản đồ là thấy icon lớn/nhỏ theo ngay.
  const getMarkerSize = useCallback((zoom) => {
    const z = Math.round(zoom);
    if (markerSizeCache.current.has(z)) {
      return markerSizeCache.current.get(z);
    }
    const table = {
      18: 54,
      17: 50,
      16: 46,
      15: 42,
      14: 38,
      13: 34,
      12: 30,
      11: 26,
      10: 23,
      9: 20,
      8: 18,
      7: 16,
      6: 14,
      5: 12,
    };
    const size = table[z] || (z > 18 ? 54 : 10);
    markerSizeCache.current.set(z, size);
    return size;
  }, []);

  const getFontSize = useCallback((zoom) => {
    const z = Math.round(zoom);
    if (fontSizeCache.current.has(z)) {
      return fontSizeCache.current.get(z);
    }
    const table = {
      18: 16,
      17: 15,
      16: 14,
      15: 13,
      14: 12,
      13: 11,
      12: 11,
      11: 10,
      10: 10,
      9: 9,
      8: 9,
      7: 8,
      6: 8,
      5: 7,
    };
    const size = table[z] || (z > 18 ? 16 : 6);
    fontSizeCache.current.set(z, size);
    return size;
  }, []);

  const resizeLayersForZoom = useCallback(
    (z) => {
      const size = getMarkerSize(z);
      const fontSize = getFontSize(z);
      [markerGroupRef.current, aroundGroupRef.current].forEach((group) => {
        if (!group) return;
        group.eachLayer((layer) => {
          if (!(layer instanceof L.Marker)) return;
          const opts = layer.options.icon && layer.options.icon.options;
          if (!opts) return;

          if (opts.iconUrl) {
            layer.setIcon(
              L.icon({
                iconUrl: opts.iconUrl,
                iconSize: [size, size],
                iconAnchor: [size / 2, size],
                popupAnchor: [0, -25],
                // giữ class nhấp nháy của CHXD đang chọn
                className: opts.className || "",
              })
            );
            return;
          }

          if (opts.className === "plx-label") {
            const oldHtml = opts.html || "";
            const newHtml = /font-size:\s*\d+px/.test(oldHtml)
              ? oldHtml.replace(/font-size:\s*\d+px/g, `font-size:${fontSize}px`)
              : oldHtml.replace(
                  /style="([^"]*)"/,
                  (m, p1) => `style="${p1}; font-size:${fontSize}px"`
                );
            layer.setIcon(L.divIcon({ ...opts, html: newHtml }));
            const el = layer.getElement();
            if (el) el.style.opacity = 1;
          }
        });
      });
    },
    [getMarkerSize, getFontSize]
  );

  // Handler zoomend của Leaflet là closure tạo 1 lần -> đọc hàm qua ref để
  // luôn gọi bản mới nhất.
  const resizeLayersRef = useRef(null);
  useEffect(() => {
    resizeLayersRef.current = resizeLayersForZoom;
  }, [resizeLayersForZoom]);

  const computeLabelOpacity = useCallback((z) => {
    if (z < 10) return 0;
    if (z >= 15) return 1;
    return (z - 15) / (15 - 10);
  }, []);

  const getPriceChangeColor = useCallback((priceChange) => {
    if (priceChange > 200) {
      return { color: "rgba(255, 255, 255, 1)", bg: "rgba(8, 102, 30, 1)" };
    } else if (priceChange > 100) {
      return { color: "rgba(255, 255, 255, 1)", bg: "rgba(44, 155, 68, 1)" };
    } else if (priceChange >= 0) {
      return { color: "rgba(255, 255, 255, 1)", bg: "rgba(69, 177, 93, 1)" };
    } else if (priceChange < -200) {
      return { color: "rgba(255, 255, 255, 1)", bg: "rgba(150, 10, 24, 1)" };
    } else if (priceChange < -100) {
      return { color: "rgba(255, 255, 255, 1)", bg: "rgba(204, 24, 42, 1)" };
    } else {
      return { color: "rgba(255, 255, 255, 1)", bg: "rgba(241, 54, 21, 1)" };
    }
  }, []);

  // Toàn bộ marker dùng cùng một dạng pin (bo tròn + cột bơm, gốc từ
  // logo_doithu1.png), chỉ khác màu theo nhóm đúng màu trong typeMeta để
  // vẫn phân biệt được nhóm mà nhìn không lộn xộn như khi mỗi nhóm một logo.
  const getIconUrl = useCallback((chxdType) => {
    const baseUrl = process.env.PUBLIC_URL;
    const iconMap = {
      PLX: `${baseUrl}/logo_pin_plx.png`,
      NEW: `${baseUrl}/logo_pin_new.png`,
      PVI: `${baseUrl}/logo_pin_pvi.png`,
      TNNQ: `${baseUrl}/logo_pin_tnnq.png`,
      OTH: `${baseUrl}/logo_pin_oth.png`,
      DKDT: `${baseUrl}/logo_pin_dkdt.png`,
    };
    return iconMap[chxdType] || `${baseUrl}/logo_pin_oth.png`;
  }, []);

  const calculateTitleFontSize = useCallback((titleLength, baseFontSize) => {
    if (titleLength <= CONSTANTS.MAX_TITLE_LENGTH) {
      return baseFontSize;
    }
    const scaleFactor = CONSTANTS.MAX_TITLE_LENGTH / titleLength;
    return Math.max(
      baseFontSize * scaleFactor,
      baseFontSize * CONSTANTS.MIN_TITLE_FONT_SCALE
    );
  }, []);

  const transformStationData = useCallback((item) => {
    const mime = "image/jpeg";
    const base64Img = item.BASE64 ? `data:${mime};base64,${item.BASE64}` : "";
    const urlImg =
      item.IMAGE_URL || item.IMG_URL || item.ZIMG || item.IMG || "";
    return {
      id: item.CHXD_ID,
      bukrs: item.BUKRS || "",
      title: item.CHXD_T || "Cửa hàng không tên",
      lat: parseFloat(item.ZLAT),
      lng: parseFloat(item.ZLONG),
      address: item.ADDRESS || "Đang cập nhật",
      chxd_type: item.CHXD_TYPE || item.CHXD_TY || item.CHXD_CLASS || "",
      // ZTB_CHXD_TTTT_H-ZZTYPE (domain ZDOCHXD_ZZTYPE): 01 CHXD thuộc PLX,
      // 02 CHXD PLX dự kiến đầu tư, 03 CHXD ngoài xã hội,
      // 05 CHXD dự kiến đầu tư mới, 99 Kho xăng dầu
      zztype: (item.ZZTYPE || "").trim(),
      image: base64Img || urlImg,
      matnr: item.MATNR,
      matnr_t: item.MATNR_T,
      matkl: item.MATKL,
      price: item.PRICE,
      price_change: item.PRICE_CHANGE,
      price_change_tt: item.PRICE_CHANGE_TT,
      kbetr_tt: item.KBETR_TT,
      kbetr_v1: item.KBETR_V1,
      kbetr_max: item.KBETR_MAX,
      // ZTB_CHXD_BI_H: lượng bán bình quân của CHXD (MENGE_BQ) và bình quân
      // của các CHXD PLX trong vòng 10km (MENGE_BQ_V). Đơn vị lít (MEINS='L').
      menge_bq: Number(item.MENGE_BQ) || 0,
      menge_bq_v: Number(item.MENGE_BQ_V) || 0,
    };
  }, []);

  // fontSize: co chu badge, do createStationLayers tinh tu co chu cua gia
  const createPriceChangeHTML = useCallback(
    (c, showPrice_Change, showPrice_Change_TT, fontSize) => {
      if (!hasMatnr) return "";
      const parts = [];

      const hasPriceChangeData = c.price > 0 && c.kbetr_v1 > 0;
      if (showPrice_Change && hasPriceChangeData) {
        const priceChangeColors = getPriceChangeColor(c.price_change);
        const priceChangeDisplay =
          c.price_change > 0
            ? `+${c.price_change.toLocaleString(LOCALE)}`
            : c.price_change.toLocaleString(LOCALE);

        parts.push(`
        <span style="
            font-weight: 600;
            font-size: ${fontSize}px;
            color: ${priceChangeColors.color};
            background: ${priceChangeColors.bg};
            padding: 0px 2px;
            border-radius: 5px;
            line-height: 1.35;
            display: inline-flex;
            align-items: center;
          ">
            ${priceChangeDisplay}
        </span>
      `);
      }

      const hasPriceChangeTTData = c.kbetr_tt > 0 && c.kbetr_max > 0;
      if (showPrice_Change_TT && hasPriceChangeTTData) {
        const priceChangeTTColors = getPriceChangeColor(c.price_change_tt);
        const priceChangeTTDisplay =
          c.price_change_tt > 0
            ? `+${c.price_change_tt.toLocaleString(LOCALE)}`
            : c.price_change_tt.toLocaleString(LOCALE);

        parts.push(`
        <span style="
            font-weight: 600;
            font-size: ${fontSize}px;
            color: ${priceChangeTTColors.color};
            background: ${priceChangeTTColors.bg};
            padding: 0px 2px;
            border-radius: 5px;
            line-height: 1.35;
            display: inline-flex;
            align-items: center;
          ">
            ${priceChangeTTDisplay}
        </span>
      `);
      }

      return parts.length > 0
        ? `<div style="display: inline-flex; align-items: center; gap: 0px;">
          ${parts.join('<span style="color: #000">|</span>')}
        </div>`
        : "";
    },
    [getPriceChangeColor, hasMatnr]
  );

  // Badge lượng bán bình quân trên nhãn marker. Không ghi chữ BQ/LC cho gọn,
  // phân biệt bằng màu: xanh dương = của chính CHXD (MENGE_BQ), tím = bình
  // quân các CHXD PLX trong vòng 10km (MENGE_BQ_V). Số 0/không có -> bỏ.
  const createMengeHTML = useCallback((c, showBQ, showBQ_V, fontSize) => {
    const badge = (bg, value) => `
        <span style="
            font-weight: 600;
            font-size: ${fontSize}px;
            color: #ffffff;
            background: ${bg};
            padding: 0px 2px;
            border-radius: 5px;
            line-height: 1.35;
            display: inline-flex;
            align-items: center;
          ">${fmtM3(value)}</span>
      `;

    const parts = [];
    if (showBQ && c.menge_bq > 0) {
      parts.push(badge("rgba(10, 132, 255, 1)", c.menge_bq));
    }
    if (showBQ_V && c.menge_bq_v > 0) {
      parts.push(badge("rgba(112, 72, 232, 1)", c.menge_bq_v));
    }

    return parts.length > 0
      ? `<div style="display: inline-flex; align-items: center; gap: 2px;">
          ${parts.join("")}
        </div>`
      : "";
  }, []);

  // stationBukrs: BUKRS của chính CHXD được chọn. CHXD ngoài đơn vị đang xem
  // sẽ chuyển luôn i_bukrs sang đơn vị của nó để mở đúng ngữ cảnh đơn vị đó.
  const handleSelectStation = useCallback(
    (id, stationBukrs) => {
      if (!id) return;
      const params = new URLSearchParams(location.search);
      const nextBukrs = stationBukrs || bukrsParam;
      if (nextBukrs) params.set("i_bukrs", nextBukrs);
      params.set("i_chxdid", id);
      window.location.search = params.toString();
    },
    [location.search, bukrsParam]
  );

  // Tạo cặp layer (marker ảnh + label giá) cho 1 CHXD.
  // dimmed = CHXD ngoài BUKRS đang chọn -> viền nét đứt, mờ hơn để phân biệt.
  const createStationLayers = useCallback(
    (c, currentZoom, { dimmed = false } = {}) => {
      const size = getMarkerSize(currentZoom);
      const fs = getFontSize(currentZoom);

      const isTarget = c.id === targetId;
      // CHXD dự kiến đầu tư mới có thể mang CHXD_TYPE = 'PLX' nhưng ZZTYPE
      // = '05' -> ép icon theo DKDT cho khớp nhóm trong danh sách bên trái.
      // Không gọi resolveType() vì nó khai báo sau callback này (TDZ).
      const isDKDT =
        c.zztype === "05" || (c.chxd_type || "").toUpperCase().includes("DKDT");
      const iconUrl = getIconUrl(isDKDT ? "DKDT" : c.chxd_type);

      // CHXD đang focus: nhấp nháy cả icon marker (kèm nhãn giá nếu có) để
      // thấy ngay điểm đang xem, không phụ thuộc việc có i_matnr hay không.
      const pulseIcon = isTarget && chxdIdParam;

      const markerIcon = L.icon({
        iconUrl,
        iconSize: [size, size],
        iconAnchor: [size / 2, size],
        popupAnchor: [0, -25],
        className: pulseIcon ? "plx-marker-pulse" : "",
      });
      const marker = L.marker([c.lat, c.lng], {
        icon: markerIcon,
        opacity: dimmed ? 0.85 : 1,
        // Target luôn trên cùng, CHXD ngoài đơn vị xuống dưới CHXD của đơn vị
        zIndexOffset: isTarget && chxdIdParam ? 1000 : dimmed ? -500 : 0,
      });

      marker.on("click", () => {
        handleSelectStation(c.id, c.bukrs);
      });

      marker.bindPopup(`
          <b>${c.title}</b><br/><b>${c.id}</b>${
        dimmed && c.bukrs
          ? `<br/><span style="color:#8a6d00">Đơn vị ${c.bukrs}</span>`
          : ""
      }<br/>📍 <i>${c.address}</i>
        `);
      marker.on("mouseover", () => marker.openPopup());
      marker.on("mouseout", () => marker.closePopup());

      // Giá chính - Màu xanh dương Apple
      const priceHTML = `<span class="price-value" style="color:#007aff;font-weight:600;">${Number(
        c.price || 0
      ).toLocaleString(LOCALE)} đ/L</span>`;

      // Badge nho hon gia mot nhip (85%) o moi muc zoom, san 8px de con doc
      // duoc khi zoom nho.
      const badgeFs = Math.max(8, Math.round(fs * 0.85));
      const priceChangeHTML = createPriceChangeHTML(
        c,
        showPrice_Change,
        showPrice_Change_TT,
        badgeFs
      );

      // Tính toán font-size tự động dựa trên độ dài title
      const titleFontSize = calculateTitleFontSize(c.title.length, fs);

      const labelTitleHTML = `<div style="font-size: ${titleFontSize}px; color: ${
        dimmed ? "#4a4a4f" : "#1d1d1f"
      }; font-weight: ${
        isTarget ? "600" : "500"
      }; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; line-height: 1.3;">${
        c.title
      }</div>`;
      const mengeHTML = createMengeHTML(
        c,
        showMengeBQ,
        showMengeBQ_V,
        badgeFs
      );
      // Giá và các badge (CL giá vùng 1 / TT, lượng bán BQ) nằm chung một hàng
      // cho nhãn gọn, thay vì mỗi badge tự xuống dòng.
      const badgesHTML = `${priceChangeHTML}${mengeHTML}`;
      const priceDivHTML = `<div class="price-container" style="margin-top: 2px; display: flex; align-items: center; gap: 4px;">${priceHTML}${badgesHTML}</div>`;

      // Gộp labelTitleHTML và priceDivHTML thành một
      // Không có i_matnr -> chỉ hiện tên cửa hàng, bỏ dòng giá
      const labelAndPriceHTML = showText
        ? hasMatnr
          ? `${labelTitleHTML}${priceDivHTML}`
          : labelTitleHTML
        : "";

      // Tạo labelHTML bằng cách kết hợp các phần dựa trên các tùy chọn
      const labelParts = [];

      if (labelAndPriceHTML.trim()) {
        labelParts.push(labelAndPriceHTML);
      }

      // Có dòng giá -> badge đã nằm sẵn trong dòng đó. Không có dòng giá (tắt
      // "Hiện thông tin" hoặc thiếu i_matnr) -> badge đứng thành hàng riêng.
      if (!(showText && hasMatnr) && badgesHTML) {
        labelParts.push(badgesHTML);
      }

      // Nhãn chỉ chứa badge (tắt "Hiện thông tin") -> thu gọn padding cho vừa
      // khít badge, chỉ hở ~1-2px để vẫn thấy rõ viền trắng bao quanh.
      const isBadgeOnly = !labelAndPriceHTML.trim();
      const labelPadding = isBadgeOnly ? "1px 2px" : "1px 3px";
      const labelRadius = isBadgeOnly ? 5 : 8;
      // inline-flex bỏ luôn text node whitespace + khoảng trống baseline
      // nên khung trắng bám sát badge; có tên/giá thì giữ inline-block.
      const labelDisplay = isBadgeOnly ? "inline-flex" : "inline-block";

      // Chỉ tạo labelHTML nếu có ít nhất một phần
      const labelHTML =
        labelParts.length > 0
          ? `
          <div style="
            background: rgba(255,255,255,${dimmed ? "0.88" : "0.98"});
            border: 1px ${dimmed ? "dashed" : "solid"} ${
              isTarget ? "#ff3b30" : dimmed ? "#a1a1a6" : "#d2d2d7"
            };
            border-radius: ${labelRadius}px;
            padding: ${labelPadding};
            font-size: ${fs}px;
            font-weight: ${isTarget ? "600" : "400"};
            display: ${labelDisplay};
            align-items: center;
            white-space: nowrap;
            margin-left: 6px;
            text-align: left;
            max-width: 250px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            ${isTarget ? "animation: pulseLabel 1.2s infinite" : ""};
            transition: opacity 0.3s, box-shadow 0.2s;
          ">${labelParts.join("")}</div>
        `
          : "";

      const labelIcon = L.divIcon({
        html: labelHTML,
        className: "plx-label",
        iconSize: null,
        iconAnchor: [-5, 15],
      });
      const textMarker = L.marker([c.lat, c.lng], {
        icon: labelIcon,
        interactive: true,
        bubblingMouseEvents: false,
        zIndexOffset: isTarget && chxdIdParam ? 1000 : dimmed ? -500 : 0,
      });

      return { marker, textMarker, isTarget };
    },
    [
      targetId,
      chxdIdParam,
      hasMatnr,
      showText,
      showPrice_Change,
      showPrice_Change_TT,
      showMengeBQ,
      showMengeBQ_V,
      getIconUrl,
      getMarkerSize,
      getFontSize,
      createPriceChangeHTML,
      createMengeHTML,
      calculateTitleFontSize,
      handleSelectStation,
    ]
  );

  const handleMapTypeChange = useCallback((type) => {
    setMapType(type);
    if (!mapRef.current) return;
    mapRef.current.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) mapRef.current.removeLayer(layer);
    });

    const tile = TILE_LAYERS[type] || TILE_LAYERS.satellite;
    const { url, ...tileOpts } = tile;
    L.tileLayer(url, { ...TILE_OPTIONS, ...tileOpts }).addTo(mapRef.current);

    // Nen moi co tran zoom thap hon -> keo ve dung tran, neu khong Leaflet giu
    // nguyen zoom cu va khong con tile de ve.
    const map = mapRef.current;
    if (tile.maxZoom && map.getZoom() > tile.maxZoom) map.setZoom(tile.maxZoom);
  }, []);

  // Fetch data
  const fetchCHXDList = useCallback(async () => {
    // Chỉ fetch khi có bukrsParam
    if (!bukrsParam) {
      setCoords([]);
      setLoading(false);
      setViewInitialized(true);
      return;
    }

    try {
      setLoading(true);
      const token = btoa(`${API_USER}:${API_PASSWORD}`);

      const resMDCcd = await fetch(`${BASE_URL}${API}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${token}`,
        },
        body: JSON.stringify({
          FUNC: "ZFM_MD_BUKRS",
          DATA: { I_VALUE: bukrsParam },
        }),
      });

      if (!resMDCcd.ok)
        throw new Error(`HTTP error! status: ${resMDCcd.status}`);
      const dataMDCcd = await resMDCcd.json();
      setBukrs_title(dataMDCcd?.RESPONSE?.E_DATA?.BUTXT || bukrsParam);

      const res = await fetch(`${BASE_URL}${API}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${token}`,
        },
        body: JSON.stringify({
          FUNC: "ZFM_CHXD_GMAP",
          DATA: { I_BUKRS: bukrsParam, I_MATNR: matnrParam },
        }),
      });

      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

      const data = await res.json();

      const list = data.RESPONSE.T_DATA.map(transformStationData).filter(
        (x) => Number.isFinite(x.lat) && Number.isFinite(x.lng)
      );

      // Nếu có chxdIdParam, lấy thêm dữ liệu chi tiết cho CHXD đó
      if (chxdIdParam) {
        try {
          const fetchDetail = (withBukrs) =>
            fetch(`${BASE_URL}${API}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${token}`,
              },
              body: JSON.stringify({
                FUNC: "ZFM_CHXD_GMAP",
                DATA: {
                  ...(withBukrs ? { I_BUKRS: bukrsParam } : {}),
                  I_CHXD_ID: chxdIdParam,
                  I_MATNR: matnrParam,
                },
              }),
            });

          let detailRes = await fetchDetail(true);
          let tData = detailRes.ok
            ? (await detailRes.json())?.RESPONSE?.T_DATA
            : null;

          // CHXD ngoài BUKRS đang chọn: gọi lại không truyền I_BUKRS
          // (ZFM_CHXD_GMAP trả 0 dòng nếu CHXD không thuộc BUKRS đó)
          let outOfUnit = false;
          if (!tData || tData.length === 0) {
            detailRes = await fetchDetail(false);
            if (detailRes.ok) {
              tData = (await detailRes.json())?.RESPONSE?.T_DATA;
              outOfUnit = !!(tData && tData.length > 0);
            }
          }
          setTargetOutOfUnit(outOfUnit);

          if (tData && tData.length > 0) {
            const detailInfo = transformStationData(tData[0]);

            // Kiểm tra xem CHXD đã có trong list chưa
            const existingIndex = list.findIndex((x) => x.id === detailInfo.id);
            if (existingIndex >= 0) {
              // Cập nhật thông tin chi tiết (đặc biệt là image base64) nếu đã có
              list[existingIndex] = { ...list[existingIndex], ...detailInfo };
            } else {
              // Thêm vào list nếu chưa có (CHXD không thuộc BUKRS đang chọn)
              if (!isNaN(detailInfo.lat) && !isNaN(detailInfo.lng)) {
                list.push(detailInfo);
              }
            }
          }
        } catch (detailErr) {
          console.error("Error fetching CHXD detail:", detailErr);
        }
      }

      setCoords(list);
      // Không có điểm nào -> marker effect sẽ bỏ qua, tự mở cổng cho lớp đơn vị khác
      if (list.length === 0) setViewInitialized(true);
    } catch (err) {
      console.error(err);
      setError("Không thể kết nối tới API hoặc dữ liệu lỗi.");
    } finally {
      setLoading(false);
    }
  }, [bukrsParam, chxdIdParam, matnrParam]);

  useEffect(() => {
    fetchCHXDList();
  }, [fetchCHXDList]);

  // Tải CHXD toàn quốc (I_BUKRS rỗng = tất cả đơn vị). Payload lớn (~8MB)
  // nên chỉ tải 1 lần, lúc người dùng zoom nhỏ lần đầu.
  const fetchOtherUnits = useCallback(async () => {
    if (othersFetchedRef.current) return;
    othersFetchedRef.current = true;

    try {
      setOthersLoading(true);
      const token = btoa(`${API_USER}:${API_PASSWORD}`);

      const res = await fetch(`${BASE_URL}${API}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${token}`,
        },
        body: JSON.stringify({
          FUNC: "ZFM_CHXD_GMAP",
          DATA: { I_BUKRS: "", I_MATNR: matnrParam },
        }),
      });

      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

      const data = await res.json();
      const rows = data?.RESPONSE?.T_DATA || [];

      // Bỏ điểm không có toạ độ, gộp trùng CHXD_ID (ưu tiên dòng có giá)
      const byId = new Map();
      rows.forEach((item) => {
        const lat = parseFloat(item.ZLAT);
        const lng = parseFloat(item.ZLONG);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const prev = byId.get(item.CHXD_ID);
        if (!prev || (!(prev.price > 0) && item.PRICE > 0)) {
          byId.set(item.CHXD_ID, transformStationData(item));
        }
      });

      setOthersCoords(Array.from(byId.values()));
    } catch (err) {
      othersFetchedRef.current = false; // cho phép thử lại
      console.error("Error fetching other units:", err);
    } finally {
      setOthersLoading(false);
    }
  }, [matnrParam, transformStationData]);

  useEffect(() => {
    if (!viewInitialized) return;
    if (showAround) fetchOtherUnits();
  }, [viewInitialized, showAround, fetchOtherUnits]);

  // Mở 1 CHXD ngoài BUKRS -> tự bật lớp xung quanh, nếu không map sẽ trống trơn
  useEffect(() => {
    if (targetOutOfUnit) setShowAround(true);
  }, [targetOutOfUnit]);

  useEffect(() => {
    showTextRef.current = showText;
  }, [showText]);

  // Map initialization
  useEffect(() => {
    if (!mapRef.current) {
      mapRef.current = L.map("map", {
        center: CONSTANTS.MAP_CENTER,
        zoom: CONSTANTS.MAP_INITIAL_ZOOM,
        zoomAnimation: true,
        zoomAnimationThreshold: 4,
        fadeAnimation: true,
        markerZoomAnimation: false,
      });
      const { url: satUrl, ...satOpts } = TILE_LAYERS.satellite;
      L.tileLayer(satUrl, { ...TILE_OPTIONS, ...satOpts }).addTo(mapRef.current);
      markerGroupRef.current = L.featureGroup().addTo(mapRef.current);
      lineGroupRef.current = L.featureGroup().addTo(mapRef.current);

      const handleZoomEnd = () => {
        const z = mapRef.current.getZoom();
        setZoom(z);
        // Đổi cỡ icon/nhãn ngay tại sự kiện zoom, không chờ effect
        if (resizeLayersRef.current) resizeLayersRef.current(z);

        requestAnimationFrame(() => {
          const mg = markerGroupRef.current;
          if (mg) {
            mg.eachLayer((layer) => {
              if (layer.options?.icon?.options?.className === "plx-label") {
                const el = layer.getElement();
                if (el) {
                  el.style.opacity = showTextRef.current
                    ? 1
                    : computeLabelOpacity(z);
                }
              }
            });
          }
        });
      };

      // Cập nhật khung nhìn để lọc CHXD xung quanh (moveend chạy cả khi zoom)
      const handleMoveEnd = () => {
        if (!mapRef.current) return;
        const b = mapRef.current.getBounds();
        const c = mapRef.current.getCenter();
        setViewBox({
          s: b.getSouth(),
          w: b.getWest(),
          n: b.getNorth(),
          e: b.getEast(),
          clat: c.lat,
          clng: c.lng,
        });
      };

      mapRef.current.on("zoomend", handleZoomEnd);
      mapRef.current.on("moveend", handleMoveEnd);
      handleMoveEnd();
      setMapLoaded(true);

      return () => {
        if (mapRef.current) {
          mapRef.current.off("zoomend", handleZoomEnd);
          mapRef.current.off("moveend", handleMoveEnd);
          mapRef.current.remove();
          mapRef.current = null;
          aroundGroupRef.current = null;
          othersGroupRef.current = null;
          othersRendererRef.current = null;
        }
      };
    }
  }, [computeLabelOpacity]);

  // Đồng bộ lại cỡ icon/nhãn khi zoom (hoặc khi bật/tắt nhãn) đổi. zoomend đã
  // gọi resizeLayersForZoom ngay; effect này chỉ để bắt các trường hợp marker
  // vừa được dựng lại hoặc nhãn vừa bật/tắt.
  useEffect(() => {
    if (!mapRef.current || !markerGroupRef.current) return;
    resizeLayersForZoom(mapRef.current.getZoom() || zoom);
  }, [
    zoom,
    showText,
    showPrice_Change,
    showPrice_Change_TT,
    showMengeBQ,
    showMengeBQ_V,
    resizeLayersForZoom,
  ]);

  const typeMeta = useMemo(
    () => ({
      PLX: { label: "PLX", color: "#0d6efd" },
      PVI: { label: "PVOIL", color: "#2fb344" },
      OTH: { label: "KHÁC", color: "#f59f00" },
      NEW: { label: "ĐẦU TƯ MỚI", color: "#d6336c" },
      // Xam cu (#6c757d) mo tren nen trang va lan vao anh ve tinh. Doi sang
      // cyan: vanh pin logo_pin_tnnq.png cung da to lai #0c8599 nen nhan,
      // icon va dot tren ban do dung chung mot mau.
      TNNQ: { label: "THƯƠNG NHÂN NHƯỢNG QUYỀN", color: "#0c8599" },
      DKDT: { label: "DỰ KIẾN ĐẦU TƯ MỚI", color: "#ae3ec9" },
    }),
    []
  );

  // Thứ tự nhóm trong danh sách bên trái. CHXD dự kiến đầu tư mới (ZZTYPE=05)
  // đứng ngay sau PLX vì đây là các điểm PLX sắp mở, xem cùng mạng lưới PLX.
  const categoryList = useMemo(
    () => [
      { key: "PLX", filterKey: "PLX" },
      { key: "DKDT", filterKey: "DKDT" },
      { key: "PVI", filterKey: "PVI" },
      { key: "TNNQ", filterKey: "TNNQ" },
      { key: "NEW", filterKey: "NEW" },
      { key: "OTH", filterKey: "OTH" },
    ],
    []
  );

  const resolveType = useCallback((c) => {
    // ZZTYPE = '05' (CHXD dự kiến đầu tư mới) là căn cứ chính xác nhất, xét
    // trước CHXD_TYPE. Giữ thêm nhánh CHXD_TYPE = 'DKDT' để vẫn phân nhóm
    // đúng nếu API chưa trả ZZTYPE.
    if (c.zztype === "05") return "DKDT";

    const t = (c.chxd_type || "").toUpperCase();
    if (t.includes("TNNQ")) return "TNNQ";
    if (t.includes("PVI")) return "PVI";
    if (t.includes("NEW")) return "NEW";
    if (t.includes("DKDT")) return "DKDT";
    if (t.includes("PLX")) return "PLX";
    if (!t) return "OTH";
    return "OTH";
  }, []);

  const categorized = useMemo(() => {
    const base = { PLX: [], PVI: [], OTH: [], NEW: [], TNNQ: [], DKDT: [] };
    coords.forEach((c) => {
      const k = resolveType(c);
      if (!base[k]) base[k] = [];
      base[k].push(c);
    });
    return base;
  }, [coords, resolveType]);

  const visibleCoords = useMemo(
    () =>
      coords.filter((c) => {
        // CHXD dang focus (i_chxdid tren URL) luon hien, ke ca khi nhom cua
        // no bi bo tick - de "Bo chon tat ca" van con thay diem dang xem.
        if (c.id === targetId) return true;
        const k = resolveType(c);
        return categoryFilters[k] !== false;
      }),
    [coords, categoryFilters, resolveType, targetId]
  );

  // Cac nhom thuc su hien tren panel trai (co it nhat 1 diem)
  const shownCategoryKeys = useMemo(
    () =>
      categoryList
        .filter(({ key }) => (categorized[key] || []).length > 0)
        .map(({ filterKey }) => filterKey),
    [categoryList, categorized]
  );

  const setAllCategories = useCallback((value) => {
    setCategoryFilters({
      PLX: value,
      PVI: value,
      OTH: value,
      NEW: value,
      TNNQ: value,
      DKDT: value,
    });
  }, []);

  const allCategoriesChecked =
    shownCategoryKeys.length > 0 &&
    shownCategoryKeys.every((k) => categoryFilters[k] !== false);
  const noCategoryChecked =
    shownCategoryKeys.length > 0 &&
    shownCategoryKeys.every((k) => !categoryFilters[k]);

  const ownIds = useMemo(() => new Set(coords.map((c) => c.id)), [coords]);

  // CHXD đơn vị khác: bỏ CHXD của BUKRS đang chọn, áp dụng filter nhóm
  const othersVisible = useMemo(
    () =>
      othersCoords.filter(
        (c) =>
          c.bukrs !== bukrsParam &&
          !ownIds.has(c.id) &&
          categoryFilters[resolveType(c)] !== false
      ),
    [othersCoords, ownIds, bukrsParam, categoryFilters, resolveType]
  );

  // Zoom nhỏ -> vẽ toàn quốc dạng điểm; zoom lớn -> vẽ marker đầy đủ
  const othersActive = showAround && zoom <= CONSTANTS.OTHERS_ZOOM_MAX;
  const aroundActive = showAround && zoom > CONSTANTS.OTHERS_ZOOM_MAX;

  // Bán kính điểm theo zoom - chia bậc để không phải vẽ lại liên tục
  const othersRadius = useMemo(() => (zoom >= 10 ? 5 : zoom >= 8 ? 4 : 3), [
    zoom,
  ]);

  // CHXD xung quanh trong khung nhìn, ưu tiên gần tâm bản đồ nhất
  const aroundVisible = useMemo(() => {
    if (!aroundActive || !viewBox || othersVisible.length === 0) return [];

    const inBox = othersVisible.filter(
      (c) =>
        c.lat >= viewBox.s &&
        c.lat <= viewBox.n &&
        c.lng >= viewBox.w &&
        c.lng <= viewBox.e
    );
    if (inBox.length <= CONSTANTS.AROUND_MAX_MARKERS) return inBox;

    // Xếp theo khoảng cách tới tâm (bình phương độ, đủ để xếp hạng)
    return inBox
      .map((c) => ({
        c,
        d:
          (c.lat - viewBox.clat) ** 2 +
          ((c.lng - viewBox.clng) * Math.cos((viewBox.clat * Math.PI) / 180)) **
            2,
      }))
      .sort((a, b) => a.d - b.d)
      .slice(0, CONSTANTS.AROUND_MAX_MARKERS)
      .map((x) => x.c);
  }, [aroundActive, viewBox, othersVisible]);

  // Auto filter PLX when showPrice_Change_TT is selected
  useEffect(() => {
    if (showPrice_Change_TT && !showPrice_Change && !showText) {
      setCategoryFilters({
        PLX: true,
        PVI: false,
        OTH: false,
        NEW: false,
        TNNQ: false,
        DKDT: false,
      });
    } else if (!showPrice_Change_TT || showPrice_Change || showText) {
      setCategoryFilters({
        PLX: true,
        PVI: true,
        OTH: true,
        NEW: true,
        TNNQ: true,
        DKDT: true,
      });
    }
  }, [showPrice_Change_TT, showPrice_Change, showText]);

  // Có ít nhất một thông tin cần hiện -> mới gắn textMarker (nhãn) cạnh marker
  const anyLabelOn =
    showText ||
    showPrice_Change ||
    showPrice_Change_TT ||
    showMengeBQ ||
    showMengeBQ_V;

  // 3. Marker + label
  useEffect(() => {
    if (!mapRef.current || visibleCoords.length === 0) return;
    const map = mapRef.current;
    const markerGroup = markerGroupRef.current;
    markerGroup.clearLayers();

    // Lấy zoom hiện tại từ map để đảm bảo chính xác
    const currentZoom = map.getZoom() || zoom;

    // Lưu target marker để thêm vào sau cùng
    let targetMarker = null;
    let targetTextMarker = null;

    visibleCoords.forEach((c) => {
      const { marker, textMarker, isTarget } = createStationLayers(
        c,
        currentZoom
      );

      // Nếu là target marker, lưu lại để thêm vào sau cùng
      if (isTarget && chxdIdParam) {
        targetMarker = marker;
        targetTextMarker = textMarker;
      } else {
        markerGroup.addLayer(marker);
        if (anyLabelOn) {
          markerGroup.addLayer(textMarker);
        }
      }
    });

    // Thêm target marker vào sau cùng để nó luôn ở trên cùng
    if (targetMarker && targetTextMarker) {
      markerGroup.addLayer(targetMarker);
      // Chỉ thêm targetTextMarker nếu một trong 3 tùy chọn được bật
      if (anyLabelOn) {
        markerGroup.addLayer(targetTextMarker);
      }
    }

    if (!initialViewSet.current) {
      const target = visibleCoords.find((x) => x.id === targetId);

      if (target) {
        // Nếu có target, zoom trực tiếp vào target
        map.setView([target.lat, target.lng], CONSTANTS.MAP_TARGET_ZOOM, {
          animate: true,
        });
      } else {
        // Nếu không có target, fit bounds cho tất cả
        const bounds = L.latLngBounds(visibleCoords.map((c) => [c.lat, c.lng]));
        map.fitBounds(bounds, {
          padding: [60, 60],
          maxZoom: CONSTANTS.MAP_TARGET_ZOOM,
        });
      }

      initialViewSet.current = true;
      setViewInitialized(true);
    }
  }, [
    visibleCoords,
    targetId,
    mapLoaded,
    anyLabelOn,
    zoom,
    chxdIdParam,
    createStationLayers,
  ]);

  // 3b. CHXD xung quanh (ngoài BUKRS) - marker + label đầy đủ khi zoom lớn
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    if (!aroundGroupRef.current) {
      aroundGroupRef.current = L.featureGroup();
    }
    const group = aroundGroupRef.current;
    group.clearLayers();

    if (!aroundActive || aroundVisible.length === 0) {
      if (map.hasLayer(group)) map.removeLayer(group);
      return;
    }

    const currentZoom = map.getZoom() || zoom;

    aroundVisible.forEach((c) => {
      const { marker, textMarker } = createStationLayers(c, currentZoom, {
        dimmed: true,
      });
      group.addLayer(marker);
      if (anyLabelOn) {
        group.addLayer(textMarker);
      }
    });

    if (!map.hasLayer(group)) group.addTo(map);
  }, [
    aroundActive,
    aroundVisible,
    zoom,
    mapLoaded,
    anyLabelOn,
    createStationLayers,
  ]);

  // 3c. CHXD các đơn vị khác - vẽ dạng điểm trên canvas khi zoom nhỏ
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    if (!othersRendererRef.current) {
      othersRendererRef.current = L.canvas({ padding: 0.5 });
    }
    if (!othersGroupRef.current) {
      othersGroupRef.current = L.layerGroup();
    }
    const group = othersGroupRef.current;

    if (!othersActive) {
      group.clearLayers();
      if (map.hasLayer(group)) map.removeLayer(group);
      return;
    }

    group.clearLayers();

    othersVisible.forEach((c) => {
      const type = resolveType(c);
      const color = typeMeta[type]?.color || "#6c757d";

      const dot = L.circleMarker([c.lat, c.lng], {
        renderer: othersRendererRef.current,
        radius: othersRadius,
        color: "#ffffff",
        weight: 1,
        opacity: 0.9,
        fillColor: color,
        fillOpacity: 0.85,
      });

      // Click điểm -> điều hướng y như click marker của đơn vị đang chọn
      dot.on("click", () => {
        handleSelectStation(c.id, c.bukrs);
      });

      // Tooltip tạo lazy lúc hover: tránh dựng sẵn hàng nghìn tooltip
      dot.on("mouseover", () => {
        if (!dot.getTooltip()) {
          dot.bindTooltip(
            `<b>${c.title}</b><br/><span style="color:${color};font-weight:600">${
              typeMeta[type]?.label || type
            }</span>${c.bukrs ? ` • Đơn vị ${c.bukrs}` : ""}${
              hasMatnr && c.price > 0
                ? `<br/><b style="color:#007aff">${c.price.toLocaleString(LOCALE)} đ/L</b>`
                : ""
            }`,
            { direction: "top", opacity: 0.95 }
          );
        }
        dot.openTooltip();
      });

      group.addLayer(dot);
    });

    if (!map.hasLayer(group)) group.addTo(map);
  }, [
    othersActive,
    othersVisible,
    othersRadius,
    mapLoaded,
    hasMatnr,
    resolveType,
    typeMeta,
    handleSelectStation,
  ]);

  useEffect(() => {
    const mq = window.matchMedia(NARROW_PANEL_QUERY);
    const apply = (e) => {
      setIsNarrow(e.matches);
      // Man hinh hep: dong bot panel cho do che ban do (mo lai bang nut
      // hamburger o goc). Quay lai man hinh rong thi bay lai nhu mac dinh.
      setShowListPanel(!e.matches);
      setShowControls(!e.matches);
    };
    apply(mq);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Man hinh hep chi cho mo 1 trong 2 panel duoi cung mot luc
  const openListPanel = useCallback(() => {
    setShowListPanel(true);
    if (isNarrow) setShowControls(false);
  }, [isNarrow]);

  const openControls = useCallback(() => {
    setShowControls(true);
    if (isNarrow) setShowListPanel(false);
  }, [isNarrow]);

  // Esc de dong lightbox anh
  useEffect(() => {
    if (!zoomedImage) return;
    const onKey = (e) => {
      if (e.key === "Escape") setZoomedImage(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomedImage]);

  // Calculate distance between two points
  const getDistance = useCallback((a, b) => {
    const R = CONSTANTS.EARTH_RADIUS_KM;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }, []);

  // Calculate nearest stations
  // Chi noi toi CHXD thuoc cac nhom dang duoc tick o panel trai (visibleCoords):
  // bo tick nhom nao thi duong noi toi nhom do bien mat va tinh lai top gan nhat.
  const nearestStations = useMemo(() => {
    const target = visibleCoords.find((x) => x.id === targetId);
    if (!target || !showLines) return [];
    return visibleCoords
      .filter((c) => c.id !== target.id)
      .map((p) => ({ ...p, distance: getDistance(target, p) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, CONSTANTS.NEAREST_STATIONS_COUNT);
  }, [visibleCoords, targetId, showLines, getDistance]);

  // Polyline toggle
  useEffect(() => {
    if (!mapRef.current || !lineGroupRef.current) return;
    const map = mapRef.current;
    const lineGroup = lineGroupRef.current;

    // Xoá trước khi kiểm tra điều kiện, nếu không tắt toggle sẽ không xoá được
    lineGroup.clearLayers();

    const target = visibleCoords.find((x) => x.id === targetId);
    if (!showLines || !target || nearestStations.length === 0) return;

    nearestStations.forEach((p) => {
      const dist = p.distance.toFixed(2);
      const line = L.polyline(
        [
          [target.lat, target.lng],
          [p.lat, p.lng],
        ],
        { color: "#ff8800", weight: 2, dashArray: "5,5", opacity: 0.8 }
      );
      line.bindTooltip(`${dist} km`, {
        permanent: true,
        className: "distance-tooltip",
        direction: "center",
      });
      lineGroup.addLayer(line);
    });

    if (!map.hasLayer(lineGroup)) lineGroup.addTo(map);
  }, [showLines, nearestStations, visibleCoords, targetId]);

  const targetStation = useMemo(
    () => visibleCoords.find((c) => c.id === targetId),
    [visibleCoords, targetId]
  );

  // Render price change display component
  const renderPriceChangeDisplay = useCallback(
    (station, showPrice_Change, showPrice_Change_TT) => {
      if (!station || !hasMatnr) return null;

      const parts = [];
      const hasPriceChangeData = station.price > 0 && station.kbetr_v1 > 0;

      if (showPrice_Change && hasPriceChangeData) {
        const changeColors = getPriceChangeColor(station.price_change);
        const priceChangeDisplay =
          station.price_change > 0
            ? `+${station.price_change.toLocaleString(LOCALE)}`
            : station.price_change.toLocaleString(LOCALE);

        parts.push(
          <span
            key="priceChange"
            style={{
              color: changeColors.color,
              background: changeColors.bg,
              padding: "0px 4px",
              borderRadius: "5px",
              lineHeight: 1.4,
            }}
          >
            {priceChangeDisplay}
          </span>
        );
      }

      const hasPriceChangeTTData =
        station.kbetr_tt > 0 && station.kbetr_max > 0;
      if (showPrice_Change_TT && hasPriceChangeTTData) {
        const changeTTColors = getPriceChangeColor(station.price_change_tt);
        const priceChangeTTDisplay =
          station.price_change_tt > 0
            ? `+${station.price_change_tt.toLocaleString(LOCALE)}`
            : station.price_change_tt.toLocaleString(LOCALE);

        parts.push(
          <span
            key="priceChangeTT"
            style={{
              color: changeTTColors.color,
              background: changeTTColors.bg,
              padding: "0px 4px",
              borderRadius: "5px",
              lineHeight: 1.4,
            }}
          >
            {priceChangeTTDisplay}
          </span>
        );
      }

      if (parts.length === 0) return null;

      return (
        <div
          style={{
            marginLeft: "6px",
            // Gia trong panel la 17px -> badge 13px de to ma khong lan gia
            fontSize: "13px",
            fontWeight: "600",
            display: "inline-flex",
            alignItems: "center",
            gap: "0px",
          }}
        >
          {parts.map((part, index) => (
            <React.Fragment key={index}>
              {part}
              {index < parts.length - 1 && (
                <span style={{ color: "#000" }}>|</span>
              )}
            </React.Fragment>
          ))}
        </div>
      );
    },
    [getPriceChangeColor, hasMatnr]
  );

  // Preload ảnh khi có targetStation
  useEffect(() => {
    if (targetStation?.image) {
      setImageReady(false);
      const img = new Image();
      img.onload = () => setImageReady(true);
      img.onerror = () => setImageReady(false);
      img.src = targetStation.image;
    } else {
      setImageReady(false);
    }
  }, [targetStation?.image, targetStation?.id]);

  return (
    <div
      className={`gmap-root${
        targetStation && showLeftPanel ? " gmap-info-open" : ""
      }`}
      style={{ height: "100vh", position: "relative" }}
    >
      {/* Nút toggle panel trái */}
      {targetStation && !showLeftPanel && (
        <button
          className="gmap-fab gmap-fab-info"
          onClick={() => setShowLeftPanel(true)}
          title="Mở thông tin trạm"
        >
          ☰
        </button>
      )}

      {/* Thông tin CHXD (panel trái) khi có targetId */}
      {targetStation && showLeftPanel && (
        <div className="gmap-panel gmap-info-panel">
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              className="gmap-panel-close"
              onClick={() => setShowLeftPanel(false)}
              title="Ẩn thông tin trạm"
            >
              ✖
            </button>
          </div>

          <div
            className="gmap-panel-title"
            style={{
              marginBottom: 3,
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {/* Icon đúng nhóm của CHXD đang xem để đối chiếu với bản đồ */}
            <img
              src={getIconUrl(resolveType(targetStation))}
              alt=""
              style={{
                width: 26,
                height: 26,
                objectFit: "contain",
                flexShrink: 0,
              }}
            />
            {/* Tên cửa hàng làm tiêu đề; tên đơn vị đã có ở panel danh sách bên trái */}
            <span>
              {targetStation.title}{" "}
              <span
                style={{ fontWeight: 400, fontSize: 11, color: "#86868b" }}
              >
                ({targetStation.id})
              </span>
            </span>
            {targetOutOfUnit && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#8a6d00",
                  background: "#fff4cc",
                  border: "1px solid #ffe08a",
                  borderRadius: 6,
                  padding: "2px 6px",
                }}
              >
                Ngoài đơn vị {bukrsParam}
              </span>
            )}
          </div>
          <div
            style={{ color: "var(--gmap-text)", marginBottom: 8, fontSize: 12 }}
          >
            📍 {targetStation.address || "Đang cập nhật"}
          </div>
          {/* Không có i_matnr -> không xác định được mặt hàng, bỏ khối giá */}
          {hasMatnr && (
            <div
              style={{
                background: "#f5f5f7",
                padding: "9px 10px",
                borderRadius: "10px",
                marginBottom: 9,
                border: "1px solid #d2d2d7",
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  background: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "8px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                }}
              >
                <img
                  src={process.env.PUBLIC_URL + getFuelIcon(targetStation.matkl)}
                  alt="fuel-icon"
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  onError={(e) => {
                    e.target.src = process.env.PUBLIC_URL + "/icons/xang92.svg";
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--gmap-text)",
                    textTransform: "uppercase",
                    fontWeight: "600",
                    letterSpacing: "0.3px",
                    marginBottom: "4px",
                  }}
                >
                  {targetStation.matnr_t}
                </div>
                <div
                  style={{
                    fontSize: "17px",
                    fontWeight: "600",
                    color: "#1d1d1f",
                    display: "flex",
                    alignItems: "center",
                    lineHeight: "1.2",
                  }}
                >
                  <span style={{ color: "#007aff", fontWeight: "600" }}>
                    {Number(targetStation.price || 0).toLocaleString(LOCALE)} đ/L
                  </span>
                  {renderPriceChangeDisplay(
                    targetStation,
                    showPrice_Change,
                    showPrice_Change_TT
                  )}
                </div>
              </div>
            </div>
          )}
          {/* Lượng bán bình quân (ZTB_CHXD_BI_H) - theo option đang bật */}
          {(showMengeBQ || showMengeBQ_V) && (
            <div
              style={{
                background: "#f5f5f7",
                padding: "10px 14px",
                borderRadius: "12px",
                marginBottom: 12,
                border: "1px solid #d2d2d7",
              }}
            >
              {[
                {
                  on: showMengeBQ,
                  label: "Lượng bán BQ",
                  value: targetStation.menge_bq,
                  color: "#0a84ff",
                },
                {
                  on: showMengeBQ_V,
                  label: "BQ lân cận (10km)",
                  value: targetStation.menge_bq_v,
                  color: "#7048e8",
                },
              ]
                .filter((r) => r.on)
                .map((r) => (
                  <div
                    key={r.label}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "3px 0",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "var(--gmap-text)",
                      }}
                    >
                      {r.label}
                    </span>
                    <span
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: r.value > 0 ? r.color : "#86868b",
                      }}
                    >
                      {r.value > 0
                        ? `${fmtM3(r.value)} m³`
                        : "Chưa có dữ liệu"}
                    </span>
                  </div>
                ))}
            </div>
          )}
          {targetStation.image && (
            <div
              style={{ position: "relative", width: "100%", minHeight: 150 }}
            >
              {!imageReady && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#f0f0f0",
                    borderRadius: 10,
                  }}
                >
                  <div style={{ fontSize: 14, color: "#666" }}>
                    ⏳ Đang tải ảnh...
                  </div>
                </div>
              )}
              <img
                src={targetStation.image}
                alt={targetStation.title}
                title="Bấm để xem ảnh cỡ lớn"
                onClick={() => setZoomedImage(targetStation.image)}
                style={{
                  width: "100%",
                  maxHeight: 150,
                  objectFit: "cover",
                  borderRadius: 10,
                  border: "1px solid #eee",
                  opacity: imageReady ? 1 : 0,
                  transition: "opacity 0.3s ease-in",
                  cursor: "zoom-in",
                }}
                onLoad={() => setImageReady(true)}
                onError={(e) => {
                  e.target.style.display = "none";
                  setImageReady(false);
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Panel thống kê theo loại CHXD khi có BUKRS */}
      {!showListPanel && (
        <button
          className="gmap-fab gmap-fab-list"
          onClick={openListPanel}
          title="Mở danh sách nhóm CHXD"
        >
          ☰
        </button>
      )}

      {showListPanel && (
        <div className="gmap-panel gmap-list-panel">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 6,
            }}
          >
            <div className="gmap-panel-title">
              {bukrsParam} - {bukrs_title || "Thông tin cửa hàng xăng dầu"}
            </div>
            {/* Tổng số CHXD của đơn vị = tổng số điểm của các nhóm bên dưới,
                đếm trên coords nên không đổi khi bỏ tick nhóm */}
            <span className="gmap-panel-count">{coords.length} điểm</span>
            <button
              className="gmap-panel-close"
              onClick={() => setShowListPanel(false)}
              title="Ẩn danh sách"
            >
              ✖
            </button>
          </div>

          {shownCategoryKeys.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 2 }}>
              <button
                type="button"
                className="gmap-bulk-btn"
                onClick={() => setAllCategories(true)}
                disabled={allCategoriesChecked}
              >
                Chọn tất cả
              </button>
              <button
                type="button"
                className="gmap-bulk-btn"
                onClick={() => setAllCategories(false)}
                disabled={noCategoryChecked}
              >
                Bỏ chọn tất cả
              </button>
            </div>
          )}

          {categoryList.map(({ key, filterKey }) => {
            const meta = typeMeta[key];
            const list = categorized[key] || [];
            const count = list.length;
            if (count === 0) return null;
            return (
              <div
                key={key}
                style={{
                  borderTop: "1px solid #eaeaea",
                  paddingTop: 7,
                  paddingBottom: 7,
                }}
              >
                <label
                  className="gmap-cat-label"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontWeight: 600,
                    color: meta?.color || "#2a5599",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!categoryFilters[filterKey]}
                    onChange={() =>
                      setCategoryFilters((prev) => ({
                        ...prev,
                        [filterKey]: !prev[filterKey],
                      }))
                    }
                    style={{ cursor: "pointer" }}
                  />
                  {/* Icon marker của nhóm để đối chiếu với điểm trên bản đồ */}
                  <img src={getIconUrl(key)} alt="" className="gmap-cat-icon" />
                  {meta?.label || "Nhóm khác"}
                  <span className="gmap-cat-count">{count} điểm</span>
                </label>

                {list
                  .slice(0, expandedCategories[key] ? list.length : 4)
                  .map((item) => (
                    <div
                      key={item.id}
                      className="gmap-cat-item"
                      onClick={() => handleSelectStation(item.id)}
                    >
                      • {item.title}
                    </div>
                  ))}

                {count > 4 && (
                  <div
                    onClick={() =>
                      setExpandedCategories((prev) => ({
                        ...prev,
                        [key]: !prev[key], // Toggle expanded state cho category này
                      }))
                    }
                    className="gmap-cat-more"
                  >
                    {expandedCategories[key] ? "Thu gọn" : `${count - 4} khác`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Nút hiển thị/ẩn controls */}
      <button
        className="gmap-fab gmap-fab-controls"
        onClick={openControls}
        style={{ display: showControls ? "none" : "flex" }}
        title="Mở bộ điều khiển"
      >
        ☰
      </button>

      {/* --- Bộ điều khiển (controls) góc trái dưới --- */}
      {showControls && (
        <div className="d-flex flex-column gmap-controls-panel">
          {/* Nút thu nhỏ */}
          <button
            className="gmap-panel-close"
            onClick={() => setShowControls(false)}
            style={{ alignSelf: "flex-end" }}
          >
            ✖
          </button>

          {/* Công tắc đường nối */}
          <div
            className="form-check form-switch m-0 gmap-toggle-row"
          >
            <input
              className="form-check-input"
              type="checkbox"
              id="toggleLines"
              checked={showLines}
              onChange={() => setShowLines(!showLines)}
            />
            <label
              className="form-check-label gmap-toggle-label"
              htmlFor="toggleLines"
            >
              Hiện đường nối
            </label>
          </div>

          <div
            className="form-check form-switch m-0 gmap-toggle-row"
          >
            <input
              className="form-check-input"
              type="checkbox"
              id="toggleText"
              checked={showText}
              onChange={() => setShowText(!showText)}
            />
            <label
              className="form-check-label gmap-toggle-label"
              htmlFor="toggleText"
            >
              Hiện thông tin
            </label>
          </div>

          {/* Hai toggle giá chỉ có nghĩa khi biết mặt hàng (i_matnr) */}
          {hasMatnr && (
            <>
              <div
                className="form-check form-switch m-0 gmap-toggle-row"
              >
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="togglePriceChange"
                  checked={showPrice_Change}
                  onChange={() => setShowPrice_Change(!showPrice_Change)}
                />
                <label
                  className="form-check-label gmap-toggle-label"
                  htmlFor="togglePriceChange"
                >
                  CL giá vùng 1
                </label>
              </div>

              <div
                className="form-check form-switch m-0 gmap-toggle-row"
              >
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="togglePriceChangeTT"
                  checked={showPrice_Change_TT}
                  onChange={() => setShowPrice_Change_TT(!showPrice_Change_TT)}
                />
                <label
                  className="form-check-label gmap-toggle-label"
                  htmlFor="togglePriceChangeTT"
                >
                  So sánh giá TT với V1
                </label>
              </div>
            </>
          )}

          {/* Lượng bán BQ - dữ liệu theo CHXD, không phụ thuộc mặt hàng */}
          {[
            {
              id: "toggleMengeBQ",
              label: "Lượng bán BQ (CHXD)",
              checked: showMengeBQ,
              onChange: () => setShowMengeBQ(!showMengeBQ),
            },
            {
              id: "toggleMengeBQV",
              label: "Lượng bán BQ (lân cận)",
              checked: showMengeBQ_V,
              onChange: () => setShowMengeBQ_V(!showMengeBQ_V),
            },
          ].map((t) => (
            <div
              key={t.id}
              className="form-check form-switch m-0 gmap-toggle-row"
            >
              <input
                className="form-check-input"
                type="checkbox"
                id={t.id}
                checked={t.checked}
                onChange={t.onChange}
              />
              <label
                className="form-check-label gmap-toggle-label"
                htmlFor={t.id}
              >
                {t.label}
              </label>
            </div>
          ))}

          {/* Hiện CHXD ngoài BUKRS đang chọn */}
          <div
            className="form-check form-switch m-0 gmap-toggle-row"
          >
            <input
              className="form-check-input"
              type="checkbox"
              id="toggleAround"
              checked={showAround}
              onChange={() => setShowAround(!showAround)}
            />
            <label
              className="form-check-label gmap-toggle-label"
              htmlFor="toggleAround"
            >
              Hiện cửa hàng xung quanh
              {othersLoading ? " (đang tải...)" : ""}
            </label>
          </div>
          {showAround && (
            <div className="gmap-controls-note">
              {othersLoading
                ? "Đang tải dữ liệu toàn quốc..."
                : aroundActive
                ? `Ngoài đơn vị: ${aroundVisible.length}${
                    aroundVisible.length >= CONSTANTS.AROUND_MAX_MARKERS
                      ? ` (giới hạn ${CONSTANTS.AROUND_MAX_MARKERS} gần tâm nhất)`
                      : ""
                  } trong khung nhìn`
                : `Toàn quốc dạng điểm: ${othersVisible.length} • zoom > ${CONSTANTS.OTHERS_ZOOM_MAX} để xem chi tiết`}
            </div>
          )}

          {/* Dropdown chọn loại bản đồ */}
          <div style={{ width: "100%" }}>
            <MapTypeSelect value={mapType} onChange={handleMapTypeChange} />
          </div>
        </div>
      )}

      {/* Xem ảnh CHXD cỡ lớn - bấm nền hoặc Esc để đóng */}
      {zoomedImage && (
        <div
          className="gmap-lightbox"
          onClick={() => setZoomedImage(null)}
          role="presentation"
        >
          <button
            type="button"
            className="gmap-lightbox-close"
            onClick={() => setZoomedImage(null)}
            title="Đóng (Esc)"
          >
            ✖
          </button>
          <img
            src={zoomedImage}
            alt={targetStation?.title || ""}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Thông báo tải / lỗi */}
      {loading && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: 18,
            color: "#2a5599",
            fontWeight: 500,
            background: "rgba(255,255,255,0.8)",
            padding: "10px 20px",
            borderRadius: 8,
            boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
          }}
        >
          ⏳ Đang tải dữ liệu trạm xăng...
        </div>
      )}
      {error && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: "red",
            fontWeight: 600,
            background: "rgba(255,255,255,0.9)",
            padding: "10px 20px",
            borderRadius: 8,
            boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Bản đồ */}
      <div
        id="map"
        style={{
          height: "100vh",
          width: "100%",
          transform: "translateZ(0)", // GPU acceleration
          willChange: "transform", // Hint cho browser
        }}
      />
    </div>
  );
};

export default CHXDGMap;
