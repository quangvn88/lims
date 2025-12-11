import React from "react";
import Select from "react-select";

const FUEL_OPTIONS = [
  { value: "xang92", label: "Xăng 92", icon: process.env.PUBLIC_URL + "/icons/xang92.svg" },
  { value: "xang95", label: "Xăng 95", icon: process.env.PUBLIC_URL + "/icons/xang95.svg" },
  { value: "diezel", label: "Diesel", icon: process.env.PUBLIC_URL + "/icons/diesel.svg" }
];

export default function FuelSelect({ value, onChange }) {
  return (
    <Select
      value={FUEL_OPTIONS.find((x) => x.value === value)}
      onChange={(opt) => onChange(opt.value)}
      options={FUEL_OPTIONS}
      placeholder="Chọn loại nhiên liệu"
      formatOptionLabel={(item) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src={item.icon} width={20} height={20} alt="" />
          <span>{item.label}</span>
        </div>
      )}
      styles={{
        control: (base) => ({
          ...base,
          minHeight: 36,
          fontSize: 13,
        }),
        menu: (base) => ({
          ...base,
          fontSize: 13
        })
      }}
    />
  );
}
