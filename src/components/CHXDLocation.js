import React, { useEffect, useState, useRef } from "react";
import { useParams, useLocation } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";

const CHXDLocation = () => {
  const { CHXD_ID } = useParams();
  const mapRef = useRef(null);
  const tileLayerRef = useRef(null);
  const [showControls, setShowControls] = useState(true);
  const [mapType, setMapType] = useState("satellite");
  const [currentPos, setCurrentPos] = useState(null);
  const [chxdData, setChxdData] = useState(null);
	const [alertMsg, setAlertMsg] = useState("");
  const [alertType, setAlertType] = useState("success");

  const location = useLocation();
  // Nếu URL chứa "/input/" → I_TYPE = 01, còn lại = 02
  const I_TYPE = location.pathname.includes("/input/") ? "01" : "02";

  const showAlert = (msg, type = "success") => {
    setAlertMsg(msg);
    setAlertType(type);

    setTimeout(() => {
      setAlertMsg("");
    }, 3000);
  };

  // Fetch CHXD info
  const fetchCHXDInfo = async () => {
    if (!CHXD_ID) return;
    try {
      const token = btoa(`${API_USER}:${API_PASSWORD}`);
      const body = { FUNC: "ZFM_CHXD_GMAP", DATA: { I_CHXD_ID: CHXD_ID, I_TYPE } };
      const res = await fetch(`${BASE_URL}${API}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      console.log("CHXD INPUT: ", data);

      const tData = data?.RESPONSE?.T_DATA;
      const chxdInfo = tData && tData.length > 0
        ? {
            id: tData[0].CHXD_ID,
            title: tData[0].CHXD_TXT ,
            address: tData[0].ADDRESS,
          }
        : {
            id: CHXD_ID,
            title: "Không tồn tại",
            address: "Không có địa chỉ",
          };          
      setChxdData(chxdInfo);
    } catch (err) {
      console.error("Lỗi fetch CHXD info:", err);
    }
  };

  useEffect(() => {
    fetchCHXDInfo();
  }, [CHXD_ID]);

  // Init map
  useEffect(() => {
    if (mapRef.current) return;

    const map = L.map("map", { center: [10.762622, 106.660172], zoom: 13 });
    mapRef.current = map;

    tileLayerRef.current = createTileLayer(mapType);
    tileLayerRef.current.addTo(map);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => console.error("GPS Error:", err.message),
        { enableHighAccuracy: true }
      );
    }
  }, []);

  // Tạo marker khi có GPS + dữ liệu CHXD
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !currentPos || !chxdData) return;

    const { lat, lng } = currentPos;
    const logoSrc = I_TYPE === "01" 
      ? `${process.env.PUBLIC_URL}/logo_plx.png` 
      : `${process.env.PUBLIC_URL}/logo_pvoil.png`;
    const labelHTML = `
      <div class="pulse-label" style="display:flex; flex-direction:column; align-items:flex-start; max-width:220px; white-space: normal; word-wrap: break-word;">
        
        <div style="display:flex; flex-direction:row; align-items:flex-start;">
          <img src="${logoSrc}" style="height:30px; margin-right:6px;" />
          <div style="display:flex; flex-direction:column;">
            <span style="font-size:12px; font-weight:bold;">${chxdData.id} - ${chxdData.title}</span>
            <span style="font-size:10px;">${chxdData.address}</span>
            <span style="font-size:10px;">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
          </div>
        </div>
      </div>
    `;

    const label = L.divIcon({ html: labelHTML, className: "", iconSize: [220, "auto"], iconAnchor: [110, 50] });
    L.marker([lat, lng], { icon: label, interactive: false }).addTo(map);
    map.setView([lat, lng], 18, { animate: true });
  }, [currentPos, chxdData]);

  const handleSendCHXD = async () => {
    if (!CHXD_ID || !currentPos) return showAlert("Chưa lấy đủ dữ liệu!", "danger");
    const body = {
      FUNC: "ZFM_CHXD_LOCATION",
      DATA: { I_CHXD_GMAP: { CHXD_ID, ZLAT: currentPos.lat.toString(), ZLONG: currentPos.lng.toString() }, I_TYPE },
    };
    const token = btoa(`${API_USER}:${API_PASSWORD}`);
    try {
      const res = await fetch(`${BASE_URL}${API}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.RESPONSE.E_RETURN?.TYPE === "E") showAlert(data.RESPONSE.E_RETURN?.MESSAGE, "danger");
      else showAlert("Gửi tọa độ thành công!", "success");
    } catch (err) {
      alert("Gửi tọa độ thất bại: " + err.message);
    }
  };

  const createTileLayer = (type) => {
    const url =
      type === "street"
        ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
    return L.tileLayer(url, { maxZoom: 18, attribution: "" });
  };

  const handleMapTypeChange = (type) => {
    setMapType(type);
    const map = mapRef.current;
    if (!map) return;
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    tileLayerRef.current = createTileLayer(type).addTo(map);
  };

  return (
    <>
      {alertMsg && (
        <div className={`top-center-alert-wrapper show`}>
          <div className={`alert alert-${alertType} top-center-alert`} role="alert">
            {alertMsg}
          </div>
        </div>
      )}

      <div style={{ height: "100vh", position: "relative" }}>
        <button
          onClick={() => setShowControls(!showControls)}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 1001,
            width: 32,
            height: 32,
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

        {showControls && (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              zIndex: 1000,
              background: "rgba(255,255,255,0.95)",
              padding: 12,
              borderRadius: 10,
              minWidth: 180,
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowControls(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: 18,
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                ✖
              </button>
            </div>

            <div style={{ height: 10 }}></div>

            <label style={{ fontSize: 13, fontWeight: "bold", marginBottom: 4 }}>
              Loại bản đồ
            </label>

            <select
              value={mapType}
              onChange={(e) => handleMapTypeChange(e.target.value)}
              className="form-select form-select-sm"
              style={{ fontSize: 13, width: "100%", marginBottom: 12 }}
            >
              <option value="satellite">🛰️ Vệ tinh</option>
              <option value="street">🗺️ Đường phố</option>
            </select>

            <button
              onClick={handleSendCHXD}
              style={{
                width: "100%",
                padding: "6px",
                fontSize: 13,
                fontWeight: "bold",
                borderRadius: 4,
                border: "none",
                background: "#2a5599",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Gửi tọa độ (ID: {CHXD_ID})
            </button>
          </div>
        )}

        <div id="map" style={{ height: "100vh", width: "100%" }}></div>
      </div>
    </>
  );
};

export default CHXDLocation;
