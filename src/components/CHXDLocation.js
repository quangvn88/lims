import React, { useEffect, useState, useRef } from "react";
import { useParams, useLocation } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";
import { resizeImageToBase64 } from "../utils/imageUtils";

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

  const [selectedImage, setSelectedImage] = useState(null);
  const [previewImg, setPreviewImg] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [base64Image, setBase64Image] = useState(null);

  const location = useLocation();

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      if (!file) return reject("No file provided");

      const reader = new FileReader();

      // Browser tự convert file thành base64 cực nhanh
      reader.readAsDataURL(file);

      reader.onload = () => {
        try {
          // Trả về base64 thuần, không có prefix
          const base64 = reader.result.split(",")[1];
          resolve(base64);
        } catch (err) {
          reject(err);
        }
      };

      reader.onerror = () => reject("Failed to read file");
    });


  const chunkString = (str, size) => {
    const chunks = [];
    for (let i = 0; i < str.length; i += size) {
      chunks.push({ MIME: str.substring(i, i + size) });
    }
    return chunks;
  };


  const showAlert = (msg, type = "success") => {
    setAlertMsg(msg);
    setAlertType(type);
    setTimeout(() => setAlertMsg(""), 3000);
  };

  // Fetch CHXD info
  const fetchCHXDInfo = async () => {
    if (!CHXD_ID) return;
    try {
      const token = btoa(`${API_USER}:${API_PASSWORD}`);
      const body = { FUNC: "ZFM_CHXD_GMAP", DATA: { I_CHXD_ID: CHXD_ID } };

      const res = await fetch(`${BASE_URL}${API}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${token}` },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      const tData = data?.RESPONSE?.T_DATA;

      const info =
        tData?.length > 0
          ? {
              id: tData[0].CHXD_ID,
              title: tData[0].CHXD_T,
              address: tData[0].ADDRESS,
              chxd_type: tData[0].CHXD_TYPE,
              logo: tData[0].LOGO
            }
          : {
              id: CHXD_ID,
              title: "Không tồn tại",
              address: "Không có địa chỉ",
              chxd_type: "",
              logo: ""
            };

      setChxdData(info);

      /*** 👇 LẤY ẢNH BASE64 TRẢ VỀ TỪ SAP 👇 ***/
      const imgBase64 = tData[0].BASE64;
      const mime = "image/jpeg";

      if (imgBase64) {
        const fullImg = `data:${mime};base64,${imgBase64}`;
        setPreviewImg(fullImg);      // hiển thị lên bản đồ
        setBase64Image(imgBase64);   // gán lại base64 để gửi lên nếu cần
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCHXDInfo();
  }, [CHXD_ID]);

  // Init map
  useEffect(() => {
    if (mapRef.current) return;

    const map = L.map("map", { center: [10.76, 106.66], zoom: 13 });
    mapRef.current = map;

    tileLayerRef.current = createTileLayer(mapType);
    tileLayerRef.current.addTo(map);

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setCurrentPos({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }),
      (err) => console.error(err),
      { enableHighAccuracy: true }
    );
  }, []);

  // Create marker (rebuild when GPS, CHXD, or image changes)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !currentPos || !chxdData) return;

    console.log(chxdData.CHXD_TYPE);

    const { lat, lng } = currentPos;    

    let logoSrc = process.env.PUBLIC_URL + "/logo_default.png";
    switch (chxdData.logo) {
      case "PLX":
        logoSrc = process.env.PUBLIC_URL + "/logo_plx.png";
        break;
      case "TNNQ":
        logoSrc = process.env.PUBLIC_URL + "/logo_tnnq.jpg";
        break;
      case "DT":
        logoSrc = process.env.PUBLIC_URL + "/logo_doithu.jpg";
        break;
      default:
        logoSrc = process.env.PUBLIC_URL + "/logo_default.png";
        break;
    }    
    console.log(logoSrc);

    const labelHTML = `
      <div class="pulse-label" style="display:flex; flex-direction:column; max-width:230px;white-space: normal; word-break: break-word; overflow-wrap: break-word;">
        <div style="display:flex; flex-direction:row; margin-bottom:6px;">
          <img src="${logoSrc}" style="height:32px; margin-right:6px;" />
          <div style="display:flex; flex-direction:column;">
            <span style="font-size:12px; font-weight:bold;">
              ${chxdData.id} - ${chxdData.title}
            </span>
            <span style="font-size:10px;">${chxdData.address}</span>
            <span style="font-size:10px;">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
          </div>
        </div>

        ${
          previewImg
            ? `
          <img src="${previewImg}" 
               style="width:210px; border-radius:6px; 
               box-shadow:0 2px 6px rgba(0,0,0,0.25);" />
        `
            : ""
        }
      </div>
    `;

    // Remove old markers
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker) map.removeLayer(layer);
    });

    const labelIcon = L.divIcon({
      html: labelHTML,
      className: "",
      iconSize: [230, "auto"],
      iconAnchor: [115, 60],
    });

    L.marker([lat, lng], { icon: labelIcon }).addTo(map);
    map.setView([lat, lng], 18, { animate: true });
  }, [currentPos, chxdData, previewImg]);

  const handleSendCHXD = async () => {
    if (!currentPos) return showAlert("Chưa có GPS!", "danger");
    if (!base64Image) return showAlert("Ảnh chưa convert xong!", "danger");

    try {
      setIsSending(true); // Bắt đầu gửi, disable button

      const token = btoa(`${API_USER}:${API_PASSWORD}`);
      console.log("SENDING:", { CHXD_ID, currentPos, base64Image });
      const chunks = chunkString(base64Image, 5000);

      const body = {
        FUNC: "ZFM_CHXD_LOCATION",
        DATA: {
          I_CHXD_GMAP: {
            CHXD_ID,
            ZLAT: currentPos?.lat.toString(),
            ZLONG: currentPos?.lng.toString(),
          },
          T_BASE64: chunks,
        },
      };

      const response = await fetch(`${BASE_URL}${API}`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return showAlert("Gửi thất bại!", "danger");
      }

      const result = await response.json();
      showAlert("Gửi thành công!", "success");

      console.log("RESULT:", result);

    } catch (error) {
      console.error("ERROR:", error);
      showAlert("Có lỗi xảy ra!", "danger");
    } finally {
      setIsSending(false); // Kết thúc gửi
    }
  };


  const createTileLayer = (type) => {
    const url =
      type === "street"
        ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
    return L.tileLayer(url, { maxZoom: 18 });
  };

  const handleMapTypeChange = (type) => {
    const map = mapRef.current;
    setMapType(type);

    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    tileLayerRef.current = createTileLayer(type).addTo(map);
  };

  const handleSelectImage = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setSelectedImage(file);
    setPreviewImg(URL.createObjectURL(file));

    try {
      const base64 = await resizeImageToBase64(file, 1024, 1024, 0.7);
      setBase64Image(base64);
    } catch (err) {
      showAlert("Resize/convert thất bại: " + err, "danger");
    }
  };

  return (
    <>
      {alertMsg && (
        <div className="top-center-alert-wrapper show">
          <div className={`alert alert-${alertType} top-center-alert`}>{alertMsg}</div>
        </div>
      )}

      <div style={{ height: "100vh", position: "relative" }}>

        {/* Floating menu button */}
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
            background: "#2a5599",
            color: "#fff",
            border: "none",
            display: showControls ? "none" : "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
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
              width: 200,
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowControls(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: 18,
                  cursor: "pointer",
                }}
              >
                ✖
              </button>
            </div>

            {/* Map type */}
            <label style={{ fontSize: 13, fontWeight: "bold" }}>Loại bản đồ</label>
            <select
              className="form-select form-select-sm"
              value={mapType}
              onChange={(e) => handleMapTypeChange(e.target.value)}
              style={{ marginBottom: 10 }}
            >
              <option value="satellite">🛰️ Vệ tinh</option>
              <option value="street">🗺️ Đường phố</option>
            </select>

            {/* Select Image */}
            <label
              htmlFor="imageUpload"
              style={{
                width: "100%",
                padding: "8px",
                background: "#2a5599",
                color: "#fff",
                borderRadius: 6,
                textAlign: "center",
                fontWeight: "bold",
                fontSize: 13,
                cursor: "pointer",
                marginBottom: 10,
              }}
            >
              📸 Chọn ảnh
            </label>

            <input
              id="imageUpload"
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleSelectImage}
            />

            {selectedImage && (
              <div style={{ fontSize: 12, color: "#444", marginBottom: 8 }}>
                Đã chọn: <b>{selectedImage.name}</b>
              </div>
            )}

            {/* Button send */}
            <button
              onClick={handleSendCHXD}
              disabled={isSending} // Disable khi đang gửi
              style={{
                width: "100%",
                padding: 8,
                background: isSending ? "#999" : "#2a5599",
                color: "white",
                borderRadius: 6,
                border: "none",
                fontWeight: "bold",
                cursor: isSending ? "not-allowed" : "pointer",
                fontSize: 13,
              }}
            >
              {isSending ? "⏳ Đang gửi..." : `Gửi tọa độ (ID: ${CHXD_ID})`}
            </button>
          </div>
        )}

        <div id="map" style={{ height: "100vh", width: "100%" }}></div>
      </div>
    </>
  );
};

export default CHXDLocation;
