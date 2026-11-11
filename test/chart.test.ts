import { describe, expect, it } from "vitest";
import { lifeChartOf } from "../src/profile/astro";
import { chartHtml } from "../src/web/chart";

describe("life number chart: 特殊連線", () => {
  it("draws a line for every row, column or diagonal whose three numbers all carry a circle", () => {
    const c = lifeChartOf("1990-04-15")!;
    // circled: 1 4 5 9 (birth digits), 6 (birthday number 1+5), 2 (talent 29)
    expect(c.lines).toEqual([[4, 5, 6], [1, 5, 9]]);
  });

  it("the chart shows the lines in blue, the triangle innermost, and the legend without the explanations in brackets", () => {
    const html = chartHtml(lifeChartOf("1990-04-15")!);
    expect(html).toContain('class="ln-lines"');
    expect((html.match(/<line /g) ?? []).length).toBe(3); // two chart lines + the legend mark
    expect(html).toContain("特殊連線");
    expect(html).not.toMatch(/[（(]/);
    expect(html).toContain("先天數生日數字");
    // 加總命數 (2) carries circles: the triangle sits inside the first circle
    expect(html).toMatch(/ln-ring[^"]*ln-ring-t"><span class="ln-tri">/);
  });
});
