import { describe, it, expect } from "vitest";
import {
  normalizePropertyName,
  buildPipelineNameSet,
  isAlreadyInPipeline,
} from "@/lib/pipelineDuplicates";

describe("normalizePropertyName", () => {
  it("lowercases, trims and collapses inner whitespace", () => {
    expect(normalizePropertyName("  The   Seneca   Apartments ")).toBe("the seneca apartments");
  });

  it("treats empty and whitespace-only names as absent", () => {
    expect(normalizePropertyName("")).toBeNull();
    expect(normalizePropertyName("   ")).toBeNull();
    expect(normalizePropertyName(null)).toBeNull();
    expect(normalizePropertyName(undefined)).toBeNull();
  });
});

describe("isAlreadyInPipeline", () => {
  const pipeline = buildPipelineNameSet([
    { property_name: "Atrio Apartments" },
    { property_name: "  The Seneca Apartments  " },
    { property_name: null },
    { property_name: "" },
  ]);

  it("flags a deal whose name matches regardless of case and spacing", () => {
    expect(isAlreadyInPipeline("atrio   APARTMENTS", pipeline)).toBe(true);
    expect(isAlreadyInPipeline("The Seneca Apartments", pipeline)).toBe(true);
  });

  it("does not flag a deal that is not in the pipeline", () => {
    expect(isAlreadyInPipeline("Coffey Creek", pipeline)).toBe(false);
  });

  it("never flags a deal with no usable name, even though the pipeline has blanks", () => {
    expect(isAlreadyInPipeline(null, pipeline)).toBe(false);
    expect(isAlreadyInPipeline("   ", pipeline)).toBe(false);
  });

  it("does not match on a partial or substring name", () => {
    expect(isAlreadyInPipeline("Atrio", pipeline)).toBe(false);
    expect(isAlreadyInPipeline("Atrio Apartments II", pipeline)).toBe(false);
  });
});
