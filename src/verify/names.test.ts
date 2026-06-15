import { describe, expect, it } from "vitest";
import { compareNames, levenshtein, normalizeName } from "./names";

describe("name normalization", () => {
  it("uppercases and strips punctuation", () => {
    expect(normalizeName("Stone's Throw")).toBe("STONES THROW");
    expect(normalizeName("STONE'S THROW")).toBe("STONES THROW");
  });

  it("unifies curly apostrophes", () => {
    expect(normalizeName("Stone’s Throw")).toBe("STONES THROW");
  });

  it("collapses whitespace", () => {
    expect(normalizeName("  OLD   TOM \n DISTILLERY ")).toBe(
      "OLD TOM DISTILLERY",
    );
  });
});

describe("levenshtein", () => {
  it("computes classic distances", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });
});

describe("name comparison ladder", () => {
  it("exact match", () => {
    expect(compareNames("OLD TOM DISTILLERY", "OLD TOM DISTILLERY").kind).toBe(
      "exact",
    );
  });

  it("Dave's case: STONE'S THROW vs Stone's Throw, match with explanation, no AI needed", () => {
    const r = compareNames("Stone's Throw", "STONE'S THROW");
    expect(r.kind).toBe("normalized");
    if (r.kind === "normalized") {
      expect(r.note.toLowerCase()).toContain("case");
    }
  });

  it("punctuation-only difference matches with explanation", () => {
    const r = compareNames("OLD TOM DISTILLERY", "OLD TOM, DISTILLERY");
    expect(r.kind).toBe("normalized");
  });

  it("near-miss (1-2 character difference) escalates to judgment, not auto-pass", () => {
    const r = compareNames("OLD TOM DISTILLERY", "OLD TOM DISTILERY");
    expect(r.kind).toBe("near-miss");
  });

  it("clearly different names are different, no judgment call wasted", () => {
    expect(compareNames("OLD TOM DISTILLERY", "RIVERBEND WINERY").kind).toBe(
      "different",
    );
  });

  it("does not near-miss short names too eagerly", () => {
    // distance 2 on very short names is still within threshold=2 by design,
    // but totally different short words must not match
    expect(compareNames("OLD", "NEW").kind).toBe("different");
  });

  /* Qualifier additions seen on real registry labels, judgment, not auto-fail. */

  it("real COLA case: 'Tequila' vs 'Tequila 100% Agave Azul' escalates to judgment", () => {
    expect(compareNames("Tequila", "Tequila 100% Agave Azul").kind).toBe(
      "near-miss",
    );
  });

  it("real COLA case: 'Straight Bourbon Whisky' vs 'Oregon Straight Bourbon Whiskey' escalates to judgment", () => {
    expect(
      compareNames("Straight Bourbon Whisky", "Oregon Straight Bourbon Whiskey")
        .kind,
    ).toBe("near-miss");
  });

  it("token containment never fires on fully different names", () => {
    expect(compareNames("Spiced Rum", "London Dry Gin").kind).toBe("different");
  });
});
