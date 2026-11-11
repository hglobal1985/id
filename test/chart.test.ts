import { describe, expect, it } from "vitest";
import { lifeChartOf } from "../src/profile/astro";
import { chartHtml } from "../src/web/chart";

describe("life number chart: 特殊連線", () => {
  it("draws a line for every row, column or diagonal whose three numbers all carry a circle", () => {
    const c = lifeChartOf("1990-04-15")!;
    // circled: 1 4 5 9 (birth digits), 6 (birthday number 1+5), 2 (talent 29)
    expect(c.lines).toEqual([[4, 5, 6], [1, 5, 9]]);
  });

  it("is one fixed-geometry SVG: blue lines as wide as the circles, a solid triangle behind a white number, legend without brackets", () => {
    const html = chartHtml(lifeChartOf("1990-04-15")!);
    expect(html).toContain('<svg class="ln-svg" viewBox="0 0 300 240"');
    expect((html.match(/<line /g) ?? []).length).toBe(3); // two chart lines + the legend mark
    expect(html).toContain('stroke="#2563eb" stroke-width="2.5"'); // same width as the 2.5 circles
    expect(html).toContain("特殊連線");
    expect(html).not.toMatch(/[（(]/);
    expect(html).toContain("先天數生日數字");
    // 加總命數 is 2: the triangle is solid red and the number on it is white
    expect(html).toMatch(/<polygon points="50,\d+ [^"]*" fill="#e5303a"/);
    expect(html).toMatch(/<text x="50" y="125" dy="\.35em" text-anchor="middle" font-size="22" fill="#ffffff">2<\/text>/);
    // the geometry never depends on how many circles a number has: every number sits in its own cell
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) expect(html).toMatch(new RegExp(`<text x="${50 + 100 * Math.floor((n - 1) / 3)}" y="\\d+"[^>]*>${n}</text>`));
  });
});
