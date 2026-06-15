import { describe, expect, it } from "vitest";
import { compareNetContents, parseNetContents } from "./netContents";

describe("net contents parsing", () => {
  it('parses "750 mL", "750ml", "750 ML" identically', () => {
    for (const s of ["750 mL", "750ml", "750 ML", "750  ml."]) {
      expect(parseNetContents(s).milliliters).toBe(750);
    }
  });

  it("parses liters: 1 L, 1.75 L", () => {
    expect(parseNetContents("1 L").milliliters).toBe(1000);
    expect(parseNetContents("1.75 L").milliliters).toBe(1750);
  });

  it("parses centiliters: 75 cl == 750 mL", () => {
    expect(parseNetContents("75 cl").milliliters).toBe(750);
  });

  it("parses fluid ounces", () => {
    const ml = parseNetContents("12 FL OZ").milliliters;
    expect(ml).toBeCloseTo(354.88, 1);
  });

  it("parses full words: 750 milliliters", () => {
    expect(parseNetContents("750 milliliters").milliliters).toBe(750);
  });

  it("returns null for unparseable input", () => {
    expect(parseNetContents("a fifth").milliliters).toBeNull();
    expect(parseNetContents(null).milliliters).toBeNull();
  });

  it('sums compound US quantities: "1 PT. 9 FL. OZ.", standard on bombers', () => {
    expect(parseNetContents("1 PT. 9 FL. OZ.").milliliters).toBeCloseTo(739.3, 1);
    expect(parseNetContents("1 QT. 8 FL. OZ.").milliliters).toBeCloseTo(1182.9, 1);
  });

  it('reads dual statements by their metric side: "750 mL (25.4 FL OZ)"', () => {
    const p = parseNetContents("750 mL (25.4 FL OZ)");
    expect(p.milliliters).toBe(750);
    expect(p.system).toBe("metric");
  });

  it('treats "1,000 ml" commas as thousands separators, "1,75 L" as a decimal', () => {
    expect(parseNetContents("1,000 ml").milliliters).toBe(1000);
    expect(parseNetContents("1,75 L").milliliters).toBe(1750);
  });

  it('parses a leading decimal: ".75 L"', () => {
    expect(parseNetContents(".75 L").milliliters).toBe(750);
  });

  it('declines multi-packs ("6 x 12 FL OZ"), per-container vs total is ambiguous', () => {
    expect(parseNetContents("6 x 12 FL OZ").milliliters).toBeNull();
  });
});

describe("net contents comparison, exact after unit normalization", () => {
  it('passes "750ml" vs "750 mL", formatting only', () => {
    const r = compareNetContents("750ml", "750 mL");
    expect(r.status).toBe("pass");
  });

  it('passes "0.75 L" vs "750 mL", unit conversion', () => {
    expect(compareNetContents("0.75 L", "750 mL").status).toBe("pass");
  });

  it("fails 750 mL vs 700 mL", () => {
    const r = compareNetContents("750 mL", "700 mL");
    expect(r.status).toBe("fail");
    expect(r.explanation).toContain("750");
    expect(r.explanation).toContain("700");
  });

  it("flags review (not a hard fail) when label lacks net contents, may be embossed on the container", () => {
    const r = compareNetContents("750 mL", null);
    expect(r.status).toBe("review");
    expect(r.explanation).toContain("container");
  });

  it("asks for review when the application value is unreadable", () => {
    expect(compareNetContents("standard bottle", "750 mL").status).toBe(
      "review",
    );
  });

  it("does not pass on near-but-different metric values (750 vs 751)", () => {
    expect(compareNetContents("750 mL", "751 mL").status).toBe("fail");
  });

  it('passes "750 mL" vs "25.4 FL OZ", the rounded equivalence printed on real bottles', () => {
    expect(compareNetContents("750 mL", "25.4 FL OZ").status).toBe("pass");
    expect(compareNetContents("355 ml", "12 FL OZ").status).toBe("pass");
  });

  it("still fails genuinely different cross-system values (750 mL vs 24 FL OZ)", () => {
    expect(compareNetContents("750 mL", "24 FL OZ").status).toBe("fail");
  });

  it('passes "25 FL OZ" vs "1 PT. 9 FL. OZ.", same quantity, compound form', () => {
    expect(compareNetContents("25 FL OZ", "1 PT. 9 FL. OZ.").status).toBe("pass");
  });

  it("flags multi-packs for review rather than guessing", () => {
    expect(compareNetContents("72 FL OZ", "6 x 12 FL OZ").status).toBe("review");
  });
});
