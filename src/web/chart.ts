// Server-rendered life number chart for the public profile page (same drawing as the edit page, src/web/assets/me.ts).
// One SVG with fixed geometry: every number has its own 72x80 cell, so any number of circles or a shape never
// moves anything — the circles just grow outward around the centre. 天賦數 = outlined triangles (one per occurrence, growing
// outward like the circles, with the same gap between them), 加總命數 = an outlined square. Circles, triangles and the square are
// all thin outlines (1.5) that may overlap each other freely.
import type { LifeChart, Rings } from "../profile/astro";

const COLS = 4; // 1-9 in three columns, and 0 alone in a fourth column (bottom row, right of 9)
const CW = 72; // columns sit close together so the numbers can be drawn larger
const CH = 80;
const MAX_R = 34; // keeps the largest circle inside its column (neighbour centres are 72 apart)
const RING_COLOR: Record<string, string> = { black: "#0f172a", birthday: "#f5b400", zodiac: "#8b2fe0" };
const TALENT_COLOR = "#7ccf1b";
const LIFE_COLOR = "#e5303a";
const LINE_COLOR = "#0ea5e9"; // sky blue: clearly different from the purple 星座數 circle
const SW = 1.5; // one thin outline width for circles, triangles, the square and the lines
const RING_STEP = 4.5; // gap between neighbouring circles — and between neighbouring triangles

const centre = (n: number) => (n === 0 ? { x: CW / 2 + CW * 3, y: CH / 2 + CH * 2 } : { x: CW / 2 + CW * Math.floor((n - 1) / 3), y: CH / 2 + CH * ((n - 1) % 3) });

// The innermost triangle (apex 14.25 above the centre, base 9.75 below, half width 15); the next ones are the same triangle scaled
// about its incentre so every side moves outward by exactly RING_STEP — the same distance as between two circles.
const TRI = { apex: 14.25, base: 9.75, half: 15, cy: 1.44, inradius: 8.31 };
function triangle(x: number, y: number, k: number): string {
  const f = 1 + (k * RING_STEP) / TRI.inradius;
  const at = (dx: number, dy: number) => `${(x + dx * f).toFixed(1)},${(y + TRI.cy + (dy - TRI.cy) * f).toFixed(1)}`;
  return `<polygon points="${at(0, -TRI.apex)} ${at(-TRI.half, TRI.base)} ${at(TRI.half, TRI.base)}" fill="none" stroke="${TALENT_COLOR}" stroke-width="${SW}" stroke-linejoin="round"/>`;
}

function cell(n: number, r: Rings): string {
  const kinds: string[] = [...Array.from({ length: r.black }, () => "black"), ...(r.birthday ? ["birthday"] : []), ...(r.zodiac ? ["zodiac"] : [])];
  const { x, y } = centre(n);
  const marked = kinds.length > 0 || r.talent > 0 || r.life;
  // Circles, triangles and the square are independent thin outlines and may overlap each other.
  const r0 = 15;
  const step = kinds.length > 1 ? Math.min(RING_STEP, (MAX_R - r0) / (kinds.length - 1)) : 0;
  // The lines end at the innermost circle: a background disc keeps them off the digit.
  let out = `<circle cx="${x}" cy="${y}" r="${r0}" fill="#f6f8f4"/>`;
  for (let i = kinds.length - 1; i >= 0; i--) out += `<circle cx="${x}" cy="${y}" r="${(r0 + i * step).toFixed(2)}" fill="none" stroke="${RING_COLOR[kinds[i] as string]}" stroke-width="${SW}"/>`;
  for (let k = r.talent - 1; k >= 0; k--) out += triangle(x, y, k); // 天賦數: one outlined triangle per occurrence
  if (r.life) out += `<rect x="${x - 14}" y="${y - 14}" width="28" height="28" rx="2" fill="none" stroke="${LIFE_COLOR}" stroke-width="${SW}" stroke-linejoin="round"/>`; // 加總命數
  out += `<text x="${x}" y="${y + 1}" dy=".35em" text-anchor="middle" font-size="26" fill="${marked ? "#0f172a" : "#c3cbbf"}">${n}</text>`;
  return out;
}

/** Blue lines between the centres of the numbers (same width as the circles): 主線 solid, 副線 dashed. */
function lineLayer(lines: readonly (readonly number[])[], sub: readonly (readonly number[])[]): string {
  const draw = (l: readonly number[], extra: string) => {
    const a = centre(l[0] as number);
    const b = centre(l[l.length - 1] as number);
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${LINE_COLOR}" stroke-width="${SW}" stroke-linecap="round"${extra}/>`;
  };
  return sub.map((l) => draw(l, ' stroke-dasharray="7 6"')).join("") + lines.map((l) => draw(l, "")).join("");
}

const BLUE = `stroke="${LINE_COLOR}" stroke-width="2" stroke-linecap="round" fill="none"`;
/** Legend marks: each one is drawn as the line it stands for. */
const LINE_LEGEND: readonly { icon: string; text: string }[] = [
  { icon: `<line x1="2" y1="16" x2="22" y2="8" ${BLUE}/>`, text: "主線：天賦、能力" },
  { icon: `<line x1="2" y1="16" x2="22" y2="8" ${BLUE} stroke-dasharray="3.2 3.2"/>`, text: "副線：人際互動、處事態度" },
  { icon: `<line x1="2" y1="12" x2="22" y2="12" ${BLUE}/>`, text: "橫線：你如何與世界互動？" },
  { icon: `<line x1="12" y1="2" x2="12" y2="22" ${BLUE}/>`, text: "直線：你如何運用自己的能力？" },
  { icon: `<line x1="3" y1="21" x2="21" y2="3" ${BLUE}/>`, text: "斜線：你如何追求人生目標？" },
];

/** 「xxx生命靈數 x年x月x日」: the date only when the member made the birthday public (the chart itself is always public). */
export function lifeTitle(name: string, birthday: string | null): string {
  const m = birthday ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday) : null;
  return m ? `${name}生命靈數 ${m[1]}年${Number(m[2])}月${Number(m[3])}日` : `${name}生命靈數`;
}

/** The whole card body (numbers are integers and the zodiac name is a fixed string: nothing here is member text). */
/** `legend`: the explanations under the grid are for signed-in members only; the clean public page leaves them out. */
export function chartHtml(c: LifeChart, legendOn = false): string {
  const item = (cls: string, label: string, value: string | number, badge: string) => `<div class="ln-item ${cls}"><span>${label}</span><span class="ln-badge ${badge}">${value}</span></div>`;
  const legend = (cls: string, text: string) => `<div><span class="ln-dot ${cls}"></span><span>${text}</span></div>`;
  const grid = `<svg class="ln-svg" viewBox="0 0 ${CW * COLS} ${CH * 3}" role="img" aria-label="彩色九宮格">${lineLayer(c.lines, c.sub_lines)}${[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => cell(n, c.rings[n] as Rings)).join("")}</svg>`;
  return `<div class="ln-card">
<div class="ln-head">${item("z", `星座：${c.zodiac_name}`, c.zodiac_number, "ln-b-zodiac")}${item("b", "生日數：", c.birthday_number, "ln-b-birthday")}${item("t", "天賦數：", c.talent_numbers.length ? c.talent_numbers.join("、") : "—", "ln-b-talent")}${item("l", "加總命數：", c.life_number, "ln-b-life")}</div>
${grid}
${legendOn ? `<div class="ln-legend">${legend("rg-black", "先天數生日數字")}${legend("rg-birthday", "生日數")}${legend("rg-zodiac", "星座數")}<div><svg class="ln-dot-tri" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,4 21,19 3,19" fill="none" stroke="${TALENT_COLOR}" stroke-width="1.8" stroke-linejoin="round"/></svg><span>天賦數</span></div><div><svg class="ln-dot-tri" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1.5" fill="none" stroke="${LIFE_COLOR}" stroke-width="1.8" stroke-linejoin="round"/></svg><span>加總命數</span></div>${LINE_LEGEND.map((l) => `<div><svg class="ln-dot-tri" viewBox="0 0 24 24" aria-hidden="true">${l.icon}</svg><span>${l.text}</span></div>`).join("")}</div>` : ""}
</div>`;
}
