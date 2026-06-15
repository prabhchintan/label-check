import { describe, expect, it } from "vitest";
import { assembleVerdict } from "./verdict";
import type { FieldResult } from "./types";

const f = (field: string, status: FieldResult["status"]): FieldResult => ({
  field,
  status,
  application: "x",
  label: "x",
  explanation: "",
});

describe("verdict assembly", () => {
  it("GREEN when everything passes", () => {
    const v = assembleVerdict([f("Brand name", "pass"), f("ABV", "pass")]);
    expect(v.tier).toBe("GREEN");
  });

  it("YELLOW when something needs review", () => {
    const v = assembleVerdict([f("Brand name", "pass"), f("Warning", "review")]);
    expect(v.tier).toBe("YELLOW");
    expect(v.summary.toLowerCase()).toContain("warning");
  });

  it("RED on any failure, even with reviews present", () => {
    const v = assembleVerdict([
      f("Brand name", "review"),
      f("ABV", "fail"),
      f("Net contents", "pass"),
    ]);
    expect(v.tier).toBe("RED");
    expect(v.summary.toLowerCase()).toContain("abv");
  });

  it("RED on missing mandatory element", () => {
    expect(assembleVerdict([f("Government warning", "missing")]).tier).toBe(
      "RED",
    );
  });

  it("does not return GREEN when no checks ran (empty field set)", () => {
    const v = assembleVerdict([]);
    expect(v.tier).not.toBe("GREEN");
    expect(v.summary.toLowerCase()).toContain("no checks");
  });
});
