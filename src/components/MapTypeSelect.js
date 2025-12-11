import Select from "react-select";

const MAP_TYPE_OPTIONS = [
  { value: "satellite", label: "🛰️ Vệ tinh" },
  { value: "street", label: "🗺️ Đường phố" },
];

export default function MapTypeSelect({ value, onChange }) {
  return (
    <Select
      value={MAP_TYPE_OPTIONS.find((opt) => opt.value === value)}
      onChange={(opt) => onChange(opt.value)}
      options={MAP_TYPE_OPTIONS}
      isSearchable={false}
      styles={{
        control: (base) => ({
          ...base,
          minHeight: 36,
          fontSize: 13,
        }),
        menu: (base) => ({ ...base, fontSize: 13 }),
      }}
    />
  );
}