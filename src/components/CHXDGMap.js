import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const CHXDGMap = () => {
  const { CHXD_ID } = useParams();
  const mapRef = useRef(null);
  const markerGroupRef = useRef(null);
  const lineGroupRef = useRef(null);
  const [coords, setCoords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showLines, setShowLines] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapType, setMapType] = useState("satellite");

  const handleMapTypeChange = (type) => {
    setMapType(type);
      if (!mapRef.current) return;

      // Xóa lớp cũ
      mapRef.current.eachLayer(layer => {
        if (layer instanceof L.TileLayer) mapRef.current.removeLayer(layer);
      });

      // Chọn layer mới
      let url = "";
      switch (type) {
        case "street":
          url = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
          break;
        default:
          url = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
      }

      L.tileLayer(url, {
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(mapRef.current);
  };


  // 1. Fetch dữ liệu
  const fetchCHXDList = async () => {
    try {
      setLoading(true);
      const token = btoa(`${API_USER}:${API_PASSWORD}`);
      const res = await fetch(`${BASE_URL}${API}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${token}` },
        body: JSON.stringify({ FUNC: "ZFM_CHXD_GMAP" }),
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      const list =
        Array.isArray(data?.RESPONSE?.T_DATA) && data.RESPONSE.T_DATA.length > 0
          ? data.RESPONSE.T_DATA.map(i => ({
              id: i.CHXD_ID,
              title: i.CHXD_TXT || "Cửa hàng không tên",
              lat: parseFloat(i.ZLAT),
              lng: parseFloat(i.ZLONG),
              address: i.ADDRESS || "",
              phone: i.PHONE || "",
              logo: i.LOGO || "PLX",
            })).filter(x => !isNaN(x.lat) && !isNaN(x.lng))
          : [
              { id: "HN", title: "CHXD Petrolimex Hà Nội", lat: 21.0285, lng: 105.8542 },
              { id: "DN", title: "CHXD Petrolimex Đà Nẵng", lat: 16.0678, lng: 108.2208 },
              { id: "HCM", title: "CHXD Petrolimex TP.HCM", lat: 10.7769, lng: 106.7009 },
            ];
      setCoords(list);
    } catch (err) {
      console.error(err);
      setError("Không thể kết nối tới API hoặc dữ liệu lỗi.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCHXDList(); }, []);

  // 1. Khởi tạo map
  useEffect(() => {
    if (!mapRef.current) {
      mapRef.current = L.map("map", { center: [15.5, 107], zoom: 6 });
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }
      ).addTo(mapRef.current);
      markerGroupRef.current = L.featureGroup().addTo(mapRef.current);
      lineGroupRef.current = L.featureGroup().addTo(mapRef.current);
    }
  }, []);

  // 3. Marker + label
  useEffect(() => {
    if (!mapRef.current || coords.length === 0) return;
    const map = mapRef.current;
    const markerGroup = markerGroupRef.current;
    markerGroup.clearLayers();

    const target = coords.find(x => x.id === CHXD_ID);
    let nearest10 = [];

    if (target) {
      const getDistance = (a,b) => {
        const R = 6371;
        const dLat = ((b.lat - a.lat) * Math.PI)/180;
        const dLon = ((b.lng - a.lng) * Math.PI)/180;
        const lat1 = a.lat * Math.PI/180;
        const lat2 = b.lat * Math.PI/180;
        const x = Math.sin(dLat/2)**2 + Math.sin(dLon/2)**2 * Math.cos(lat1) * Math.cos(lat2);
        return 2*R*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
      };
      nearest10 = coords.filter(c => c.id !== target.id)
        .sort((a,b) => getDistance(a,target)-getDistance(b,target))
        .slice(0,10)
        .map(c => c.id);
    }

    coords.forEach(c => {
      const isTarget = c.id === CHXD_ID;
      const isNearby = nearest10.includes(c.id);

      const iconUrl = c.logo === "PVOIL" ? process.env.PUBLIC_URL+"/logo_pvoil.png" : process.env.PUBLIC_URL+"/logo_plx.png";
      const markerIcon = L.icon({ iconUrl, iconSize: isTarget||isNearby?[34,34]:[28,28], iconAnchor:[17,34], popupAnchor:[0,-25] });
      const marker = L.marker([c.lat,c.lng], { icon: markerIcon }).bindPopup(`
        <b>${c.title}</b><br/><b>${c.id}</b><br/>📍 <i>${c.address}</i><br/>☎️ ${c.phone || "N/A"}
      `);
      marker.on("mouseover", ()=>marker.openPopup());
      marker.on("mouseout", ()=>marker.closePopup());

      const labelHTML = `<div style="
        background: rgba(255,255,255,0.95);
        border: 1.5px solid ${isTarget?"#d33":isNearby?"#ff8800":"#2a5599"};
        border-radius:6px;
        padding:2px 5px;
        font-size:11px;
        color:${isTarget?"#d33":isNearby?"#ff8800":"#2a5599"};
        font-weight:${isTarget?"bold":"normal"};
        display:inline-block;
        white-space:nowrap;
        margin-left:6px;
        ${isTarget?"animation:pulseLabel 1.2s infinite":""};
      ">${c.title.length>16?c.title.slice(0,16)+"…":c.title}</div>`;
      const label = L.divIcon({ html: labelHTML, className:"plx-label", iconSize:null, iconAnchor:[-5,15] });
      const textMarker = L.marker([c.lat,c.lng], { icon: label, interactive:false });

      markerGroup.addLayer(marker);
      markerGroup.addLayer(textMarker);
    });

    const bounds = L.latLngBounds(coords.map(c => [c.lat,c.lng]));
    map.fitBounds(bounds, { padding:[60,60], maxZoom:15 });

    if (target) map.setView([target.lat,target.lng], 13, { animate:true });
  }, [coords, CHXD_ID, mapLoaded]);

  // 4. Polyline toggle
  useEffect(() => {
    if (!mapRef.current || coords.length === 0) return;
    const map = mapRef.current;
    const lineGroup = lineGroupRef.current;
    lineGroup.clearLayers();

    const target = coords.find(x => x.id === CHXD_ID);
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
  }, [showLines, coords, CHXD_ID]);

  return (
    <div style={{ height: "100vh", position: "relative" }}>
      {/* --- Bộ điều khiển (controls) góc phải --- */}
      <div
        className="d-flex flex-column align-items-end gap-2 position-absolute"
        style={{
          top: 10,
          right: 10,
          zIndex: 1000,
          background: "rgba(255, 255, 255, 0.9)",
          borderRadius: 10,
          padding: "10px 12px",
          boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
        }}
      >
        {/* Công tắc đường nối */}
        <div className="form-check form-switch m-0">
          <input
            className="form-check-input"
            type="checkbox"
            id="toggleLines"
            checked={showLines}
            onChange={() => setShowLines(!showLines)}
            style={{ cursor: "pointer" }}
          />
          <label
            className="form-check-label ms-2"
            htmlFor="toggleLines"
            style={{
              color: "#333",
              fontWeight: 500,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Hiện đường nối
          </label>
        </div>

        {/* Dropdown chọn loại bản đồ */}
        <div style={{ width: 160 }}>
          <label
            htmlFor="mapType"
            className="form-label mb-1"
            style={{ fontWeight: "bold", fontSize: 13, color: "#333" }}
          >
            Loại bản đồ
          </label>
          <select
            id="mapType"
            className="form-select form-select-sm"
            value={mapType}
            onChange={(e) => handleMapTypeChange(e.target.value)}
            style={{ fontSize: 13, cursor: "pointer" }}
          >
            <option value="satellite">🛰️ Vệ tinh</option>
            <option value="street">🗺️ Đường phố</option>
          </select>
        </div>
      </div>

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
      <div id="map" style={{ height: "100vh", width: "100%" }} />
    </div>
  );

};

export default CHXDGMap;
