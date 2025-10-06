import React from "react";
import { BASE_URL } from "../config"; 

const QRCodeImg = ({ data, width = 300 }) => {
  const url = `${BASE_URL}/api/generate-qrcode-logo?data=${encodeURIComponent(
    data
  )}&width=${width}`;

  return (
    <img
      src={url}
      alt="QR"
      style={{
        maxWidth: "100%",           
        height: "auto",     
        display: "block",
        margin: "auto"
      }}
    />
  );
};

export default QRCodeImg;
