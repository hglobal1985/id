import { describe, expect, it } from "vitest";
import { lifeChartOf } from "../src/profile/astro";
import { chartHtml } from "../src/web/chart";

describe("life number chart: 主線 and 副線", () => {
  it("主線: a row, column or diagonal whose three numbers all carry a circle; 副線: the short diagonals around the centre with both numbers circled", () => {
    const c = lifeChartOf("1990-04-15")!;
    // circled: 1 4 5 9 (birth digits), 6 (birthday number 1+5), 2 (talent 29)
    expect(c.lines).toEqual([[4, 5, 6], [1, 5, 9]]);
    expect(c.sub_lines).toEqual([[2, 4], [6, 2]]);
  });

  it("is one fixed-geometry SVG: 主線 solid and 副線 dashed as wide as the circles, a solid triangle behind a white number", () => {
    const html = chartHtml(lifeChartOf("1990-04-15")!);
    expect(html).toContain('<svg class="ln-svg" viewBox="0 0 300 240"');
    expect((html.match(/<line /g) ?? []).length).toBe(4); // 2 main + 2 sub lines (no legend)
    expect((html.match(/stroke-dasharray="7 6"/g) ?? []).length).toBe(2);
    expect(html).toContain('stroke="#2563eb" stroke-width="2.5"'); // same width as the 2.5 circles
    expect(html).toMatch(/<polygon points="50,\d+ [^"]*" fill="#e5303a"/);
    expect(html).toMatch(/<text x="50" y="125" dy="\.35em" text-anchor="middle" font-size="22" fill="#ffffff">2<\/text>/);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) expect(html).toMatch(new RegExp(`<text x="${50 + 100 * Math.floor((n - 1) / 3)}" y="\\d+"[^>]*>${n}</text>`));
  });

  it("the explanations under the grid are only for signed-in members; the clean public page has none", () => {
    const c = lifeChartOf("1990-04-15")!;
    const clean = chartHtml(c);
    expect(clean).not.toContain("ln-legend");
    expect(clean).not.toContain("先天數生日數字");
    const withLegend = chartHtml(c, true);
    for (const t of ["先天數生日數字", "加總命數", "主線：天賦、能力", "副線：人際互動、處事態度", "橫線：你如何與世界互動？", "直線：你如何運用自己的能力？", "斜線：你如何追求人生目標？"]) expect(withLegend).toContain(t);
    expect(withLegend).not.toContain("特殊連線");
    expect(withLegend).not.toMatch(/[（(]/);
    expect(withLegend).toContain('stroke-dasharray="2.4 2.4"'); // the 副線 mark is dashed
  });
});
