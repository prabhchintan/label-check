import { describe, expect, it } from "vitest";
import { STATUTORY_WARNING, checkWarning } from "./warning";

const bold = (text: string) =>
  checkWarning({ text, appearsBold: true });

describe("government warning, exact statutory match (27 CFR 16.21)", () => {
  it("passes the exact statutory text", () => {
    const r = bold(STATUTORY_WARNING);
    expect(r.status).toBe("pass");
  });

  it("passes with line breaks and extra spaces (labels wrap text)", () => {
    const wrapped = STATUTORY_WARNING.replace(
      "Surgeon General,",
      "Surgeon\n   General,",
    ).replace("(2)", "  (2)");
    expect(bold(wrapped).status).toBe("pass");
  });

  it("passes with curly apostrophes/quotes (typography, not wording)", () => {
    const curly = STATUTORY_WARNING.replace("women", "women"); // no-op guard
    expect(bold(curly).status).toBe("pass");
  });

  it("rejects Title Case prefix, Jenny's catch", () => {
    const titleCase = STATUTORY_WARNING.replace(
      "GOVERNMENT WARNING:",
      "Government Warning:",
    );
    const r = bold(titleCase);
    expect(r.status).toBe("fail");
    expect(r.explanation).toContain("capital letters");
  });

  it("rejects lowercase prefix", () => {
    const lower = STATUTORY_WARNING.replace(
      "GOVERNMENT WARNING:",
      "government warning:",
    );
    expect(bold(lower).status).toBe("fail");
  });

  it("rejects reworded statement (\"shouldn't\" for \"should not\")", () => {
    const reworded = STATUTORY_WARNING.replace("should not", "shouldn't");
    const r = bold(reworded);
    expect(r.status).toBe("fail");
    expect(r.explanation).toContain("word-for-word");
  });

  it("rejects abbreviated statement (clause dropped)", () => {
    const abbreviated =
      "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy.";
    expect(bold(abbreviated).status).toBe("fail");
  });

  it("rejects additions to the statement", () => {
    const added = STATUTORY_WARNING + " Please drink responsibly.";
    expect(bold(added).status).toBe("fail");
  });

  it("points at the first differing word", () => {
    const swapped = STATUTORY_WARNING.replace("machinery", "equipment");
    const r = bold(swapped);
    expect(r.status).toBe("fail");
    expect(r.explanation).toContain("MACHINERY");
    expect(r.explanation).toContain("EQUIPMENT");
  });

  it("reports missing warning", () => {
    const r = checkWarning({ text: null, appearsBold: "unknown" });
    expect(r.status).toBe("missing");
  });

  it("treats empty/whitespace text as missing", () => {
    expect(checkWarning({ text: "   \n ", appearsBold: true }).status).toBe(
      "missing",
    );
  });

  it("rejects statements that do not start with the prefix", () => {
    const r = bold(
      "WARNING: drinking alcohol during pregnancy can cause birth defects.",
    );
    expect(r.status).toBe("fail");
  });

  it("flags YELLOW (review) when bold cannot be determined", () => {
    const r = checkWarning({ text: STATUTORY_WARNING, appearsBold: "unknown" });
    expect(r.status).toBe("review");
    expect(r.explanation).toContain("bold");
  });

  it("flags YELLOW (review) when prefix appears not bold, never silently passes", () => {
    const r = checkWarning({ text: STATUTORY_WARNING, appearsBold: false });
    expect(r.status).toBe("review");
  });

  it("body case-insensitivity: all-caps body with correct wording passes", () => {
    expect(bold(STATUTORY_WARNING.toUpperCase()).status).toBe("pass");
  });

  /* Real-world layout quirks found on APPROVED labels in the COLA public
     registry (Samples set), layout is not a violation. */

  it("passes with a space before the colon (real sake label, COLA 14317001000468)", () => {
    const spaced = STATUTORY_WARNING.replace(
      "GOVERNMENT WARNING:",
      "GOVERNMENT WARNING :",
    );
    expect(bold(spaced).status).toBe("pass");
  });

  it("passes with enumerators run into words: \"(1)According\" (real label layout)", () => {
    const runIn = STATUTORY_WARNING.replace("(1) According", "(1)According")
      .replace("(2) Consumption", "(2)Consumption");
    expect(bold(runIn).status).toBe("pass");
  });

  it("passes with hyphenated line wraps: \"BEV-ERAGES\" (real bourbon back label)", () => {
    const wrapped = STATUTORY_WARNING.replace("beverages", "bev-\nerages")
      .replace("Surgeon", "Sur-\ngeon");
    expect(bold(wrapped).status).toBe("pass");
  });

  it("flags the missing comma after 'machinery' for review, naming it, TTB's own catch on COLA 19115001001298", () => {
    const noComma = STATUTORY_WARNING.replace("machinery, and", "machinery and");
    const r = bold(noComma);
    expect(r.status).toBe("review");
    expect(r.warningPunctuation).toBe(true);
    expect(r.explanation).toContain("comma");
    expect(r.explanation).toContain("machinery");
    expect(r.explanation).toContain("agent's call");
  });

  it("treats a raised middot read for a sentence period as a period (real Rampur quirk)", () => {
    const middot = STATUTORY_WARNING.replace(/\.$/, "·"); // final "." misread as "·"
    expect(bold(middot).status).toBe("pass");
  });

  it("flags the missing colon after 'GOVERNMENT WARNING' for review, the Penn Square case", () => {
    const noColon = STATUTORY_WARNING.replace(
      "GOVERNMENT WARNING:",
      "GOVERNMENT WARNING",
    );
    const r = bold(noColon);
    expect(r.status).toBe("review");
    expect(r.warningPunctuation).toBe(true);
    expect(r.explanation).toContain("colon");
  });

  it("a substantive word change is a hard fail, not a punctuation review", () => {
    const swapped = STATUTORY_WARNING.replace("machinery", "equipment");
    const r = bold(swapped);
    expect(r.status).toBe("fail");
    expect(r.warningPunctuation).toBeUndefined();
  });

  it("punctuation review only triggers when every word is exact and capitals are right", () => {
    // missing colon AND a reworded word → substantive fail wins
    const both = STATUTORY_WARNING.replace("GOVERNMENT WARNING:", "GOVERNMENT WARNING").replace(
      "should not",
      "shouldn't",
    );
    expect(bold(both).status).toBe("fail");
  });

  it("points at the real violation, not an earlier line-wrap hyphen", () => {
    const wrappedAndWrong = STATUTORY_WARNING.replace(
      "beverages during",
      "bev-\nerages during",
    ).replace("machinery", "equipment");
    const r = bold(wrappedAndWrong);
    expect(r.status).toBe("fail");
    expect(r.explanation).toContain("MACHINERY");
    expect(r.explanation).toContain("EQUIPMENT");
    expect(r.explanation).not.toContain("BEV-");
  });
});
