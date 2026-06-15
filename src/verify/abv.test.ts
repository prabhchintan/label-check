import { describe, expect, it } from "vitest";
import { compareAbv, parseAbv } from "./abv";

describe("ABV parsing", () => {
  it('parses "45% Alc./Vol. (90 Proof)"', () => {
    expect(parseAbv("45% Alc./Vol. (90 Proof)")).toEqual({
      abv: 45,
      proof: 90,
    });
  });

  it('parses bare "45%"', () => {
    expect(parseAbv("45%").abv).toBe(45);
  });

  it('parses "ALC. 45% BY VOL."', () => {
    expect(parseAbv("ALC. 45% BY VOL.").abv).toBe(45);
  });

  it('parses "45% ABV"', () => {
    expect(parseAbv("45% ABV").abv).toBe(45);
  });

  it('parses "90 PROOF" alone', () => {
    expect(parseAbv("90 PROOF")).toEqual({ abv: null, proof: 90 });
  });

  it("parses decimals: 13.5% and European 13,5%", () => {
    expect(parseAbv("13.5% alc/vol").abv).toBe(13.5);
    expect(parseAbv("13,5% vol").abv).toBe(13.5);
  });

  it("returns nulls for unparseable input", () => {
    expect(parseAbv("strong stuff")).toEqual({ abv: null, proof: null });
    expect(parseAbv(null)).toEqual({ abv: null, proof: null });
  });

  it('reads the alcohol percentage, not the first percentage: "100% de agave, 40% Alc./Vol."', () => {
    expect(parseAbv("100% de agave, 40% Alc./Vol.").abv).toBe(40);
    expect(parseAbv("Made from 100% Blue Agave. 40% ALC/VOL").abv).toBe(40);
  });

  it("declines an unanchored percentage when several are present", () => {
    expect(parseAbv("100% agave, 80% estate-grown").abv).toBeNull();
  });

  it("does not truncate an oversized/garbled number into a believable value", () => {
    // "1234%" must not silently become "234%"; unparseable -> null, never a guess.
    expect(parseAbv("1234% alc/vol").abv).toBeNull();
  });
});

describe("ABV comparison, tolerant of format, exact on value", () => {
  it('passes "45%" (application) vs "45% Alc./Vol. (90 Proof)" (label)', () => {
    expect(compareAbv("45%", "45% Alc./Vol. (90 Proof)").status).toBe("pass");
  });

  it('passes "45%" vs "90 PROOF", proof conversion', () => {
    const r = compareAbv("45%", "90 PROOF");
    expect(r.status).toBe("pass");
    expect(r.explanation).toContain("90 proof");
  });

  it("fails 45% vs 43%, the core mismatch case", () => {
    const r = compareAbv("45%", "43% Alc./Vol.");
    expect(r.status).toBe("fail");
    expect(r.explanation).toContain("45");
    expect(r.explanation).toContain("43");
  });

  it("fails on internally inconsistent label (45% but 86 proof)", () => {
    const r = compareAbv("45%", "45% Alc./Vol. (86 Proof)");
    expect(r.status).toBe("fail");
    expect(r.explanation).toContain("inconsistent");
  });

  it("reports missing when label has no alcohol statement", () => {
    expect(compareAbv("45%", null).status).toBe("missing");
    expect(compareAbv("45%", "Kentucky Bourbon").status).toBe("missing");
  });

  it("asks for review when the application value is unreadable", () => {
    expect(compareAbv("forty-five", "45% ABV").status).toBe("review");
  });

  it("value must be exact: 45 vs 45.5 fails", () => {
    expect(compareAbv("45%", "45.5% alc/vol").status).toBe("fail");
  });

  it('accepts a bare number on the application side: "45" vs "45% Alc./Vol."', () => {
    expect(compareAbv("45", "45% Alc./Vol.").status).toBe("pass");
    expect(compareAbv("13.5", "13.5% alc/vol").status).toBe("pass");
  });

  it("a bare number still has to match", () => {
    expect(compareAbv("45", "43% Alc./Vol.").status).toBe("fail");
  });

  it("a bare number on the LABEL side is not accepted as an alcohol statement", () => {
    expect(compareAbv("45%", "45").status).toBe("missing");
  });

  it("does not silently pass a label stated as a range, surfaces it for review", () => {
    const r = compareAbv("42%", "40-42% Alc./Vol.");
    expect(r.status).toBe("review");
    expect(r.explanation.toLowerCase()).toContain("range");
  });

  it("wine tolerance (27 CFR 4.36): a within-tolerance difference is review, not fail", () => {
    // 12 vs 13 is within the 1.5% spread for wines at or below 14% ABV.
    expect(compareAbv("12%", "13% alc/vol", { wineTolerance: true }).status).toBe(
      "review",
    );
    // Same values without the wine flag (e.g. spirits) stay a hard mismatch.
    expect(compareAbv("12%", "13% alc/vol").status).toBe("fail");
    // Beyond the tolerance band, even wine fails.
    expect(compareAbv("12%", "15% alc/vol", { wineTolerance: true }).status).toBe(
      "fail",
    );
  });
});
