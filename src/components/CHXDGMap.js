import React, { useEffect, useState, useRef, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import MapTypeSelect from "./MapTypeSelect";

const CHXDGMap = () => {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const bukrsParam = searchParams.get("I_BUKRS") || searchParams.get("i_bukrs") || "";
  const chxdIdParam = searchParams.get("i_chxdid") || searchParams.get("I_CHXDID") || "";
  const matnrParam = searchParams.get("i_matnr") || searchParams.get("I_MATNR") || "";
  const targetId = chxdIdParam;

  const mapRef = useRef(null);
  const markerGroupRef = useRef(null);
  const lineGroupRef = useRef(null);

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

  // Thêm state để track expanded categories (sau các state declarations)
  const [expandedCategories, setExpandedCategories] = useState({});

  const getFuelIcon = (matkl) => {
    const fuel = (matkl || "").toUpperCase();
    if (fuel.includes("0201")) return "/icons/xang92.svg";
    return "/icons/do.svg";
  };

  const handleSelectStation = (id) => {
    if (!id) return;
    const params = new URLSearchParams(location.search);
    if (bukrsParam) params.set("i_bukrs", bukrsParam);
    params.set("i_chxdid", id);
    window.location.search = params.toString();
  };

  const getMarkerSize = (zoom) => {
    // Logo nhỏ dần khi zoom nhỏ - giảm kích thước rõ ràng hơn
    if (zoom >= 16) return 44;
    if (zoom >= 14) return 36;
    if (zoom >= 12) return 30;
    if (zoom >= 10) return 24;
    if (zoom >= 8) return 18;
    if (zoom >= 7) return 16;
    if (zoom >= 6) return 14;
    if (zoom >= 5) return 12;
    return 10; // Zoom rất nhỏ (< 5) thì logo rất nhỏ
  };

  const getFontSize = (zoom) => {
    // Đồng bộ breakpoints với getMarkerSize, nhỏ dần khi zoom nhỏ
    if (zoom >= 16) return 14;
    if (zoom >= 14) return 12;
    if (zoom >= 12) return 11;
    if (zoom >= 10) return 10;
    if (zoom >= 8) return 9;
    if (zoom >= 7) return 8;
    if (zoom >= 6) return 8;
    if (zoom >= 5) return 7;
    return 6; // Zoom rất nhỏ (< 5) thì font rất nhỏ
  };

  const computeLabelOpacity = (z) => {
    if (z < 10) return 0;
    if (z >= 15) return 1;
    return (z - 15) / (15 - 10); // linear 10->0 .. 13->1
  };

  const handleMapTypeChange = (type) => {
    setMapType(type);
    if (!mapRef.current) return;
    // Chỉ remove tileLayer, giữ markerGroup
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
      updateWhenZooming: false,  // Chỉ load tiles khi zoom xong
      updateWhenIdle: true,      // Load tiles khi map không di chuyển
      keepBuffer: 1,             // Giảm buffer xuống 1 để giảm memory
      maxNativeZoom: 18,
      tileSize: 256,
      zoomOffset: 0,
      crossOrigin: true
    }).addTo(mapRef.current);
  };

  // Thêm hàm helper để tính màu dựa trên mức thay đổi (sau các hàm getMarkerSize, getFontSize, etc.)
  const getPriceChangeColor = (priceChange) => {
    
      // Mức tăng - màu đỏ
      if (priceChange > 200) {
        return { color: "rgb(214, 20, 39)", bg: "rgba(255, 255, 255, 1)" }; 
      } else if (priceChange > 100) {
        return { color: "rgb(252, 255, 48)", bg: "rgba(255, 255, 255, 1)" };
      } else {
        return { color: "rgb(28, 158, 58)", bg: "rgba(255, 255, 255, 1)" };
      }    
  };

  // 1. Fetch dữ liệu
  const fetchCHXDList = async () => {
    // Chỉ fetch khi có bukrsParam
    if (!bukrsParam) {
      setCoords([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const token = btoa(`${API_USER}:${API_PASSWORD}`);
      const res = await fetch(`${BASE_URL}${API}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${token}` },
        body: JSON.stringify({
          FUNC: "ZFM_CHXD_GMAP",
          DATA: { I_BUKRS: bukrsParam, I_MATNR: matnrParam },
        }),
      });

      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

      const data = await res.json();
      
      const list =  data.RESPONSE.T_DATA.map(i => {
        const mime = "image/jpeg";
        const base64Img = i.BASE64 ? `data:${mime};base64,${i.BASE64}` : "";
        const urlImg = i.IMAGE_URL || i.IMG_URL || i.ZIMG || i.IMG || "";
        return {
          id: i.CHXD_ID,
          title: i.CHXD_T || "Cửa hàng không tên",
          lat: parseFloat(i.ZLAT),
          lng: parseFloat(i.ZLONG),
          address: i.ADDRESS || "Đang cập nhật",
          chxd_type: i.CHXD_TYPE || i.CHXD_TY || i.CHXD_CLASS || "",
          image: base64Img || urlImg, 
          matnr: i.MATNR,
          matnr_t: i.MATNR_T,
          matkl: i.MATKL,
          price: i.PRICE,
          price_change: i.PRICE_CHANGE,
          price_change_tt: i.PRICE_CHANGE_TT,
          kbetr_tt:i.KBETR_TT
        };
      }).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng));
          
      // Nếu có chxdIdParam, lấy thêm dữ liệu chi tiết cho CHXD đó
      if (chxdIdParam) {
        try {
          const detailRes = await fetch(`${BASE_URL}${API}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Basic ${token}` },
            body: JSON.stringify({
              FUNC: "ZFM_CHXD_GMAP",
              DATA: { I_BUKRS: bukrsParam, I_CHXD_ID: chxdIdParam, I_MATNR: matnrParam },
            }),
          });

          if (detailRes.ok) {
            const detailData = await detailRes.json();
            const tData = detailData?.RESPONSE?.T_DATA;
            
            if (tData && tData.length > 0) {
              const detailItem = tData[0];
              const mime = "image/jpeg";
              const base64Img = detailItem.BASE64 ? `data:${mime};base64,${detailItem.BASE64}` : "";
              const urlImg = detailItem.IMAGE_URL || detailItem.IMG_URL || detailItem.ZIMG || detailItem.IMG || "";
              
              const detailInfo = {
                id: detailItem.CHXD_ID,
                title: detailItem.CHXD_T || "Cửa hàng không tên",
                lat: parseFloat(detailItem.ZLAT),
                lng: parseFloat(detailItem.ZLONG),
                address: detailItem.ADDRESS || "Đang cập nhật",
                chxd_type: detailItem.CHXD_TYPE || detailItem.CHXD_TY || detailItem.CHXD_CLASS || "",
                image: base64Img || urlImg,
                matnr: detailItem.MATNR,
                matnr_t: detailItem.MATNR_T,
                matkl: detailItem.MATKL,
                price: detailItem.PRICE,
                price_change: detailItem.PRICE_CHANGE,
                price_change_tt: detailItem.PRICE_CHANGE_TT,
                kbetr_tt:detailItem.KBETR_TT
              };

              // Kiểm tra xem CHXD đã có trong list chưa
              const existingIndex = list.findIndex(x => x.id === detailInfo.id);
              if (existingIndex >= 0) {
                // Cập nhật thông tin chi tiết (đặc biệt là image base64) nếu đã có
                list[existingIndex] = { ...list[existingIndex], ...detailInfo };
              } else {
                // Thêm vào list nếu chưa có (trường hợp CHXD không thuộc BUKRS này)
                if (!isNaN(detailInfo.lat) && !isNaN(detailInfo.lng)) {
                  list.push(detailInfo);
                }
              }
            }
          }
        } catch (detailErr) {
          console.error("Error fetching CHXD detail:", detailErr);
        }
      }

      setCoords(list);
    } catch (err) {
      console.error(err);
      setError("Không thể kết nối tới API hoặc dữ liệu lỗi.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCHXDList(); }, []);

  // Update icons + labels on zoom change (resize icons and update label font)
  // Update ngay lập tức khi zoom thay đổi
  useEffect(() => {
    if (!mapRef.current || !markerGroupRef.current) return;

    // Update ngay lập tức khi zoom thay đổi (không debounce)
    requestAnimationFrame(() => {
      const markerGroup = markerGroupRef.current;
      if (!markerGroup || !mapRef.current) return;

      // Lấy zoom hiện tại từ map để đảm bảo chính xác
      const currentZoom = mapRef.current.getZoom() || zoom;
      const size = getMarkerSize(currentZoom);
      const fontSize = getFontSize(currentZoom);

      markerGroup.eachLayer(layer => {
        // Resize marker icons (image icons)
        if (layer instanceof L.Marker && layer.options.icon && layer.options.icon.options && layer.options.icon.options.iconUrl) {
          const oldIcon = layer.options.icon;
          const newIcon = L.icon({
            iconUrl: oldIcon.options.iconUrl,
            iconSize: [size, size],
            iconAnchor: [size / 2, size],
            popupAnchor: [0, -25],
          });
          layer.setIcon(newIcon);
        }

        // Update divIcon (plx-label) HTML font-size and re-apply opacity
        if (layer instanceof L.Marker && layer.options.icon && layer.options.icon.options && layer.options.icon.options.className === "plx-label") {
          const oldHtml = layer.options.icon.options.html || "";
          // Replace font-size in the HTML if exists, else add style
          let newHtml;
          if (/\bfont-size:\s*\d+px/.test(oldHtml)) {
            newHtml = oldHtml.replace(/font-size:\s*\d+px/g, `font-size:${fontSize}px`);
          } else {
            // try to inject font-size into first style attribute
            newHtml = oldHtml.replace(/style="([^"]*)"/, (m, p1) => {
              return `style="${p1}; font-size:${fontSize}px"`;
            });
          }

          const newDivIcon = L.divIcon({
            ...layer.options.icon.options,
            html: newHtml
          });

          layer.setIcon(newDivIcon);

          // Nếu showText = true, luôn hiển thị đầy đủ (opacity = 1)
          // Nếu showText = false, điều chỉnh opacity theo zoom
          const el = layer.getElement();
          if (el) {
            el.style.opacity = showText ? 1 : computeLabelOpacity(currentZoom);
          } else {
            // If element not yet available, attach once 'add' to apply opacity when rendered
            layer.once("add", () => {
              const el2 = layer.getElement();
              if (el2) el2.style.opacity = showText ? 1 : computeLabelOpacity(currentZoom);
            });
          }
        }
      });
    });
  }, [zoom, showText]); // Thêm showText vào dependency array

  // Thêm ref để lưu giá trị showText (sau các state declarations)
  const showTextRef = useRef(showText);

  // Cập nhật ref khi showText thay đổi
  useEffect(() => {
    showTextRef.current = showText;
  }, [showText]);

  // 1. Khởi tạo map
  useEffect(() => {
    if (!mapRef.current) {
      mapRef.current = L.map("map", { 
        center: [15.5, 107], 
        zoom: 6,
        zoomAnimation: true,        // Bật animation zoom
        zoomAnimationThreshold: 4,  // Chỉ animate khi zoom > 4 levels
        fadeAnimation: true,        // Fade effect cho tiles
        markerZoomAnimation: false  // Tắt để giảm lag khi zoom
      });
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { 
          maxZoom: 18, 
          attribution: '&copy; OpenStreetMap contributors',
          updateWhenZooming: false,  // Chỉ load tiles khi zoom xong
          updateWhenIdle: true,      // Load tiles khi map không di chuyển
          keepBuffer: 1,             // Giảm buffer xuống 1 để giảm memory
          maxNativeZoom: 18,
          tileSize: 256,
          zoomOffset: 0,
          crossOrigin: true
        }
      ).addTo(mapRef.current);
      markerGroupRef.current = L.featureGroup().addTo(mapRef.current);
      lineGroupRef.current = L.featureGroup().addTo(mapRef.current);

      mapRef.current.on("zoomend", () => {
        const z = mapRef.current.getZoom();
        setZoom(z);
        
        requestAnimationFrame(() => {
          const mg = markerGroupRef.current;
          if (mg) {
            mg.eachLayer(layer => {
              if (layer.options?.icon?.options?.className === "plx-label") {
                const el = layer.getElement();
                if (el) {
                  // Sử dụng showTextRef.current thay vì showText để tránh stale closure
                  el.style.opacity = showTextRef.current ? 1 : computeLabelOpacity(z);
                }
              }
            });
          }
        });
      });
      
      setMapLoaded(true);
    }
  }, []);

  const initialViewSet = useRef(false);

  const typeMeta = {
    PLX: { label: "PLX", color: "#0d6efd" },
    PVI: { label: "PVOIL", color: "#2fb344" },
    OTH: { label: "KHÁC", color: "#f59f00" },
    NEW: { label: "ĐẦU TƯ MỚI", color: "#d6336c" },
    TNNQ: { label: "THƯƠNG NHÂN NHƯỢNG QUYỀN", color: "#6c757d" },
  };

  const resolveType = (c) => {
    const t = (c.chxd_type || "").toUpperCase();    
    if (t.includes("TNNQ")) return "TNNQ";
    if (t.includes("PVI")) return "PVI";
    if (t.includes("NEW")) return "NEW";
    if (t.includes("PLX")) return "PLX";
    if (!t) return "OTH";
    return "OTH";
  };

  const categorized = useMemo(() => {
    const base = { PLX: [], PVI: [], OTH: [], NEW: [], TNNQ: [] };
    coords.forEach((c) => {
      const k = resolveType(c);
      if (!base[k]) base[k] = [];
      base[k].push(c);
    });
    console.log(base);
    return base;
  }, [coords]);

  const visibleCoords = useMemo(
    () =>
      coords.filter((c) => {
        const k = resolveType(c);
        return categoryFilters[k] !== false;
      }),
    [coords, categoryFilters]
  );

  // Tự động filter chỉ hiển thị PLX khi showPrice_Change_TT được chọn
  useEffect(() => {
    if (showPrice_Change_TT) {
      setCategoryFilters({
        PLX: true,
        PVI: false,
        OTH: false,
        NEW: false,
        TNNQ: false,
      });
    } else {
      // Khi tắt showPrice_Change_TT, khôi phục về trạng thái mặc định
      setCategoryFilters({
        PLX: true,
        PVI: true,
        OTH: true,
        NEW: true,
        TNNQ: true,
      });
    }
  }, [showPrice_Change_TT]);

  // 3. Marker + label
  useEffect(() => {
    if (!mapRef.current || visibleCoords.length === 0) return;
    const map = mapRef.current;
    const markerGroup = markerGroupRef.current;
    markerGroup.clearLayers();

    const target = visibleCoords.find(x => x.id === targetId);
    
    const hideMarkerTooltip = false;//!!chxdIdParam;

    // Lấy zoom hiện tại từ map để đảm bảo chính xác
    const currentZoom = map.getZoom() || zoom;

    // Lưu target marker để thêm vào sau cùng
    let targetMarker = null;
    let targetTextMarker = null;

    visibleCoords.forEach(c => {
      const size = getMarkerSize(currentZoom);
      const fs = getFontSize(currentZoom);

      const isTarget = c.id === targetId;

      let iconUrl = process.env.PUBLIC_URL + "/logo_default.png";
      switch (c.chxd_type) {
        case "PLX":
          iconUrl = process.env.PUBLIC_URL + "/logo_plx.png";
          break;
        case "NEW":
          iconUrl = process.env.PUBLIC_URL + "/logo_plx.png";
          break;
        case "PVI":
          iconUrl = process.env.PUBLIC_URL + "/logo_pvoil.png";
          break;
        case "TNNQ":
          iconUrl = process.env.PUBLIC_URL + "/logo_tnnq.png";
          break;
        case "OTH":
          iconUrl = process.env.PUBLIC_URL + "/logo_doithu1.png";
          break;        
        default:
          iconUrl = process.env.PUBLIC_URL + "/logo_default.png";
          break;
      }

      const markerIcon = L.icon({ iconUrl, iconSize: [size, size], iconAnchor:[size / 2, size], popupAnchor:[0,-25] });
      const marker = L.marker([c.lat,c.lng], { 
        icon: markerIcon,
        zIndexOffset: isTarget && chxdIdParam ? 1000 : 0 // Target marker luôn ở trên khi có chxdIdParam
      });

      marker.on("click", () => {
        handleSelectStation(c.id);
      });

      if (!hideMarkerTooltip) {
        marker.bindPopup(`
          <b>${c.title}</b><br/><b>${c.id}</b><br/>📍 <i>${c.address}</i>}
        `);
        marker.on("mouseover", ()=>marker.openPopup());
        marker.on("mouseout", ()=>marker.closePopup());
      }

      // Giá chính - Màu xanh dương Apple
      const priceHTML = `<span class="price-value" style="color:#007aff;font-weight:600;">${c.price.toLocaleString()} đ/L</span>`

      // Giá thay đổi (tăng/giảm) - Phân vùng màu theo mức độ
      const priceChange = c.price_change;
      const priceChangeColors = getPriceChangeColor(priceChange);
      const priceChangeDisplay = priceChange > 0 
        ? `+${priceChange.toLocaleString()}` 
        : priceChange.toLocaleString();

      const priceChangeTT = c.price_change_tt;
      const priceChangeTTColors = getPriceChangeColor(priceChangeTT);
      const priceChangeTTDisplay = priceChangeTT > 0 
        ? `+${priceChangeTT.toLocaleString()}` 
        : priceChangeTT.toLocaleString();     

      // Tạo priceChangeHTML dựa trên các toggle
      let priceChangeHTML = "";
      const parts = [];
      
      if (showPrice_Change) {
        parts.push(`
          <span style="
              font-weight: 500;
              font-size: 12px;
              color: ${priceChangeColors.color};
              background: ${priceChangeColors.bg};
              padding: 3px 6px 3px 6px;
              border-radius: 6px;
              display: inline-flex;
              align-items: center;              
            ">
              ${priceChangeDisplay} 
          </span>
        `);
      }
      
      if (showPrice_Change_TT) {
        parts.push(`
          <span style="
              font-weight: 500;
              font-size: 12px;
              color: ${priceChangeTTColors.color};
              background: ${priceChangeTTColors.bg};
              padding: 3px 6px 3px 6px;
              border-radius: 6px;
              display: inline-flex;
              align-items: center;
            ">
              ${priceChangeTTDisplay}
          </span>
        `);
      }
      
      if (parts.length > 0) {
        priceChangeHTML = `<div style="display: inline-flex; align-items: center; gap: 0px;">
          ${parts.join('<span style="color: #000">|</span>')}
        </div>`;
      }            

      // Tính toán font-size tự động dựa trên độ dài title
      const maxTitleLength = 20;
      const titleLength = c.title.length;
      let titleFontSize = fs;
      
      if (titleLength > maxTitleLength) {
        const scaleFactor = maxTitleLength / titleLength;
        titleFontSize = Math.max(fs * scaleFactor, fs * 0.7);
      }
      
      const labelTitleHTML = `<div style="font-size: ${titleFontSize}px; color: #1d1d1f; font-weight: ${isTarget ? "600" : "500"}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; line-height: 1.3;">${c.title}</div>`;      
      const priceDivHTML = `<div class="price-container" style="margin-top: 2px; display: flex; align-items: center;">${priceHTML}</div>`;
      
      // Gộp labelTitleHTML và priceDivHTML thành một
      const labelAndPriceHTML = showText ? `${labelTitleHTML}${priceDivHTML}` : "";

      // Tạo labelHTML bằng cách kết hợp các phần dựa trên các tùy chọn
      const labelParts = [];
      
      if (labelAndPriceHTML.trim()) {
        labelParts.push(labelAndPriceHTML);
      }
      
      if (priceChangeHTML) {
        labelParts.push(priceChangeHTML);
      }
      
      // Chỉ tạo labelHTML nếu có ít nhất một phần
      const labelHTML = labelParts.length > 0
        ? `
          <div style="
            background: rgba(255,255,255,0.98);
            border: 1.5px solid ${isTarget ? "#ff3b30" : "#d2d2d7"};
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
            ${labelParts.join('')}
          </div>
        `
        : "";

      const labelIcon = L.divIcon({ html: labelHTML, className:"plx-label", iconSize:null, iconAnchor:[-5,15] });      
      const textMarker = L.marker([c.lat,c.lng], { 
        icon: labelIcon, 
        interactive: true, 
        bubblingMouseEvents: false,
        zIndexOffset: isTarget && chxdIdParam ? 1000 : 0 // Target label luôn ở trên
      });

      // When added to map, immediately set opacity based on showText and zoom
      textMarker.on("add", () => {
        const el = textMarker.getElement();
        if (el) {
          el.style.opacity = showTextRef.current ? 1 : computeLabelOpacity(zoom);
        }
      });

      // Also set if element already exists (rare)
      const existingEl = textMarker.getElement();
      if (existingEl) {
        existingEl.style.opacity = showTextRef.current ? 1 : computeLabelOpacity(zoom);
      }

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
      const target = visibleCoords.find(x => x.id === targetId);
      
      if (target) {
        // Nếu có target, zoom trực tiếp vào target
        map.setView([target.lat, target.lng], 15, { animate: true });
      } else {
        // Nếu không có target, fit bounds cho tất cả
        const bounds = L.latLngBounds(visibleCoords.map(c => [c.lat, c.lng]));
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
      }

      initialViewSet.current = true; // đánh dấu đã set view
    }
  }, [visibleCoords, targetId, mapLoaded, showText, showPrice_Change, showPrice_Change_TT]); 

  // 4. Polyline toggle
  useEffect(() => {
    if (!mapRef.current || coords.length === 0) return;
    const map = mapRef.current;
    const lineGroup = lineGroupRef.current;
    lineGroup.clearLayers();

    const target = coords.find(x => x.id === targetId);
    if (!target || !showLines) return;

    const getDistance = (a,b) => {
      const R = 6371;
      const dLat = ((b.lat-a.lat)*Math.PI)/180;
      const dLon = ((b.lng-a.lng)*Math.PI)/180;
      const lat1 = a.lat*Math.PI/180;
      const lat2 = b.lat*Math.PI/180;
      const x = Math.sin(dLat/2)**2 + Math.sin(dLon/2)**2 * Math.cos(lat1) * Math.cos(lat2);
      return 2*R*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
    };

    coords.filter(c=>c.id!==target.id)
      .sort((a,b)=>getDistance(a,target)-getDistance(b,target))
      .slice(0,10)
      .forEach(p => {
        const dist = getDistance(target,p).toFixed(2);
        const line = L.polyline([[target.lat,target.lng],[p.lat,p.lng]], { color:"#ff8800", weight:2, dashArray:"5,5", opacity:0.8 });
        line.bindTooltip(`${dist} km`, { permanent:true, className:"distance-tooltip", direction:"center" });
        lineGroup.addLayer(line);
      });

    lineGroup.addTo(map);
  }, [showLines, visibleCoords, targetId]);

  const targetStation = visibleCoords.find(c => c.id === targetId);

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

          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10, color: "#1d1d1f" }}>
            Hệ thống CHXD trên địa bàn
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#1d1d1f", marginBottom: 4 }}>
            {targetStation.title}
          </div>
          <div style={{ fontSize: 12, marginBottom: 6, color: "#86868b", fontWeight: 400 }}>
            {targetStation.id}
          </div>
          <div style={{ color: "#86868b", marginBottom: 10, fontSize: 14 }}>
            📍 {targetStation.address || "Đang cập nhật"}
          </div>
          <div style={{ 
            background: "#f5f5f7", 
            padding: "12px 14px", 
            borderRadius: "12px", 
            marginBottom: 12,
            border: "1px solid #d2d2d7",
            display: "flex",
            alignItems: "center",
            gap: "12px"
          }}>
            <div style={{ 
              width: "40px", 
              height: "40px", 
              borderRadius: "50%", 
              background: "#ffffff", 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              padding: "8px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
            }}>
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
              <div style={{ fontSize: "13px", color: "#86868b", textTransform: "uppercase", fontWeight: "600", letterSpacing: "0.3px", marginBottom: "4px" }}>
                {targetStation.matnr_t}
              </div>
              <div style={{ fontSize: "20px", fontWeight: "600", color: "#1d1d1f", display: "flex", alignItems: "center", lineHeight: "1.2" }}>
                <>
                  <span style={{ color: "#007aff", fontWeight: "600" }}>
                    {targetStation.price.toLocaleString()} đ/L
                  </span>                    
                  {(() => {                      
                    const changeColors = getPriceChangeColor(targetStation.price_change);
                    const priceChangeDisplay = targetStation.price_change > 0 
                      ? `+${targetStation.price_change.toLocaleString()}` 
                      : targetStation.price_change.toLocaleString();

                    const changeTTColors = getPriceChangeColor(targetStation.price_change_tt);
                    const priceChangeTTDisplay = targetStation.price_change_tt > 0 
                      ? `+${targetStation.price_change_tt.toLocaleString()}` 
                      : targetStation.price_change_tt.toLocaleString();

                    const parts = [];
                    
                    if (showPrice_Change) {
                      parts.push(
                        <span key="priceChange" style={{ 
                          color: changeColors.color,
                          background: changeColors.bg,
                          padding: "4px 6px",
                          borderRadius: "6px"
                        }}>
                          {priceChangeDisplay}
                        </span>
                      );
                    }
                    
                    if (showPrice_Change_TT) {
                      parts.push(
                        <span key="priceChangeTT" style={{ 
                          color: changeTTColors.color,
                          background: changeTTColors.bg,
                          padding: "4px 6px",
                          borderRadius: "6px"
                        }}>
                          {priceChangeTTDisplay}
                        </span>
                      );
                    }
                    
                    if (parts.length === 0) {
                      return null;
                    }
                    
                    return (
                      <div style={{ 
                        marginLeft: "10px", 
                        fontSize: "13px", 
                        fontWeight: "500",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0px"
                      }}>
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
                  })()}                    
                </>
            </div>
            </div>
          </div>
          {targetStation.image && (
            <div style={{ position: "relative", width: "100%", minHeight: 220 }}>
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
                  <div style={{ fontSize: 14, color: "#666" }}>⏳ Đang tải ảnh...</div>
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
      { !showListPanel && (
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Hệ thống CHXD trên địa bàn</div>
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

          {[
            { key: "PLX", filterKey: "PLX" },
            { key: "PVI", filterKey: "PVI" },
            { key: "TNNQ", filterKey: "TNNQ" },
            { key: "NEW", filterKey: "NEW" },
            { key: "OTH", filterKey: "OTH" },
          ].map(({ key, filterKey }) => {
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
                      setCategoryFilters(prev => ({
                        ...prev,
                        [filterKey]: !prev[filterKey],
                      }))
                    }
                    style={{ cursor: "pointer" }}
                  />
                  {meta?.label || "Nhóm khác"}
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "#555" }}>{count} điểm</span>
                </label>

                {list.slice(0, expandedCategories[key] ? list.length : 4).map(item => (
                  <div
                    key={item.id}
                    onClick={() => handleSelectStation(item.id)}
                    style={{ paddingLeft: 26, color: "#444", fontSize: 13, marginTop: 4, cursor: "pointer" }}
                  >
                    • {item.title}
                  </div>
                ))}

                {count > 4 && (
                  <div 
                    onClick={() => setExpandedCategories(prev => ({
                      ...prev,
                      [key]: !prev[key] // Toggle expanded state cho category này
                    }))}
                    style={{ 
                      paddingLeft: 26, 
                      marginTop: 6, 
                      fontSize: 12, 
                      color: "#2a5599",
                      cursor: "pointer",
                      fontWeight: 500,
                      textDecoration: "underline"
                    }}
                  >
                    {expandedCategories[key] 
                      ? "Thu gọn" 
                      : `${count - 4} khác`}
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
          left: 10,   // Thay đổi từ right: 10
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
          <div className="form-check form-switch m-0" style={{ display: "flex", alignItems: "center", width: "100%" }}>
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
              style={{ color: "#333", fontWeight: 500, fontSize: 13, cursor: "pointer", margin: 0 }}
            >
              Hiện đường nối
            </label>
          </div>

          <div className="form-check form-switch m-0" style={{ display: "flex", alignItems: "center", width: "100%" }}>
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
              style={{ color: "#333", fontWeight: 500, fontSize: 13, cursor: "pointer", margin: 0 }}
            >
              Hiện thông tin
            </label>            
          </div>

          <div className="form-check form-switch m-0" style={{ display: "flex", alignItems: "center", width: "100%" }}>
            <input
              className="form-check-input"
              type="checkbox"
              id="toggleText"
              checked={showPrice_Change}
              onChange={() => setShowPrice_Change(!showPrice_Change)}
              style={{ cursor: "pointer", marginRight: "8px" }}
            />
            <label
              className="form-check-label"
              htmlFor="toggleText"
              style={{ color: "#333", fontWeight: 500, fontSize: 13, cursor: "pointer", margin: 0 }}
            >
              CL giá vùng 1
            </label>            
          </div>

          <div className="form-check form-switch m-0" style={{ display: "flex", alignItems: "center", width: "100%" }}>
            <input
              className="form-check-input"
              type="checkbox"
              id="toggleText"
              checked={showPrice_Change_TT}
              onChange={() => setShowPrice_Change_TT(!showPrice_Change_TT )}
              style={{ cursor: "pointer", marginRight: "8px" }}
            />
            <label
              className="form-check-label"
              htmlFor="toggleText"
              style={{ color: "#333", fontWeight: 500, fontSize: 13, cursor: "pointer", margin: 0 }}
            >
              CL giá so với vùng
            </label>            
          </div>

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
          transform: "translateZ(0)",  // GPU acceleration
          willChange: "transform"      // Hint cho browser
        }} 
      />
    </div>
  );
};

export default CHXDGMap;
