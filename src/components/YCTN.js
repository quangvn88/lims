import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import QRCodeImg from "./QRCodeImg";
import BarcodeImg from "./BarcodeImg";
import logoPetro from "../assets/logo_petro.png";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";


const YCTN = ({ width = 600 }) => {
  const [searchParams] = useSearchParams();
  const maMau = searchParams.get("maMau") || "DEFAULT_CODE";

  const [info, setInfo] = useState(null);

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const token = btoa(`${API_USER}:${API_PASSWORD}`);

        const res = await fetch(`${BASE_URL}${API}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Basic ${token}`
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
        console.log("Dữ liệu nhận được:", data);
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
    <div style={{ width: "100%", maxWidth: `${width}px`, margin: "auto" }}>
      <table
        style={{
          width: "100%",
          border: "1px solid black",
          fontSize: "12px",
          borderCollapse: "collapse",
          padding: "10px",        
          boxSizing: "border-box"
        }}
      >
        <tbody>
          {/* Header */}
          <tr>
            <td style={{ width: "30%", textAlign: "center", padding: "10px" }}>
              <img
                src={logoPetro}
                alt="Logo"
                style={{ maxWidth: "100px", height: "auto" }}
              />
            </td>
            <td style={{ width: "70%", textAlign: "center", fontWeight: "bold" }}>
              <div style={{ fontSize: "20px" }}>
                TẬP ĐOÀN XĂNG DẦU VIỆT NAM
              </div>
              <span style={{ fontWeight: "normal", fontSize: "16px" }}>
                VPCT Petrolimex Sài Gòn
              </span>
            </td>
          </tr>

          {/* QR + Barcode (2 cột căn giữa, bảng lồng nhau) */}
          <tr>
            <td colSpan={2} style={{ textAlign: "center", padding: "10px 0" }}>
              <table style={{ width: "100%" }}>
                <tbody>
                  <tr>
                    <td style={{ width: "50%", textAlign: "center", verticalAlign: "middle" }}>
                      <QRCodeImg 
                        data={`${BASE_URL}/lims/view?maMau=${maMau}`}
                        width={100} />
                    </td>
                    <td style={{ width: "50%", textAlign: "center", verticalAlign: "middle" }}>
                      <BarcodeImg data={maMau} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>

          {/* Thông tin khác */}
          <tr>
            <td colSpan={2} style={{ padding: "10px" }}>
              {!info ? (
                <p>Đang tải dữ liệu...</p>
              ) : (
                <>
                  <p><b>MÃ MẪU:</b> {maMau} <br /><i>(CODE)</i></p>
                  <p><b>LOẠI HÀNG:</b> {info?.CARGO || "—"} <br /><i>Good Type</i></p>
                  <p><b>SỐ NIÊM:</b> {info?.SEAL_NO || "—"} <br /><i>Seal No.</i></p>
                  <p><b>VỊ TRÍ LẤY MẪU:</b> {info?.VTLM_T || "—"} <br /><i>Sampling Collected Location</i></p>
                  <p><b>NƠI XUẤT:</b> {info?.NOI_XUAT || "—"} <br /><i>Place of Release</i></p>
                  <p><b>NƠI LẤY:</b> {info?.SAMPLING_LOCATION || "—"} <br /><i>Sampling Location</i></p>
                  <p><b>NGÀY LẤY – GIỜ:</b> {info?.ISSUE_DATE || "—"} <br /><i>Sampling Date – Time</i></p>
                  <p><b>NGÀY HẾT HẠN LƯU:</b> {info?.SAMPLE_EXP || "—"} <br /><i>Retention Expiry</i></p>
                  <p><b>NGƯỜI LẤY:</b> {info?.TAKEN_BY || "—"} <br /><i>Sampler</i></p>
                  <p><b>SỐ LƯỢNG - ĐVT:</b> {info?.MENGE_LM ? `${info.MENGE_LM} (${info?.MEINS || ""})` : "—"} <br /><i>Quantity - Unit</i></p>
                </>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default YCTN;
