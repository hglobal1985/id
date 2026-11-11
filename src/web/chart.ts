// Server-rendered life number chart for the public profile page (same drawing as the edit page, src/web/assets/me.ts).
// One SVG with fixed geometry: every number has its own 100x80 cell, so any number of circles or a triangle never
// moves anything — the circles just grow outward around the centre.
import type { LifeChart, Rings } from "../profile/astro";

const COLS = 3;
const CW = 100;
const CH = 80;
const MAX_R = 37;
const RING_COLOR: Record<string, string> = { black: "#0f172a", birthday: "#f5b400", zodiac: "#8b2fe0", talent: "#7ccf1b" };

const centre = (n: number) => ({ x: CW / 2 + CW * Math.floor((n - 1) / 3), y: CH / 2 + CH * ((n - 1) % 3) });

function cell(n: number, r: Rings): string {
  const kinds: string[] = [
    ...Array.from({ length: r.black }, () => "black"),
    ...(r.birthday ? ["birthday"] : []),
    ...(r.zodiac ? ["zodiac"] : []),
    ...Array.from({ length: r.talent }, () => "talent"),
  ];
  const { x, y } = centre(n);
  // Outward from the middle: the red triangle sits right behind the number, the circles around it.
  const r0 = r.life ? 26 : 15;
  const step = kinds.length > 1 ? Math.min(4.5, (MAX_R - r0) / (kinds.length - 1)) : 0;
  let out = "";
  for (let i = kinds.length - 1; i >= 0; i--) out += `<circle cx="${x}" cy="${y}" r="${(r0 + i * step).toFixed(2)}" fill="#f6f8f4" stroke="${RING_COLOR[kinds[i] as string]}" stroke-width="2.5"/>`;
  if (r.life) out += `<polygon points="${x},${y - 18} ${x - 19},${y + 14} ${x + 19},${y + 14}" fill="#e5303a" stroke="#e5303a" stroke-width="3" stroke-linejoin="round"/>`;
  const fill = r.life ? "#ffffff" : kinds.length ? "#0f172a" : "#c3cbbf";
  out += `<text x="${x}" y="${y + (r.life ? 5 : 1)}" dy=".35em" text-anchor="middle" font-size="${r.life ? 22 : 24}" fill="${fill}">${n}</text>`;
  return out;
}

/** Blue lines between the centres of the numbers (same width as the circles). */
function lineLayer(lines: readonly (readonly number[])[]): string {
  return lines
    .map((l) => {
      const a = centre(l[0] as number);
      const b = centre(l[2] as number);
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/>`;
    })
    .join("");
}

/** The whole card body (numbers are integers and the zodiac name is a fixed string: nothing here is member text). */
export function chartHtml(c: LifeChart): string {
  const item = (cls: string, label: string, value: string | number, badge: string) => `<div class="ln-item ${cls}"><span>${label}</span><span class="ln-badge ${badge}">${value}</span></div>`;
  const legend = (cls: string, text: string) => `<div><span class="ln-dot ${cls}"></span><span>${text}</span></div>`;
  const grid = `<svg class="ln-svg" viewBox="0 0 ${CW * COLS} ${CH * 3}" role="img" aria-label="彩色九宮格">${lineLayer(c.lines)}${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => cell(n, c.rings[n] as Rings)).join("")}</svg>`;
  return `<div class="ln-card">
<div class="ln-head">${item("z", `星座：${c.zodiac_name}`, c.zodiac_number, "ln-b-zodiac")}${item("b", "生日數：", c.birthday_number, "ln-b-birthday")}${item("t", "天賦數：", c.talent_numbers.length ? c.talent_numbers.join("、") : "—", "ln-b-talent")}${item("l", "加總命數：", c.life_number, "ln-b-life")}</div>
${grid}
<div class="ln-legend">${legend("rg-black", "先天數生日數字")}${legend("rg-birthday", "生日數")}${legend("rg-zodiac", "星座數")}${legend("rg-talent", "天賦數")}<div><svg class="ln-dot-tri" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,3 22,21 2,21" fill="#e5303a" stroke="#e5303a" stroke-width="2" stroke-linejoin="round"/></svg><span>加總命數</span></div><div><svg class="ln-dot-tri" viewBox="0 0 24 24" aria-hidden="true"><line x1="2" y1="12" x2="22" y2="12" stroke="#2563eb" stroke-width="3.7" stroke-linecap="round"/></svg><span>特殊連線</span></div></div>
</div>`;
}
