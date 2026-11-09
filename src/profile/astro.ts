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
