import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import QRCodeImg from "./QRCodeImg";
import BarcodeImg from "./BarcodeImg";
import logoPetro from "../assets/logo_petro.png";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";

const YCTN = ({ width = 450 }) => {
  const [searchParams] = useSearchParams();
  const maMau = searchParams.get("maMau") || "0123456789";

  const [info, setInfo] = useState(null);

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const token = btoa(`${API_USER}:${API_PASSWORD}`);
        const res = await fetch(`${BASE_URL}${API}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${token}`,
          },
          body: JSON.stringify({
            FUNC: "ZFM_YCTN_INFO",
            DATA: {
              IT_SAMPID: [
                {
                  SIGN: "I",
                  OPTION: "EQ",
                  LOW: maMau,
                },
              ],
            },
          }),
        });

        const data = await res.json();
        if (data?.RESPONSE?.IT_DATA?.length > 0) {
          setInfo(data.RESPONSE.IT_DATA[0]);
        } else {
          setInfo(null);
        }
      } catch (err) {
        console.error("Lỗi gọi API:", err);
      }
    };
    fetchInfo();
  }, [maMau]);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: `${width}px`,
        margin: "auto",
        border: "2px solid black",
        fontFamily: "Arial, sans-serif",
        fontSize: "13px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px",
          borderBottom: "1px solid black",
        }}
      >
        <img
          src={logoPetro}
          alt="Logo"
          style={{ width: "60px", height: "60px", marginRight: "10px" }}
        />
        <div style={{ flex: 1, textAlign: "center", lineHeight: "1.4" }}>
          <div style={{ fontWeight: "bold" }}>TẬP ĐOÀN XĂNG DẦU VIỆT NAM</div>
          <div style={{ fontWeight: "bold" }}>CÔNG TY XĂNG DẦU B12</div>
        </div>
      </div>

      {/* Barcode */}
      <div style={{ textAlign: "center", padding: "10px 0" }}>
        <BarcodeImg data={maMau} />
      </div>

      {/* Info */}
      <div style={{ borderTop: "1px solid black", padding: "10px" }}>
        {!info ? (
          <p>Đang tải dữ liệu...</p>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              lineHeight: "1.5",
            }}
          >
            <tbody>
              {/* --- QR + MÃ MẪU + SỐ NIÊM + LOẠI HÀNG --- */}
              <tr>
                <td colSpan={2} style={{ position: "relative", paddingRight: "100px" }}>
                  {/* QR góc phải */}
                  <div style={{ position: "absolute", top: "0", right: "0" }}>
                    <QRCodeImg
                      data={`${BASE_URL}/app/yctn?maMau=${maMau}`}
                      width={90}
                    />
                  </div>

                  {/* Phần nội dung 3 dòng đầu */}
                  <div style={{ display: "table", width: "100%" }}>
                    <div style={{ display: "table-row" }}>
                      <div style={{ display: "table-cell", width: "160px" }}>
                        <b>MÃ MẪU</b>
                        <div style={{ fontSize: "11px" }}>Sample ID</div>
                      </div>
                      <div style={{ display: "table-cell" }}>
                        {maMau}
                      </div>
                    </div>

                    <div style={{ display: "table-row" }}>
                      <div style={{ display: "table-cell" }}>
                        <b>SỐ NIÊM</b>
                        <div style={{ fontSize: "11px" }}>Seal No</div>
                      </div>
                      <div style={{ display: "table-cell" }}>
                        {info?.SEAL_NO || "SEL01"}
                      </div>
                    </div>

                    <div style={{ display: "table-row" }}>
                      <div style={{ display: "table-cell" }}>
                        <b>LOẠI HÀNG</b>
                        <div style={{ fontSize: "11px" }}>Goods Type</div>
                      </div>
                      <div style={{ display: "table-cell" }}>
                        {info?.CARGO || "000000000000601002"}
                      </div>
                    </div>
                  </div>
                </td>
              </tr>

              {/* --- Các dòng thông tin khác --- */}
              {[
                ["VỊ TRÍ LẤY MẪU", "Sampling Collected Location", info?.VTLM_T || "Mẫu đáy"],
                ["NƠI XUẤT", "Place of Release", info?.NOI_XUAT || "-"],
                ["NƠI LẤY", "Sampling Location", info?.SAMPLING_LOCATION || "Bể chứa"],
                ["NGÀY/GIỜ LẤY", "Sampling Date Time", info?.ISSUE_DATE || "26/09/2025 10:34 AM"],
                ["NGÀY HẾT HẠN LƯU", "Sample Retention Expiry Date", info?.SAMPLE_EXP || "26/10/2025"],
                ["NGƯỜI LẤY", "Sampler", info?.TAKEN_BY || "Nguyễn Văn An"],
                ["NGƯỜI NHẬN", "Receiver", info?.RECEIVER || "Nguyễn Thị Lan Hương"],
              ].map(([label, sub, value], idx) => (
                <tr key={idx}>
                  <td style={{ width: "160px", verticalAlign: "top" }}>
                    <b>{label}</b>
                    <div style={{ fontSize: "11px" }}>{sub}</div>
                  </td>
                  <td style={{ verticalAlign: "top" }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default YCTN;
