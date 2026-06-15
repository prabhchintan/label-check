import { describe, expect, it } from "vitest";
import { runVerification } from "./pipeline";
import { STATUTORY_WARNING } from "./verify";
import type {
  JudgmentResult,
  LabelExtraction,
  ModelProvider,
} from "./extract/types";
import { ExtractionError } from "./extract/types";

const goodExtraction = (
  overrides: Partial<LabelExtraction> = {},
): LabelExtraction => ({
  brand_name: "OLD TOM DISTILLERY",
  class_type: "Kentucky Straight Bourbon Whiskey",
  alcohol_statement: "45% Alc./Vol. (90 Proof)",
  net_contents: "750 mL",
  warning: { present: true, text: STATUTORY_WARNING, appears_bold: true },
  producer_name: "Old Tom Distillery, Bardstown, KY",
  country_of_origin: null,
  image_quality_note: null,
  ...overrides,
});

function fakeProvider(
  extraction: LabelExtraction,
  judgment?: JudgmentResult,
): ModelProvider {
  return {
    name: "fake",
    async extractLabel() {
      return extraction;
    },
    async transcribeWarning() {
      return extraction.warning;
    },
    async judgeNames() {
      if (!judgment)
        throw new ExtractionError("no judgment", "AI judgment unavailable.");
      return judgment;
    },
  };
}

const app = {
  brand_name: "OLD TOM DISTILLERY",
  class_type: "Kentucky Straight Bourbon Whiskey",
  abv: "45%",
  net_contents: "750 mL",
};

const img = [{ bytes: new Uint8Array([1, 2, 3]), mediaType: "image/png" }];

describe("verification pipeline", () => {
  it("GREEN end-to-end on the happy path, with timing reported", async () => {
    const r = await runVerification(fakeProvider(goodExtraction()), app, img);
    expect(r.verdict.tier).toBe("GREEN");
    expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(r.verdict.fields).toHaveLength(7);
  });

  it("validates bottler presence and flags its absence for review", async () => {
    const r = await runVerification(
      fakeProvider(goodExtraction({ producer_name: null })),
      app,
      img,
    );
    const bottler = r.verdict.fields.find((f) => f.field === "Bottler / producer");
    expect(bottler?.status).toBe("review");
    expect(r.verdict.tier).toBe("YELLOW");
  });

  it("country of origin: import markings without an origin flag review", async () => {
    const r = await runVerification(
      fakeProvider(
        goodExtraction({
          producer_name: "Imported by Acme Importing Co., New York, NY",
          country_of_origin: null,
        }),
      ),
      app,
      img,
    );
    const origin = r.verdict.fields.find((f) => f.field === "Country of origin");
    expect(origin?.status).toBe("review");
  });

  it("country of origin: domestic labels pass without one", async () => {
    const r = await runVerification(fakeProvider(goodExtraction()), app, img);
    const origin = r.verdict.fields.find((f) => f.field === "Country of origin");
    expect(origin?.status).toBe("pass");
    expect(origin?.explanation).toContain("only for imported");
  });

  it("declared source 'imported' without an origin on the label flags review", async () => {
    const r = await runVerification(
      fakeProvider(goodExtraction({ country_of_origin: null })),
      { ...app, source: "imported" },
      img,
    );
    const origin = r.verdict.fields.find((f) => f.field === "Country of origin");
    expect(origin?.status).toBe("review");
    expect(origin?.explanation).toContain("imported");
  });

  it("declared source 'domestic' passes without an origin, no inference needed", async () => {
    const r = await runVerification(
      fakeProvider(
        // import-looking producer text would normally trigger review;
        // an explicit domestic declaration overrides the inference.
        goodExtraction({
          producer_name: "Imported Spirits LLC, Houston, TX",
          country_of_origin: null,
        }),
      ),
      { ...app, source: "domestic" },
      img,
    );
    const origin = r.verdict.fields.find((f) => f.field === "Country of origin");
    expect(origin?.status).toBe("pass");
    expect(origin?.explanation).toContain("domestic");
  });

  it("declared beverage type 'malt' makes the ABV exemption deterministic", async () => {
    const r = await runVerification(
      fakeProvider(
        // class wording gives no hint it's a malt beverage…
        goodExtraction({ class_type: "Specialty Beverage", alcohol_statement: null }),
      ),
      // …but the application declares it, so the exemption applies.
      { ...app, class_type: "Specialty Beverage", abv: "", beverage_type: "malt" },
      img,
    );
    const abv = r.verdict.fields.find((f) => f.field === "Alcohol content");
    expect(abv?.status).toBe("pass");
    expect(abv?.explanation).toContain("27 CFR 7");
  });

  it("surfaces the fanciful name in the extraction summary", async () => {
    const r = await runVerification(
      fakeProvider(goodExtraction({ fanciful_name: "Sweet Sunny South" })),
      app,
      img,
    );
    expect(r.extraction.fanciful_name).toBe("Sweet Sunny South");
  });

  it("malt beverages without an alcohol statement pass with the exemption note", async () => {
    const r = await runVerification(
      fakeProvider(
        goodExtraction({
          class_type: "Malt Beverage Specialty",
          alcohol_statement: null,
        }),
      ),
      { ...app, class_type: "Malt Beverage Specialty", abv: "" },
      img,
    );
    const abv = r.verdict.fields.find((f) => f.field === "Alcohol content");
    expect(abv?.status).toBe("pass");
    expect(abv?.explanation).toContain("exempt");
  });

  it("missing alcohol content on a non-exempt label is still RED", async () => {
    const r = await runVerification(
      fakeProvider(goodExtraction({ alcohol_statement: null })),
      app,
      img,
    );
    const abv = r.verdict.fields.find((f) => f.field === "Alcohol content");
    expect(abv?.status).toBe("missing");
    expect(r.verdict.tier).toBe("RED");
  });

  it("table wine without an alcohol statement passes with the 27 CFR 4.36 note", async () => {
    const r = await runVerification(
      fakeProvider(
        goodExtraction({
          class_type: "Red Table Wine",
          alcohol_statement: null,
        }),
      ),
      { ...app, class_type: "Red Table Wine", abv: "" },
      img,
    );
    const abv = r.verdict.fields.find((f) => f.field === "Alcohol content");
    expect(abv?.status).toBe("pass");
    expect(abv?.explanation).toContain("4.36");
  });

  it("wine NOT designated table/light still requires an alcohol statement", async () => {
    const r = await runVerification(
      fakeProvider(
        goodExtraction({
          class_type: "Cabernet Sauvignon",
          alcohol_statement: null,
        }),
      ),
      { ...app, class_type: "Cabernet Sauvignon", abv: "13.5%" },
      img,
    );
    const abv = r.verdict.fields.find((f) => f.field === "Alcohol content");
    expect(abv?.status).toBe("missing");
    expect(r.verdict.tier).toBe("RED");
  });

  it("near-miss brand name asks the model and flags YELLOW for confirmation when same", async () => {
    const r = await runVerification(
      fakeProvider(goodExtraction({ brand_name: "OLD TOM DISTILERY" }), {
        same: true,
        rationale: "Single-letter spelling variation of the same brand.",
      }),
      app,
      img,
    );
    expect(r.verdict.tier).toBe("YELLOW");
    const brand = r.verdict.fields.find((f) => f.field === "Brand name");
    expect(brand?.status).toBe("review");
    expect(brand?.aiJudgment).toBe(true);
  });

  it("near-miss falls back to human review when judgment is unavailable (mock mode)", async () => {
    const r = await runVerification(
      fakeProvider(goodExtraction({ brand_name: "OLD TOM DISTILERY" })),
      app,
      img,
    );
    const brand = r.verdict.fields.find((f) => f.field === "Brand name");
    expect(brand?.status).toBe("review");
    expect(brand?.aiJudgment).toBeUndefined();
  });

  it("missing warning is RED", async () => {
    const r = await runVerification(
      fakeProvider(
        goodExtraction({
          warning: { present: false, text: null, appears_bold: "unknown" },
        }),
      ),
      app,
      img,
    );
    expect(r.verdict.tier).toBe("RED");
  });

  it("warning failure confirmed by the careful read stays RED", async () => {
    let carefulCalls = 0;
    const provider: ModelProvider = {
      name: "fake",
      async extractLabel() {
        return goodExtraction({
          warning: { present: false, text: null, appears_bold: "unknown" },
        });
      },
      async transcribeWarning() {
        carefulCalls++;
        return { present: false, text: null, appears_bold: "unknown" as const };
      },
      async judgeNames() {
        throw new ExtractionError("no judgment", "AI judgment unavailable.");
      },
    };
    const r = await runVerification(provider, app, img);
    expect(r.verdict.tier).toBe("RED");
    expect(carefulCalls).toBe(1); // exactly one careful read, no more
    const warning = r.verdict.fields.find((f) => f.field === "Government warning");
    expect(warning?.explanation).toContain("Confirmed by a careful second read");
  });

  it("fast-read transcription noise is overturned by the careful read, no false RED", async () => {
    const provider: ModelProvider = {
      name: "fake",
      async extractLabel() {
        // fast read drops a character, transcription noise
        return goodExtraction({
          warning: {
            present: true,
            text: STATUTORY_WARNING.replace("Surgeon", "Surgon"),
            appears_bold: true,
          },
        });
      },
      async transcribeWarning() {
        return goodExtraction().warning; // careful read gets it right
      },
      async judgeNames() {
        throw new ExtractionError("no judgment", "AI judgment unavailable.");
      },
    };
    const r = await runVerification(provider, app, img);
    expect(r.verdict.tier).toBe("GREEN");
    const warning = r.verdict.fields.find((f) => f.field === "Government warning");
    expect(warning?.status).toBe("pass");
    expect(warning?.explanation).toContain("careful second read");
  });

  it("a passing warning never triggers the careful read", async () => {
    let carefulCalls = 0;
    const provider: ModelProvider = {
      name: "fake",
      async extractLabel() {
        return goodExtraction();
      },
      async transcribeWarning() {
        carefulCalls++;
        return goodExtraction().warning;
      },
      async judgeNames() {
        throw new ExtractionError("no judgment", "AI judgment unavailable.");
      },
    };
    await runVerification(provider, app, img);
    expect(carefulCalls).toBe(0);
  });

  it("class/type worded completely differently escalates to judgment, not auto-fail", async () => {
    const r = await runVerification(
      fakeProvider(goodExtraction({ class_type: "Table Beer" }), {
        same: true,
        rationale: "A style name and a consistent statement of composition.",
      }),
      { ...app, class_type: "Ale with brewed and added natural flavors" },
      img,
    );
    const ct = r.verdict.fields.find((f) => f.field === "Class / type");
    expect(ct?.status).toBe("review");
    expect(ct?.aiJudgment).toBe(true);
  });

  it("class/type judgment unavailable on differing wording → review, never silent fail", async () => {
    const r = await runVerification(
      fakeProvider(goodExtraction({ class_type: "Table Beer" })),
      { ...app, class_type: "Ale with brewed and added natural flavors" },
      img,
    );
    const ct = r.verdict.fields.find((f) => f.field === "Class / type");
    expect(ct?.status).toBe("review");
  });

  it("brand names that differ completely still auto-fail, no judgment call wasted", async () => {
    const r = await runVerification(
      fakeProvider(goodExtraction({ brand_name: "RIVERBEND WINERY" })),
      app,
      img,
    );
    const brand = r.verdict.fields.find((f) => f.field === "Brand name");
    expect(brand?.status).toBe("fail");
  });

  it("empty application field becomes review, not a crash", async () => {
    const r = await runVerification(
      fakeProvider(goodExtraction()),
      { ...app, brand_name: "" },
      img,
    );
    const brand = r.verdict.fields.find((f) => f.field === "Brand name");
    expect(brand?.status).toBe("review");
  });
});
