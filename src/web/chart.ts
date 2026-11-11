// Server-rendered life number chart for the public profile page (same drawing data as the edit page).
import type { LifeChart, Rings } from "../profile/astro";

const ROWS: readonly (readonly number[])[] = [
  [1, 4, 7],
  [2, 5, 8],
  [3, 6, 9],
];

function cell(n: number, r: Rings): string {
  const rings: string[] = [
    ...Array.from({ length: r.black }, () => "rg-black"),
    ...(r.birthday ? ["rg-birthday"] : []),
    ...(r.zodiac ? ["rg-zodiac"] : []),
    ...Array.from({ length: r.talent }, () => "rg-talent"),
  ];
  if (!rings.length && !r.life) return `<div class="ln-cell ln-empty"><span class="ln-n">${n}</span></div>`;
  // From the inside out: the number, the red triangle (innermost), then the circles.
  let inner = `<span class="ln-n${rings.length ? "" : " ln-red"}">${n}</span>`;
  if (r.life) inner = `<span class="ln-tri"><svg viewBox="0 0 100 90" preserveAspectRatio="none" aria-hidden="true"><polygon points="50,5 96,85 4,85" fill="none" stroke="#e5303a" stroke-width="5" stroke-linejoin="round"/></svg>${inner}</span>`;
  rings.forEach((c, i) => { inner = `<span class="ln-ring ${c}${i === 0 && r.life ? " ln-ring-t" : ""}">${inner}</span>`; });
  return `<div class="ln-cell">${inner}</div>`;
}

/** Blue lines between the centres of the numbers (3x3 unit space; the stroke keeps its pixel width). */
function lineLayer(lines: readonly (readonly number[])[]): string {
  const at = (n: number) => `${Math.floor((n - 1) / 3) + 0.5}`;
  const row = (n: number) => `${((n - 1) % 3) + 0.5}`;
  if (!lines.length) return "";
  return `<svg class="ln-lines" viewBox="0 0 3 3" preserveAspectRatio="none" aria-hidden="true">${lines.map((l) => `<line x1="${at(l[0] as number)}" y1="${row(l[0] as number)}" x2="${at(l[2] as number)}" y2="${row(l[2] as number)}"/>`).join("")}</svg>`;
}

/** The whole card body (numbers are integers and the zodiac name is a fixed string: nothing here is member text). */
export function chartHtml(c: LifeChart): string {
  const item = (cls: string, label: string, value: string | number, badge: string) => `<div class="ln-item ${cls}"><span>${label}</span><span class="ln-badge ${badge}">${value}</span></div>`;
  const legend = (cls: string, text: string) => `<div><span class="ln-dot ${cls}"></span><span>${text}</span></div>`;
  return `<div class="ln-card">
<div class="ln-head">${item("z", `星座：${c.zodiac_name}`, c.zodiac_number, "ln-b-zodiac")}${item("b", "生日數：", c.birthday_number, "ln-b-birthday")}${item("t", "天賦數：", c.talent_numbers.length ? c.talent_numbers.join("、") : "—", "ln-b-talent")}${item("l", "加總命數：", c.life_number, "ln-b-life")}</div>
<div class="ln-grid" role="img" aria-label="彩色九宮格">${lineLayer(c.lines)}${ROWS.flat().map((n) => cell(n, c.rings[n] as Rings)).join("")}</div>
<div class="ln-legend">${legend("rg-black", "先天數生日數字")}${legend("rg-birthday", "生日數")}${legend("rg-zodiac", "星座數")}${legend("rg-talent", "天賦數")}<div><svg class="ln-dot-tri" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,3 22,21 2,21" fill="none" stroke="#e5303a" stroke-width="2.6" stroke-linejoin="round"/></svg><span>加總命數</span></div><div><svg class="ln-dot-tri" viewBox="0 0 24 24" aria-hidden="true"><line x1="2" y1="12" x2="22" y2="12" stroke="#2563eb" stroke-width="3.7" stroke-linecap="round"/></svg><span>特殊連線</span></div></div>
</div>`;
}
