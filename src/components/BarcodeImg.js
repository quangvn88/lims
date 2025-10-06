import React from "react";
import { BASE_URL } from "../config"; 

const BarcodeImg = ({ data, width = 20, height = 5 }) => {
  const url = `${BASE_URL}/api/generate-barcode?data=${encodeURIComponent(
    data
  )}&width=${width}&height=${height}`;

  return (
    <img
      src={url}
      alt="Barcode"
    />
  );
};

export default BarcodeImg;
