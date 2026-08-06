// Áp mã định dạng số của Excel (numFmt) vào giá trị ô.
//
// LÝ DO CẦN MODULE NÀY: ExcelJS chỉ trả về GIÁ TRỊ THÔ (cell.value) và MÃ định dạng
// (cell.numFmt) chứ không tự render. `cell.text` cũng chỉ là String(value) cho số,
// nên lưới sẽ hiện "23885155" / "0.7412" thay vì "23,885,155" / "74%" như file gốc.
//
// API:
//   formatCellValue(value, numFmt) -> { text, color }
//     value : number | string | Date | null | { error } | { richText } | { formula, result }
//     numFmt: chuỗi mã ("#,##0", "0.00%", "dd/mm/yyyy") | số (id built-in) | { formatCode }
//     color : mã màu do khai báo [Red]/[Blue]... trong mã định dạng (null nếu không có)
//
// Hỗ trợ: 4 vùng dương;âm;không;text, [Red]/[Color n], điều kiện [>=100],
// nhóm nghìn, thu tỉ lệ bằng dấu phẩy cuối ("#,##0,," = triệu), phần trăm,
// khoa học (0.00E+00), ngày/giờ (kể cả [h] giờ luỹ kế), literal "..."/\x/_x/*x, @.

// Mã định dạng có sẵn của Excel — file .xlsx chỉ ghi numFmtId, không ghi formatCode.
// ExcelJS phần lớn đã tự map, nhưng dxf của conditional formatting thì trả { id } trơn.
const BUILTIN = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "mm/dd/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yy h:mm",
  37: "#,##0_);(#,##0)",
  38: "#,##0_);[Red](#,##0)",
  39: "#,##0.00_);(#,##0.00)",
  40: "#,##0.00_);[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mm:ss.0",
  48: "##0.0E+0",
  49: "@",
};

const COLORS = {
  black: "#000000",
  blue: "#0000ff",
  cyan: "#00ffff",
  green: "#008000",
  magenta: "#ff00ff",
  red: "#ff0000",
  white: "#ffffff",
  yellow: "#ffff00",
};
// [Color1]..[Color56] — chỉ số theo bảng màu chỉ mục cũ của Excel; lấy 8 màu đầu.
const INDEXED = [
  "#000000",
  "#ffffff",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ffff00",
  "#ff00ff",
  "#00ffff",
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** numFmt của ExcelJS: chuỗi | số (id) | { formatCode } | { id } -> chuỗi mã. */
export function numFmtCode(numFmt) {
  if (numFmt == null) return "";
  if (typeof numFmt === "number") return BUILTIN[numFmt] || "";
  if (typeof numFmt === "object") {
    if (numFmt.formatCode) return String(numFmt.formatCode);
    if (numFmt.id != null) return BUILTIN[numFmt.id] || "";
    return "";
  }
  // Chuỗi luôn là MÃ định dạng, không phải id: "00" là mã (5 -> "05"), không phải id 0.
  return String(numFmt);
}

/** Cắt mã theo dấu ';' nhưng bỏ qua dấu ';' nằm trong "..." , [...] hoặc sau '\'. */
function splitSections(code) {
  const out = [];
  let cur = "";
  let q = false;
  let br = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === "\\") {
      cur += ch + (code[i + 1] || "");
      i++;
      continue;
    }
    if (ch === '"') {
      q = !q;
      cur += ch;
      continue;
    }
    if (!q && ch === "[") br++;
    if (!q && ch === "]") br--;
    if (ch === ";" && !q && br === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Tách [Red] / [>=100] / [$-409] ra khỏi phần thân mã. */
function parseSection(sec) {
  let color = null;
  let cond = null;
  const body = sec.replace(/\[([^\]]*)\]/g, (m, inner) => {
    const low = inner.toLowerCase();
    if (COLORS[low]) {
      color = COLORS[low];
      return "";
    }
    const cm = low.match(/^color\s*(\d+)$/);
    if (cm) {
      color = INDEXED[(+cm[1] - 1) % INDEXED.length] || null;
      return "";
    }
    const op = inner.match(/^(<=|>=|<>|=|<|>)\s*(-?[\d.]+)$/);
    if (op) {
      cond = { op: op[1], v: +op[2] };
      return "";
    }
    if (low.startsWith("$") || low.startsWith("-")) return ""; // [$-409] locale
    return m; // [h] [m] [s] giữ lại cho phần ngày/giờ
  });
  return { color, cond, body };
}

/** Bỏ literal/bracket để kiểm tra mã có phải ngày-giờ. */
function stripLiterals(body) {
  return body
    .replace(/\\./g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/_./g, "")
    .replace(/\*./g, "")
    .replace(/AM\/PM|A\/P/gi, "");
}

function isDateCode(body) {
  const s = stripLiterals(body);
  // Giờ luỹ kế [h]/[m]/[s] đã bị stripLiterals bỏ -> kiểm tra riêng trên body gốc.
  if (/\[(h+|m+|s+)\]/i.test(body)) return true;
  return /[ymdhs]/i.test(s) && !/[#?]/.test(s);
}

function testCond(cond, v) {
  switch (cond.op) {
    case ">":
      return v > cond.v;
    case "<":
      return v < cond.v;
    case ">=":
      return v >= cond.v;
    case "<=":
      return v <= cond.v;
    case "=":
      return v === cond.v;
    case "<>":
      return v !== cond.v;
    default:
      return false;
  }
}

// ---------------------------------------------------------------- số ----------

/** Tách thân mã thành: literal đầu, chuỗi placeholder số, literal cuối. */
function tokenizeNumber(body) {
  const toks = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\") {
      toks.push({ t: "lit", v: body[i + 1] || "" });
      i++;
    } else if (ch === '"') {
      const end = body.indexOf('"', i + 1);
      toks.push({ t: "lit", v: body.slice(i + 1, end < 0 ? body.length : end) });
      i = end < 0 ? body.length : end;
    } else if (ch === "_") {
      toks.push({ t: "lit", v: "" }); // chỗ trống bằng bề rộng ký tự -> bỏ
      i++;
    } else if (ch === "*") {
      i++; // ký tự lấp đầy -> bỏ
    } else if (ch === "%") {
      toks.push({ t: "pct" });
    } else if ("0#?.,".includes(ch)) {
      toks.push({ t: "num", v: ch });
    } else if (/[eE]/.test(ch) && /[+-]/.test(body[i + 1] || "")) {
      toks.push({ t: "exp", v: body[i + 1] });
      i++;
    } else {
      toks.push({ t: "lit", v: ch });
    }
  }
  return toks;
}

/** Chèn dấu phân nhóm nghìn vào chuỗi chữ số. */
function group(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatNumberBody(value, body) {
  const toks = tokenizeNumber(body);
  const numIdx = toks
    .map((t, i) => (t.t === "num" ? i : -1))
    .filter((i) => i >= 0);

  // Không có placeholder số -> mã chỉ gồm literal, in nguyên literal.
  if (!numIdx.length) {
    return toks.map((t) => (t.t === "pct" ? "%" : t.v || "")).join("");
  }

  const expAt = toks.findIndex((t) => t.t === "exp");
  const first = numIdx[0];
  // Với mã khoa học ("0.00E+00"), phần định trị chỉ tính các chữ số TRƯỚC "E".
  const last =
    expAt >= 0
      ? numIdx.filter((i) => i < expAt).pop() ?? first
      : numIdx[numIdx.length - 1];
  const digits = toks.slice(first, last + 1).filter((t) => t.t === "num");

  let scale = 1;
  if (toks.some((t) => t.t === "pct")) {
    scale = Math.pow(100, toks.filter((t) => t.t === "pct").length);
  }

  // Dấu phẩy đứng sau placeholder chữ số cuối cùng = thu tỉ lệ nghìn.
  let trailingCommas = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i].v === ",") trailingCommas++;
    else break;
  }
  const core = trailingCommas ? digits.slice(0, -trailingCommas) : digits;
  scale /= Math.pow(1000, trailingCommas);

  const dot = core.findIndex((t) => t.v === ".");
  const intToks = (dot < 0 ? core : core.slice(0, dot)).filter((t) =>
    "0#?".includes(t.v)
  );
  const decToks = (dot < 0 ? [] : core.slice(dot + 1)).filter((t) =>
    "0#?".includes(t.v)
  );
  const useGroup = (dot < 0 ? core : core.slice(0, dot)).some(
    (t) => t.v === ","
  );

  const expTok = toks.find((t) => t.t === "exp");
  let numStr;
  if (expTok) {
    const dec = decToks.length;
    numStr = Math.abs(value * scale).toExponential(dec);
    // toExponential -> "1.23e+4"; Excel viết "1.23E+04" (mũ tối thiểu 2 chữ số).
    numStr = numStr.replace(/e([+-])(\d+)/i, (m, sg, d) => {
      const sign = expTok.v === "-" && sg === "+" ? "" : sg;
      return "E" + sign + d.padStart(2, "0");
    });
  } else {
    const n = Math.abs(value * scale);
    const dec = decToks.length;
    const fixed = n.toFixed(dec);
    let [ip, dp = ""] = fixed.split(".");

    // Đủ số 0 bắt buộc ở phần nguyên (mã "00" + 5 -> "05"). "#" không bắt buộc.
    const minInt = intToks.filter((t) => t.v === "0").length;
    if (ip === "0" && minInt === 0) ip = ""; // mã "#.##" + 0.5 -> ".5"
    while (ip.length < minInt) ip = "0" + ip;
    if (useGroup) ip = group(ip);

    // Phần thập phân: "0" giữ số 0 cuối, "#"/"?" thì bỏ số 0 cuối.
    if (dp) {
      let keep = dp.length;
      while (keep > 0 && dp[keep - 1] === "0" && decToks[keep - 1] && decToks[keep - 1].v !== "0")
        keep--;
      dp = dp.slice(0, keep);
    }
    numStr = dp ? ip + "." + dp : ip;
  }

  const pre = toks
    .slice(0, first)
    .map((t) => (t.t === "pct" ? "%" : t.v || ""))
    .join("");
  // numStr đã chứa cả "E+04" nên literal sau nó phải bỏ qua hết token của số mũ.
  const postFrom = expAt >= 0 ? numIdx[numIdx.length - 1] + 1 : last + 1;
  const post = toks
    .slice(postFrom)
    .map((t) => (t.t === "pct" ? "%" : t.v || ""))
    .join("");
  return pre + numStr + post;
}

// -------------------------------------------------------------- ngày ----------

/** Serial ngày của Excel -> Date (UTC). Mốc 1899-12-30 để bù lỗi năm nhuận 1900. */
export function serialToDate(serial) {
  const ms = Math.round(serial * 86400000);
  return new Date(Date.UTC(1899, 11, 30) + ms);
}

function formatDateBody(dateOrSerial, body) {
  const d =
    dateOrSerial instanceof Date ? dateOrSerial : serialToDate(dateOrSerial);
  const serial =
    dateOrSerial instanceof Date
      ? (dateOrSerial.getTime() - Date.UTC(1899, 11, 30)) / 86400000
      : dateOrSerial;

  const Y = d.getUTCFullYear();
  const M = d.getUTCMonth() + 1;
  const D = d.getUTCDate();
  const h24 = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const se = d.getUTCSeconds();
  const dow = d.getUTCDay();

  const has12h = /AM\/PM|A\/P/i.test(body);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const p2 = (n) => String(n).padStart(2, "0");

  let out = "";
  let i = 0;
  // "m" là THÁNG hay PHÚT: là phút nếu token liền trước là giờ, hoặc liền sau là giây.
  let prevWasHour = false;

  while (i < body.length) {
    const rest = body.slice(i);
    let m;

    if (body[i] === "\\") {
      out += body[i + 1] || "";
      i += 2;
      continue;
    }
    if (body[i] === '"') {
      const end = body.indexOf('"', i + 1);
      out += body.slice(i + 1, end < 0 ? body.length : end);
      i = end < 0 ? body.length : end + 1;
      continue;
    }
    if (body[i] === "_") {
      i += 2;
      continue;
    }
    if (body[i] === "*") {
      i += 2;
      continue;
    }
    if ((m = rest.match(/^AM\/PM/i))) {
      out += h24 < 12 ? "AM" : "PM";
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^A\/P/i))) {
      out += h24 < 12 ? "A" : "P";
      i += m[0].length;
      continue;
    }
    // Giờ/phút/giây luỹ kế: [h] = tổng số giờ, không quay vòng 24h.
    if ((m = rest.match(/^\[(h+|m+|s+)\]/i))) {
      const kind = m[1][0].toLowerCase();
      const total =
        kind === "h"
          ? Math.floor(serial * 24)
          : kind === "m"
            ? Math.floor(serial * 1440)
            : Math.floor(serial * 86400);
      out += m[1].length > 1 ? p2(total) : String(total);
      i += m[0].length;
      // "[h]:mm" -> mm là PHÚT, không phải tháng.
      prevWasHour = kind === "h";
      continue;
    }
    if ((m = rest.match(/^y{3,4}/i))) {
      out += String(Y);
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^y{1,2}/i))) {
      out += p2(Y % 100);
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^d{4,}/i))) {
      out += DAYS[dow];
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^d{3}/i))) {
      out += DAYS[dow].slice(0, 3);
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^d{2}/i))) {
      out += p2(D);
      i += m[0].length;
      prevWasHour = false;
      continue;
    }
    if ((m = rest.match(/^d/i))) {
      out += String(D);
      i += m[0].length;
      prevWasHour = false;
      continue;
    }
    if ((m = rest.match(/^h{2,}/i))) {
      out += p2(has12h ? h12 : h24);
      i += m[0].length;
      prevWasHour = true;
      continue;
    }
    if ((m = rest.match(/^h/i))) {
      out += String(has12h ? h12 : h24);
      i += m[0].length;
      prevWasHour = true;
      continue;
    }
    if ((m = rest.match(/^s{2,}/i))) {
      out += p2(se);
      i += m[0].length;
      prevWasHour = false;
      continue;
    }
    if ((m = rest.match(/^s/i))) {
      out += String(se);
      i += m[0].length;
      prevWasHour = false;
      continue;
    }
    if ((m = rest.match(/^m{5,}/i))) {
      out += MONTHS[M - 1][0];
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^m{4}/i))) {
      out += MONTHS[M - 1];
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^m{3}/i))) {
      out += MONTHS[M - 1].slice(0, 3);
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^m{1,2}/i))) {
      const afterIsSecond = /^[^a-z0-9]*s/i.test(body.slice(i + m[0].length));
      const asMinute = prevWasHour || afterIsSecond;
      const v = asMinute ? mi : M;
      out += m[0].length > 1 ? p2(v) : String(v);
      i += m[0].length;
      prevWasHour = false;
      continue;
    }
    // .0 / .00 sau giây = phần lẻ của giây
    if ((m = rest.match(/^\.0+/))) {
      const digits = m[0].length - 1;
      const frac = Math.abs(serial * 86400) % 1;
      out += "." + String(Math.round(frac * Math.pow(10, digits))).padStart(digits, "0");
      i += m[0].length;
      continue;
    }
    out += body[i];
    i++;
  }
  return out;
}

// ------------------------------------------------------------- công khai ------

/** Trích giá trị "thật" của ô ExcelJS: công thức -> result, lỗi -> mã lỗi. */
export function cellRawValue(value) {
  let v = value;
  if (v && typeof v === "object") {
    if (v.error) return { error: String(v.error) };
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (v.formula !== undefined || v.sharedFormula !== undefined) {
      const r = v.result;
      if (r && typeof r === "object" && r.error) return { error: String(r.error) };
      return r === undefined || r === null ? "" : r;
    }
    if (v.text !== undefined) return v.text; // hyperlink
    if (v instanceof Date) return v;
    if (v.result !== undefined) return v.result;
    return "";
  }
  return v;
}

/**
 * Định dạng giá trị ô theo mã numFmt.
 * @returns {{ text: string, color: (string|null) }}
 */
export function formatCellValue(value, numFmt) {
  const raw = cellRawValue(value);

  if (raw && typeof raw === "object" && raw.error) {
    return { text: raw.error, color: null }; // #DIV/0!, #REF!, #N/A...
  }
  if (raw === null || raw === undefined || raw === "") {
    return { text: "", color: null };
  }

  const code = numFmtCode(numFmt);
  const isNum = typeof raw === "number";
  const isDate = raw instanceof Date;

  // Không có mã / General -> hiển thị mặc định.
  if (!code || /^general$/i.test(code.trim())) {
    if (isDate) return { text: formatDateBody(raw, "mm/dd/yyyy"), color: null };
    if (isNum) return { text: generalNumber(raw), color: null };
    return { text: String(raw), color: null };
  }

  const sections = splitSections(code).map(parseSection);

  /* eslint-disable-next-line no-use-before-define */
  // Chuỗi: dùng vùng thứ 4 nếu có.
  if (!isNum && !isDate) {
    const sec = sections.length >= 4 ? sections[3] : null;
    if (!sec) return { text: String(raw), color: null };
    return { text: applyTextSection(sec.body, String(raw)), color: sec.color };
  }

  const num = isDate ? raw : raw;

  // Vùng có điều kiện [>=100] được xét trước theo thứ tự khai báo.
  const conds = sections.filter((s) => s.cond);
  if (conds.length && isNum) {
    for (const s of conds) if (testCond(s.cond, num)) return render(num, s);
    const fallback = sections.find((s) => !s.cond);
    if (fallback) return render(num, fallback);
    return render(num, sections[0]);
  }

  // Không điều kiện: dương;âm;không;text
  let sec;
  if (isDate) sec = sections[0];
  else if (num > 0) sec = sections[0];
  else if (num < 0) sec = sections[1] || sections[0];
  else sec = sections[2] || sections[0];

  if (!sec) return { text: String(raw), color: null };
  // Vùng rỗng ("0;;" cho số 0) = Excel để trống ô.
  if (!sec.body.trim()) return { text: "", color: sec.color };

  // Có vùng riêng cho số âm -> mã đã tự lo dấu (ngoặc/màu), không thêm "-".
  const hasNegSection = !isDate && num < 0 && !!sections[1];
  return render(isDate ? raw : num, sec, hasNegSection);
}

/**
 * Áp VÙNG ĐỊNH DẠNG CHUỖI (vùng thứ 4 của mã numFmt) lên nội dung chữ của ô.
 * Phải bóc đủ token của Excel chứ không chỉ thay "@":
 *   _x        chừa chỗ rộng đúng bằng ký tự x -> BỎ (giống nhánh số và ngày)
 *   *x        ký tự lấp đầy                   -> BỎ
 *   \x, "..." literal                         -> in ra x / nội dung trong nháy
 *   @         nội dung ô
 *   còn lại   in nguyên văn
 * Bẫy đã gặp (file THULAO_TH, ô C9:F9): mã kế toán
 *   _(* #,##0_);_(* \(#,##0\);_(* "-"??_);_(@_)
 * áp lên ô CHỮ. Nếu chỉ `replace(/@/g, raw)` thì "_(" và "_)" lọt ra ngoài,
 * hiện thành "_(E10 RON 95-III_)" thay vì "E10 RON 95-III".
 */
function applyTextSection(body, raw) {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\") {
      out += body[i + 1] || "";
      i++;
    } else if (ch === '"') {
      const end = body.indexOf('"', i + 1);
      out += body.slice(i + 1, end < 0 ? body.length : end);
      i = end < 0 ? body.length : end;
    } else if (ch === "_" || ch === "*") {
      i++; // bỏ cả ký tự đi kèm ngay sau
    } else if (ch === "@") {
      out += raw;
    } else {
      out += ch;
    }
  }
  return out;
}

function render(v, sec, hasNegSection) {
  if (isDateCode(sec.body)) {
    return { text: formatDateBody(v, sec.body), color: sec.color };
  }
  const body = formatNumberBody(v, sec.body);
  const neg = typeof v === "number" && v < 0 && !hasNegSection;
  return { text: (neg ? "-" : "") + body, color: sec.color };
}

/** Excel "General": tối đa ~11 ký tự, không nhóm nghìn, bỏ số 0 thừa. */
function generalNumber(n) {
  if (!isFinite(n)) return String(n);
  if (Number.isInteger(n) && Math.abs(n) < 1e11) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-4)) {
    return n.toExponential(5).replace(/e([+-])(\d+)/, (m, s, d) => "E" + s + d.padStart(2, "0"));
  }
  // Giữ tối đa 10 chữ số có nghĩa rồi bỏ số 0 cuối.
  return String(parseFloat(n.toPrecision(10)));
}

export default formatCellValue;