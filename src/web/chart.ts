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
  if (!rings.length && !r.life) return `<td class="ln-cell ln-empty"><span class="ln-n">${n}</span></td>`;
  let inner = `<span class="ln-n${rings.length ? "" : " ln-red"}">${n}</span>`;
  for (const c of rings) inner = `<span class="ln-ring ${c}">${inner}</span>`;
  if (r.life) {
    inner = `<span class="ln-tri"><svg viewBox="0 0 100 90" preserveAspectRatio="none" aria-hidden="true"><polygon points="50,5 96,85 4,85" fill="none" stroke="#e5303a" stroke-width="5" stroke-linejoin="round"/></svg>${inner}</span>`;
  }
  return `<td class="ln-cell">${inner}</td>`;
}

/** The whole card body (numbers are integers and the zodiac name is a fixed string: nothing here is member text). */
export function chartHtml(c: LifeChart): string {
  const item = (cls: string, label: string, value: string | number, badge: string) => `<div class="ln-item ${cls}"><span>${label}</span><span class="ln-badge ${badge}">${value}</span></div>`;
  const legend = (cls: string, text: string) => `<div><span class="ln-dot ${cls}"></span><span>${text}</span></div>`;
  return `<div class="ln-card">
<div class="ln-head">${item("z", `星座：${c.zodiac_name}`, c.zodiac_number, "ln-b-zodiac")}${item("b", "生日數：", c.birthday_number, "ln-b-birthday")}${item("t", "天賦數：", c.talent_numbers.length ? c.talent_numbers.join("、") : "—", "ln-b-talent")}${item("l", "加總命數：", c.life_number, "ln-b-life")}</div>
<table class="ln-grid" aria-label="彩色九宮格">${ROWS.map((row) => `<tr>${row.map((n) => cell(n, c.rings[n] as Rings)).join("")}</tr>`).join("")}</table>
<div class="ln-legend">${legend("rg-black", "先天數生日數字（黑色線圈，出現幾次畫幾圈）")}${legend("rg-birthday", "生日數（黃色圈線，出生日期相加至個位數）")}${legend("rg-zodiac", "星座數（紫色圈線）")}${legend("rg-talent", "天賦數（亮綠圈線）")}<div><svg class="ln-dot-tri" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,3 22,21 2,21" fill="none" stroke="#e5303a" stroke-width="2.6" stroke-linejoin="round"/></svg><span>加總命數（紅色三角形包圍數字）</span></div></div>
</div>`;
}
