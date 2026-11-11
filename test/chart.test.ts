import { describe, expect, it } from "vitest";
import { lifeChartOf } from "../src/profile/astro";
import { chartHtml, lifeTitle } from "../src/web/chart";

describe("life number chart: 主線 and 副線", () => {
  it("主線: a row, column or diagonal whose three numbers all carry a circle; 副線: the short diagonals around the centre with both numbers circled", () => {
    const c = lifeChartOf("1990-04-15")!;
    // circled: 1 4 5 9 (birth digits), 6 (birthday number 1+5), 2 (talent 29)
    expect(c.lines).toEqual([[4, 5, 6], [1, 5, 9]]);
    expect(c.sub_lines).toEqual([[2, 4], [6, 2]]);
  });

  it("a number that only carries the 加總命數 triangle still joins the lines (1985-07-03: 6 is the life number)", () => {
    const c = lifeChartOf("1985-07-03")!;
    expect(c.life_number).toBe(6);
    expect(c.rings[6]).toMatchObject({ black: 0, birthday: false, zodiac: false, talent: 0, life: true }); // a triangle and no circle
    // marked: 1 3 4 5 7 8 9 (circles) and 6 (triangle)
    expect(c.lines).toEqual([[4, 5, 6], [7, 8, 9], [1, 4, 7], [3, 6, 9, 0], [1, 5, 9], [3, 5, 7]]); // 0 (the zeros of the date) is marked: 3-6-9 reaches on to 0
    expect(c.sub_lines).toEqual([[4, 8], [8, 6]]);
    // and they are drawn: 3-6-9 and 8-6
    const svg = chartHtml(c);
    expect((svg.match(/<line /g) ?? []).length).toBe(8);
  });

  it("0 sits right of 9 and has one line only: 3-6-9-0 (the reference chart for 1992-02-03)", () => {
    const c = lifeChartOf("1992-02-03")!;
    expect(c.rings[0]).toMatchObject({ black: 2 }); // two zeros in the date
    expect(c.rings[9]).toMatchObject({ black: 2 });
    expect(c.life_number).toBe(8);
    expect(c.lines).toEqual([[1, 2, 3], [3, 6, 9, 0]]);
    expect(c.lines.filter((l) => l.includes(0))).toHaveLength(1);
    // 0 not marked (no zero in the date): 3-6-9 stays three numbers
    const plain = lifeChartOf("1999-11-15")!;
    expect(plain.rings[0]).toMatchObject({ black: 0, talent: 0 });
    expect(plain.lines.every((l) => !l.includes(0))).toBe(true);
    // drawn at the right end of the bottom row (x 350, y 200), in the 4th column
    const html = chartHtml(c);
    expect(html).toMatch(/<text x="350" y="20[0-9]"[^>]*>0<\/text>/);
    expect(html).toMatch(/<line x1="50" y1="200" x2="350" y2="200"/); // 3 ... 0
  });

  it("is one fixed-geometry SVG: 主線 solid and 副線 dashed as wide as the circles, a solid triangle behind a white number", () => {
    const html = chartHtml(lifeChartOf("1990-04-15")!);
    expect(html).toContain('<svg class="ln-svg" viewBox="0 0 400 240"');
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

describe("block title", () => {
  it("xxx生命靈數 x年x月x日, with the date only when it may be shown", () => {
    expect(lifeTitle("小美", "1985-07-03")).toBe("小美生命靈數 1985年7月3日");
    expect(lifeTitle("小美", "2001-12-31")).toBe("小美生命靈數 2001年12月31日");
    expect(lifeTitle("小美", null)).toBe("小美生命靈數");
  });
});

describe("one-line title", () => {
  it("the longer the title, the smaller the font step (never a second line)", async () => {
    const { titleSize } = await import("../src/web/nav-text");
    expect(titleSize("杜杜龍生命靈數 1985年7月3日")).toBe(0);
    expect(titleSize("王大明明明明明明生命靈數 1985年7月3日")).toBeGreaterThan(0);
    expect(titleSize("王大明明明明明明明明明明明生命靈數 1990年4月5日")).toBe(4); // 24 units: the smallest conservative step
    expect(titleSize("王".repeat(40) + "生命靈數")).toBe(4);
    let last = 0;
    for (const n of [3, 8, 10, 13, 16, 30]) {
      const s = titleSize("王".repeat(n) + "生命靈數 1985年7月3日");
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });
});
