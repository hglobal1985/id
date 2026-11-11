// Read-only derived info from the birthday (framework-free): zodiac sign and life path number.

const SIGNS: [number, number, string][] = [
  // [month, last day of the previous sign in this month, sign starting after that day]
  [1, 19, "水瓶座"],
  [2, 18, "雙魚座"],
  [3, 20, "牡羊座"],
  [4, 19, "金牛座"],
  [5, 20, "雙子座"],
  [6, 21, "巨蟹座"],
  [7, 22, "獅子座"],
  [8, 22, "處女座"],
  [9, 22, "天秤座"],
  [10, 23, "天蠍座"],
  [11, 22, "射手座"],
  [12, 21, "摩羯座"],
];

/** Western zodiac sign for a YYYY-MM-DD date, in Traditional Chinese. */
export function zodiacSign(date: string): string | null {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const entry = SIGNS[month - 1];
  if (!entry) return null;
  if (day > entry[1]) return entry[2];
  // Before the cut-off: the sign that started in the previous month.
  return (SIGNS[(month + 10) % 12] as [number, number, string])[2];
}

/** Life path number: digit sum of YYYYMMDD reduced to 1–9, keeping master numbers 11, 22 and 33. */
export function lifePathNumber(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  let n = [...date.replace(/-/g, "")].reduce((a, d) => a + Number(d), 0);
  while (n > 9 && n !== 11 && n !== 22 && n !== 33) n = [...String(n)].reduce((a, d) => a + Number(d), 0);
  return n;
}

// ---- Life number chart (same rules and drawing data as the starry.phd member center) ----

const digitSum = (n: number) => String(n).split("").reduce((sum, d) => sum + Number(d), 0);
const toDigit = (n: number): number => {
  let v = n;
  while (v >= 10) v = digitSum(v);
  return v;
};

export interface Rings {
  /** Black circles: how often the digit appears in the birth date (YYYYMMDD). */
  black: number;
  /** Yellow: the birthday number (day of month added down to one digit). */
  birthday: boolean;
  /** Purple: the zodiac number. */
  zodiac: boolean;
  /** Bright green circles: how often the digit appears in the talent numbers. */
  talent: number;
  /** Red triangle: the total life number (the final single digit). */
  life: boolean;
}

export interface LifeChart {
  zodiac_name: string;
  zodiac_number: number;
  birthday_number: number;
  talent_numbers: number[];
  life_number: number;
  /** Rings of the digits 0–9 (0 sits right of 9 on the bottom row; only the digits of the dates count for it). */
  rings: Record<number, Rings>;
  /** 主線: the straight lines (row, column or diagonal of the 3x3 grid) whose three numbers are all marked (a circle, or the 加總命數 triangle). The bottom row 3-6-9 reaches on to 0 (3-6-9-0) when 0 is marked too — 0 has only that one line. */
  lines: number[][];
  /** 副線: the short diagonals around the centre (2-4, 4-8, 8-6, 6-2) whose two numbers are both marked (a circle, or the 加總命數 triangle; drawn dashed). */
  sub_lines: [number, number][];
}

const GRID_LINES: readonly [number, number, number][] = [
  [1, 2, 3], [4, 5, 6], [7, 8, 9], [1, 4, 7], [2, 5, 8], [3, 6, 9], [1, 5, 9], [3, 5, 7],
];

const SUB_LINES: readonly [number, number][] = [[2, 4], [4, 8], [8, 6], [6, 2]];

const ZODIAC_ORDER = ["牡羊座", "金牛座", "雙子座", "巨蟹座", "獅子座", "處女座", "天秤座", "天蠍座", "射手座", "摩羯座", "水瓶座", "雙魚座"];

/** Taiwan-style life path numerology: add every digit of YYYYMMDD and keep reducing to one digit. */
export function lifeChartOf(birthday: string): LifeChart | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return null;
  const sign = zodiacSign(birthday);
  if (!sign) return null;
  const digits = birthday.replace(/-/g, "").split("").map(Number);
  let sum = digits.reduce((a, b) => a + b, 0);
  const talent: number[] = [];
  while (sum >= 10) {
    talent.push(sum);
    sum = digitSum(sum);
  }
  const zodiacNumber = toDigit(ZODIAC_ORDER.indexOf(sign) + 1);
  const birthdayNumber = toDigit(Number(birthday.slice(8, 10)));
  const rings: Record<number, Rings> = {};
  for (let d = 0; d <= 9; d++) rings[d] = { black: 0, birthday: d === birthdayNumber, zodiac: d === zodiacNumber, talent: 0, life: d === sum };
  for (const d of digits) (rings[d] as Rings).black += 1;
  for (const t of talent) for (const ch of String(t)) (rings[Number(ch)] as Rings).talent += 1;
  // A number is marked when it has a circle OR it is the 加總命數 (its red triangle): a number that only carries the triangle still joins the lines.
  const marked = (n: number) => { const r = rings[n] as Rings; return r.black > 0 || r.birthday || r.zodiac || r.talent > 0 || r.life; };
  const lines = GRID_LINES.filter((l) => l.every(marked)).map((l) => (l[0] === 3 && l[2] === 9 && marked(0) ? [3, 6, 9, 0] : [...l]));
  const sub_lines = SUB_LINES.filter((l) => l.every(marked)).map((l) => [...l] as [number, number]);
  return { zodiac_name: sign, zodiac_number: zodiacNumber, birthday_number: birthdayNumber, talent_numbers: talent, life_number: sum, rings, lines, sub_lines };
}
