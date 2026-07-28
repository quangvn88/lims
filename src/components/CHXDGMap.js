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

  const mapRef = useRef(null);
  const markerGroupRef = useRef(null);
  const lineGroupRef = useRef(null);
  const showTextRef = useRef(false);
  const initialViewSet = useRef(false);
  const markerSizeCache = useRef(new Map());
  const fontSizeCache = useRef(new Map());
  const zoomUpdateTimeoutRef = useRef(null);
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
  const [showPrice_Change, setShowPrice_Change] = useState(true);
  const [showPrice_Change_TT, setShowPrice_Change_TT] = useState(false);
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
  });
  const [zoom, setZoom] = useState(6);
  const [imageReady, setImageReady] = useState(false);

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

  const getMarkerSize = useCallback((zoom) => {
    if (markerSizeCache.current.has(zoom)) {
      return markerSizeCache.current.get(zoom);
    }
    let size;
    if (zoom >= 16) size = 44;
    else if (zoom >= 14) size = 36;
    else if (zoom >= 12) size = 30;
    else if (zoom >= 10) size = 24;
    else if (zoom >= 8) size = 18;
    else if (zoom >= 7) size = 16;
    else if (zoom >= 6) size = 14;
    else if (zoom >= 5) size = 12;
    else size = 10;
    markerSizeCache.current.set(zoom, size);
    return size;
  }, []);

  const getFontSize = useCallback((zoom) => {
    if (fontSizeCache.current.has(zoom)) {
      return fontSizeCache.current.get(zoom);
    }
    let size;
    if (zoom >= 16) size = 14;
    else if (zoom >= 14) size = 12;
    else if (zoom >= 12) size = 11;
    else if (zoom >= 10) size = 10;
    else if (zoom >= 8) size = 9;
    else if (zoom >= 7) size = 8;
    else if (zoom >= 6) size = 8;
    else if (zoom >= 5) size = 7;
    else size = 6;
    fontSizeCache.current.set(zoom, size);
    return size;
  }, []);

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

  const getIconUrl = useCallback((chxdType) => {
    const baseUrl = process.env.PUBLIC_URL;
    const iconMap = {
      PLX: `${baseUrl}/logo_plx.png`,
      NEW: `${baseUrl}/logo_plx.png`,
      PVI: `${baseUrl}/logo_pvoil.png`,
      TNNQ: `${baseUrl}/logo_tnnq.png`,
      OTH: `${baseUrl}/logo_doithu1.png`,
    };
    return iconMap[chxdType] || `${baseUrl}/logo_default.png`;
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
    };
  }, []);

  const createPriceChangeHTML = useCallback(
    (c, showPrice_Change, showPrice_Change_TT) => {
      const parts = [];

      const hasPriceChangeData = c.price > 0 && c.kbetr_v1 > 0;
      if (showPrice_Change && hasPriceChangeData) {
        const priceChangeColors = getPriceChangeColor(c.price_change);
        const priceChangeDisplay =
          c.price_change > 0
            ? `+${c.price_change.toLocaleString()}`
            : c.price_change.toLocaleString();

        parts.push(`
        <span style="
            font-weight: 500;
            font-size: 12px;
            color: ${priceChangeColors.color};
            background: ${priceChangeColors.bg};
            padding: 1px 3px 1px 3px;
            border-radius: 6px;
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
            ? `+${c.price_change_tt.toLocaleString()}`
            : c.price_change_tt.toLocaleString();

        parts.push(`
        <span style="
            font-weight: 500;
            font-size: 12px;
            color: ${priceChangeTTColors.color};
            background: ${priceChangeTTColors.bg};
            padding: 1px 3px 1px 3px;
            border-radius: 6px;
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
    [getPriceChangeColor]
  );

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
      const iconUrl = getIconUrl(c.chxd_type);

      const markerIcon = L.icon({
        iconUrl,
        iconSize: [size, size],
        iconAnchor: [size / 2, size],
        popupAnchor: [0, -25],
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
      const priceHTML = `<span class="price-value" style="color:#007aff;font-weight:600;">${c.price.toLocaleString()} đ/L</span>`;

      const priceChangeHTML = createPriceChangeHTML(
        c,
        showPrice_Change,
        showPrice_Change_TT
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
      const priceDivHTML = `<div class="price-container" style="margin-top: 2px; display: flex; align-items: center;">${priceHTML}</div>`;

      // Gộp labelTitleHTML và priceDivHTML thành một
      const labelAndPriceHTML = showText
        ? `${labelTitleHTML}${priceDivHTML}`
        : "";

      // Tạo labelHTML bằng cách kết hợp các phần dựa trên các tùy chọn
      const labelParts = [];

      if (labelAndPriceHTML.trim()) {
        labelParts.push(labelAndPriceHTML);
      }

      if (priceChangeHTML) {
        labelParts.push(priceChangeHTML);
      }

      // Chỉ tạo labelHTML nếu có ít nhất một phần
      const labelHTML =
        labelParts.length > 0
          ? `
          <div style="
            background: rgba(255,255,255,${dimmed ? "0.88" : "0.98"});
            border: 1.5px ${dimmed ? "dashed" : "solid"} ${
              isTarget ? "#ff3b30" : dimmed ? "#a1a1a6" : "#d2d2d7"
            };
            border-radius: 8px;
            padding: 4px 8px;
            font-size: ${fs}px;
            font-weight: ${isTarget ? "600" : "400"};
            display: inline-block;
            white-space: nowrap;
            margin-left: 6px;
            text-align: left;
            max-width: 250px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            ${isTarget ? "animation: pulseLabel 1.2s infinite" : ""};
            transition: opacity 0.3s, box-shadow 0.2s;
          ">
            ${labelParts.join("")}
          </div>
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
      showText,
      showPrice_Change,
      showPrice_Change_TT,
      getIconUrl,
      getMarkerSize,
      getFontSize,
      createPriceChangeHTML,
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

    const url =
      type === "street"
        ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

    L.tileLayer(url, {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors",
      updateWhenZooming: false,
      updateWhenIdle: true,
      keepBuffer: 1,
      maxNativeZoom: 18,
      tileSize: 256,
      zoomOffset: 0,
      crossOrigin: true,
    }).addTo(mapRef.current);
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
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 18,
          attribution: "&copy; OpenStreetMap contributors",
          updateWhenZooming: false,
          updateWhenIdle: true,
          keepBuffer: 1,
          maxNativeZoom: 18,
          tileSize: 256,
          zoomOffset: 0,
          crossOrigin: true,
        }
      ).addTo(mapRef.current);
      markerGroupRef.current = L.featureGroup().addTo(mapRef.current);
      lineGroupRef.current = L.featureGroup().addTo(mapRef.current);

      const handleZoomEnd = () => {
        const z = mapRef.current.getZoom();
        setZoom(z);

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

  // Zoom update effect with debounce
  useEffect(() => {
    if (!mapRef.current || !markerGroupRef.current) return;

    if (zoomUpdateTimeoutRef.current) {
      clearTimeout(zoomUpdateTimeoutRef.current);
    }

    zoomUpdateTimeoutRef.current = setTimeout(() => {
      requestAnimationFrame(() => {
        const markerGroup = markerGroupRef.current;
        if (!markerGroup || !mapRef.current) return;

        const currentZoom = mapRef.current.getZoom() || zoom;
        const size = getMarkerSize(currentZoom);
        const fontSize = getFontSize(currentZoom);

        markerGroup.eachLayer((layer) => {
          if (
            layer instanceof L.Marker &&
            layer.options.icon &&
            layer.options.icon.options &&
            layer.options.icon.options.iconUrl
          ) {
            const oldIcon = layer.options.icon;
            const newIcon = L.icon({
              iconUrl: oldIcon.options.iconUrl,
              iconSize: [size, size],
              iconAnchor: [size / 2, size],
              popupAnchor: [0, -25],
            });
            layer.setIcon(newIcon);
          }

          if (
            layer instanceof L.Marker &&
            layer.options.icon &&
            layer.options.icon.options &&
            layer.options.icon.options.className === "plx-label"
          ) {
            const oldHtml = layer.options.icon.options.html || "";
            let newHtml;
            if (/\bfont-size:\s*\d+px/.test(oldHtml)) {
              newHtml = oldHtml.replace(
                /font-size:\s*\d+px/g,
                `font-size:${fontSize}px`
              );
            } else {
              newHtml = oldHtml.replace(/style="([^"]*)"/, (m, p1) => {
                return `style="${p1}; font-size:${fontSize}px"`;
              });
            }

            const newDivIcon = L.divIcon({
              ...layer.options.icon.options,
              html: newHtml,
            });

            layer.setIcon(newDivIcon);
            const el = layer.getElement();
            if (el) {
              el.style.opacity = 1;
            } else {
              layer.once("add", () => {
                const el2 = layer.getElement();
                if (el2) el2.style.opacity = 1;
              });
            }
          }
        });
      });
    }, CONSTANTS.ZOOM_DEBOUNCE_MS);

    return () => {
      if (zoomUpdateTimeoutRef.current) {
        clearTimeout(zoomUpdateTimeoutRef.current);
      }
    };
  }, [
    zoom,
    showText,
    showPrice_Change,
    showPrice_Change_TT,
    getMarkerSize,
    getFontSize,
  ]);

  const typeMeta = useMemo(
    () => ({
      PLX: { label: "PLX", color: "#0d6efd" },
      PVI: { label: "PVOIL", color: "#2fb344" },
      OTH: { label: "KHÁC", color: "#f59f00" },
      NEW: { label: "ĐẦU TƯ MỚI", color: "#d6336c" },
      TNNQ: { label: "THƯƠNG NHÂN NHƯỢNG QUYỀN", color: "#6c757d" },
    }),
    []
  );

  const categoryList = useMemo(
    () => [
      { key: "PLX", filterKey: "PLX" },
      { key: "PVI", filterKey: "PVI" },
      { key: "TNNQ", filterKey: "TNNQ" },
      { key: "NEW", filterKey: "NEW" },
      { key: "OTH", filterKey: "OTH" },
    ],
    []
  );

  const resolveType = useCallback((c) => {
    const t = (c.chxd_type || "").toUpperCase();
    if (t.includes("TNNQ")) return "TNNQ";
    if (t.includes("PVI")) return "PVI";
    if (t.includes("NEW")) return "NEW";
    if (t.includes("PLX")) return "PLX";
    if (!t) return "OTH";
    return "OTH";
  }, []);

  const categorized = useMemo(() => {
    const base = { PLX: [], PVI: [], OTH: [], NEW: [], TNNQ: [] };
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
        const k = resolveType(c);
        return categoryFilters[k] !== false;
      }),
    [coords, categoryFilters, resolveType]
  );

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
      });
    } else if (!showPrice_Change_TT || showPrice_Change || showText) {
      setCategoryFilters({
        PLX: true,
        PVI: true,
        OTH: true,
        NEW: true,
        TNNQ: true,
      });
    }
  }, [showPrice_Change_TT, showPrice_Change, showText]);

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
        if (showText || showPrice_Change || showPrice_Change_TT) {
          markerGroup.addLayer(textMarker);
        }
      }
    });

    // Thêm target marker vào sau cùng để nó luôn ở trên cùng
    if (targetMarker && targetTextMarker) {
      markerGroup.addLayer(targetMarker);
      // Chỉ thêm targetTextMarker nếu một trong 3 tùy chọn được bật
      if (showText || showPrice_Change || showPrice_Change_TT) {
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
    showText,
    showPrice_Change,
    showPrice_Change_TT,
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
      if (showText || showPrice_Change || showPrice_Change_TT) {
        group.addLayer(textMarker);
      }
    });

    if (!map.hasLayer(group)) group.addTo(map);
  }, [
    aroundActive,
    aroundVisible,
    zoom,
    mapLoaded,
    showText,
    showPrice_Change,
    showPrice_Change_TT,
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
              c.price > 0
                ? `<br/><b style="color:#007aff">${c.price.toLocaleString()} đ/L</b>`
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
    resolveType,
    typeMeta,
    handleSelectStation,
  ]);

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
  const nearestStations = useMemo(() => {
    const target = coords.find((x) => x.id === targetId);
    if (!target || !showLines) return [];
    return coords
      .filter((c) => c.id !== target.id)
      .map((p) => ({ ...p, distance: getDistance(target, p) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, CONSTANTS.NEAREST_STATIONS_COUNT);
  }, [coords, targetId, showLines, getDistance]);

  // Polyline toggle
  useEffect(() => {
    if (!mapRef.current || !lineGroupRef.current) return;
    const map = mapRef.current;
    const lineGroup = lineGroupRef.current;

    // Xoá trước khi kiểm tra điều kiện, nếu không tắt toggle sẽ không xoá được
    lineGroup.clearLayers();

    const target = coords.find((x) => x.id === targetId);
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
  }, [showLines, nearestStations, coords, targetId]);

  const targetStation = useMemo(
    () => visibleCoords.find((c) => c.id === targetId),
    [visibleCoords, targetId]
  );

  // Render price change display component
  const renderPriceChangeDisplay = useCallback(
    (station, showPrice_Change, showPrice_Change_TT) => {
      if (!station) return null;

      const parts = [];
      const hasPriceChangeData = station.price > 0 && station.kbetr_v1 > 0;

      if (showPrice_Change && hasPriceChangeData) {
        const changeColors = getPriceChangeColor(station.price_change);
        const priceChangeDisplay =
          station.price_change > 0
            ? `+${station.price_change.toLocaleString()}`
            : station.price_change.toLocaleString();

        parts.push(
          <span
            key="priceChange"
            style={{
              color: changeColors.color,
              background: changeColors.bg,
              padding: "4px 6px",
              borderRadius: "6px",
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
            ? `+${station.price_change_tt.toLocaleString()}`
            : station.price_change_tt.toLocaleString();

        parts.push(
          <span
            key="priceChangeTT"
            style={{
              color: changeTTColors.color,
              background: changeTTColors.bg,
              padding: "4px 6px",
              borderRadius: "6px",
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
            marginLeft: "10px",
            fontSize: "13px",
            fontWeight: "500",
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
    [getPriceChangeColor]
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
    <div style={{ height: "100vh", position: "relative" }}>
      {/* Nút toggle panel trái */}
      {targetStation && !showLeftPanel && (
        <button
          onClick={() => setShowLeftPanel(true)}
          style={{
            position: "absolute",
            top: 10,
            right: 10, // Thay đổi từ left: 45
            zIndex: 1003,
            width: 30,
            height: 30,
            borderRadius: 10,
            border: "none",
            background: "#2a5599",
            color: "#fff",
            boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
            cursor: "pointer",
            fontWeight: "bold",
          }}
          title="Mở thông tin trạm"
        >
          ☰
        </button>
      )}

      {/* Thông tin CHXD (panel trái) khi có targetId */}
      {targetStation && showLeftPanel && (
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10, // Thay đổi từ left: 10
            zIndex: 1002,
            width: 420,
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
            padding: "14px 16px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={() => setShowLeftPanel(false)}
              style={{
                background: "transparent",
                border: "none",
                fontSize: 16,
                fontWeight: "bold",
                cursor: "pointer",
              }}
              title="Ẩn thông tin trạm"
            >
              ✖
            </button>
          </div>

          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              marginBottom: 10,
              color: "#1d1d1f",
            }}
          >
            {bukrsParam} - {bukrs_title || "Thông tin cửa hàng xăng dầu"}
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "#1d1d1f",
              marginBottom: 4,
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {targetStation.title}
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
            style={{
              fontSize: 12,
              marginBottom: 6,
              color: "#86868b",
              fontWeight: 400,
            }}
          >
            {targetStation.id}
          </div>
          <div style={{ color: "#86868b", marginBottom: 10, fontSize: 14 }}>
            📍 {targetStation.address || "Đang cập nhật"}
          </div>
          <div
            style={{
              background: "#f5f5f7",
              padding: "12px 14px",
              borderRadius: "12px",
              marginBottom: 12,
              border: "1px solid #d2d2d7",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <div
              style={{
                width: "40px",
                height: "40px",
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
                  fontSize: "13px",
                  color: "#86868b",
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
                  fontSize: "20px",
                  fontWeight: "600",
                  color: "#1d1d1f",
                  display: "flex",
                  alignItems: "center",
                  lineHeight: "1.2",
                }}
              >
                <span style={{ color: "#007aff", fontWeight: "600" }}>
                  {targetStation.price.toLocaleString()} đ/L
                </span>
                {renderPriceChangeDisplay(
                  targetStation,
                  showPrice_Change,
                  showPrice_Change_TT
                )}
              </div>
            </div>
          </div>
          {targetStation.image && (
            <div
              style={{ position: "relative", width: "100%", minHeight: 220 }}
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
                style={{
                  width: "100%",
                  maxHeight: 220,
                  objectFit: "cover",
                  borderRadius: 10,
                  border: "1px solid #eee",
                  opacity: imageReady ? 1 : 0,
                  transition: "opacity 0.3s ease-in",
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
          onClick={() => setShowListPanel(true)}
          style={{
            position: "absolute",
            top: 10,
            left: 42,
            zIndex: 1003,
            width: 30,
            height: 30,
            borderRadius: 10,
            border: "none",
            background: "#2a5599",
            color: "#fff",
            boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
            cursor: "pointer",
            fontWeight: "bold",
          }}
          title="Mở danh sách nhóm CHXD"
        >
          ☰
        </button>
      )}

      {showListPanel && (
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            zIndex: 1002,
            width: 400,
            maxHeight: "90vh",
            overflowY: "auto",
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {bukrsParam} - {bukrs_title || "Thông tin cửa hàng xăng dầu"}
            </div>
            <button
              onClick={() => setShowListPanel(false)}
              style={{
                background: "transparent",
                border: "none",
                fontSize: 16,
                fontWeight: "bold",
                cursor: "pointer",
              }}
              title="Ẩn danh sách"
            >
              ✖
            </button>
          </div>

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
                  paddingTop: 10,
                  paddingBottom: 10,
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
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
                  {meta?.label || "Nhóm khác"}
                  <span
                    style={{ marginLeft: "auto", fontSize: 12, color: "#555" }}
                  >
                    {count} điểm
                  </span>
                </label>

                {list
                  .slice(0, expandedCategories[key] ? list.length : 4)
                  .map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleSelectStation(item.id)}
                      style={{
                        paddingLeft: 26,
                        color: "#444",
                        fontSize: 13,
                        marginTop: 4,
                        cursor: "pointer",
                      }}
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
                    style={{
                      paddingLeft: 26,
                      marginTop: 6,
                      fontSize: 12,
                      color: "#2a5599",
                      cursor: "pointer",
                      fontWeight: 500,
                      textDecoration: "underline",
                    }}
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
        onClick={() => setShowControls(!showControls)}
        style={{
          position: "absolute",
          bottom: 10, // Thay đổi từ top: 10
          left: 10, // Thay đổi từ right: 10
          zIndex: 1001,
          width: 30,
          height: 30,
          borderRadius: "50%",
          border: "none",
          background: "#2a5599",
          color: "#fff",
          cursor: "pointer",
          boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
          display: showControls ? "none" : "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: "bold",
        }}
      >
        ☰
      </button>

      {/* --- Bộ điều khiển (controls) góc trái dưới --- */}
      {showControls && (
        <div
          className="d-flex flex-column gap-2 position-absolute"
          style={{
            bottom: 0,
            right: 10,
            zIndex: 1000,
            background: "rgba(255, 255, 255, 0.9)",
            borderRadius: 10,
            padding: "10px 12px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
            alignItems: "flex-start",
          }}
        >
          {/* Nút thu nhỏ */}
          <button
            onClick={() => setShowControls(false)}
            style={{
              alignSelf: "flex-end", // Nút X vẫn ở bên phải
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 16,
              fontWeight: "bold",
            }}
          >
            ✖
          </button>

          {/* Công tắc đường nối */}
          <div
            className="form-check form-switch m-0"
            style={{ display: "flex", alignItems: "center", width: "100%" }}
          >
            <input
              className="form-check-input"
              type="checkbox"
              id="toggleLines"
              checked={showLines}
              onChange={() => setShowLines(!showLines)}
              style={{ cursor: "pointer", marginRight: "8px" }}
            />
            <label
              className="form-check-label"
              htmlFor="toggleLines"
              style={{
                color: "#333",
                fontWeight: 500,
                fontSize: 13,
                cursor: "pointer",
                margin: 0,
              }}
            >
              Hiện đường nối
            </label>
          </div>

          <div
            className="form-check form-switch m-0"
            style={{ display: "flex", alignItems: "center", width: "100%" }}
          >
            <input
              className="form-check-input"
              type="checkbox"
              id="toggleText"
              checked={showText}
              onChange={() => setShowText(!showText)}
              style={{ cursor: "pointer", marginRight: "8px" }}
            />
            <label
              className="form-check-label"
              htmlFor="toggleText"
              style={{
                color: "#333",
                fontWeight: 500,
                fontSize: 13,
                cursor: "pointer",
                margin: 0,
              }}
            >
              Hiện thông tin
            </label>
          </div>

          <div
            className="form-check form-switch m-0"
            style={{ display: "flex", alignItems: "center", width: "100%" }}
          >
            <input
              className="form-check-input"
              type="checkbox"
              id="togglePriceChange"
              checked={showPrice_Change}
              onChange={() => setShowPrice_Change(!showPrice_Change)}
              style={{ cursor: "pointer", marginRight: "8px" }}
            />
            <label
              className="form-check-label"
              htmlFor="togglePriceChange"
              style={{
                color: "#333",
                fontWeight: 500,
                fontSize: 13,
                cursor: "pointer",
                margin: 0,
              }}
            >
              CL giá vùng 1
            </label>
          </div>

          <div
            className="form-check form-switch m-0"
            style={{ display: "flex", alignItems: "center", width: "100%" }}
          >
            <input
              className="form-check-input"
              type="checkbox"
              id="togglePriceChangeTT"
              checked={showPrice_Change_TT}
              onChange={() => setShowPrice_Change_TT(!showPrice_Change_TT)}
              style={{ cursor: "pointer", marginRight: "8px" }}
            />
            <label
              className="form-check-label"
              htmlFor="togglePriceChangeTT"
              style={{
                color: "#333",
                fontWeight: 500,
                fontSize: 13,
                cursor: "pointer",
                margin: 0,
              }}
            >
              So sánh giá TT với V1
            </label>
          </div>

          {/* Hiện CHXD ngoài BUKRS đang chọn */}
          <div
            className="form-check form-switch m-0"
            style={{ display: "flex", alignItems: "center", width: "100%" }}
          >
            <input
              className="form-check-input"
              type="checkbox"
              id="toggleAround"
              checked={showAround}
              onChange={() => setShowAround(!showAround)}
              style={{ cursor: "pointer", marginRight: "8px" }}
            />
            <label
              className="form-check-label"
              htmlFor="toggleAround"
              style={{
                color: "#333",
                fontWeight: 500,
                fontSize: 13,
                cursor: "pointer",
                margin: 0,
              }}
            >
              Hiện cửa hàng xung quanh
              {othersLoading ? " (đang tải...)" : ""}
            </label>
          </div>
          {showAround && (
            <div style={{ fontSize: 11, color: "#86868b", marginTop: -4 }}>
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
          <div style={{ width: 160 }}>
            <MapTypeSelect value={mapType} onChange={handleMapTypeChange} />
          </div>
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
