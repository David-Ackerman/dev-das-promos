import { describe, expect, it } from "vitest";
import { QUEUE_NAMES } from "../queue-names.js";

describe("QUEUE_NAMES", () => {
  it("defines the exact expected set of keys and values", () => {
    expect(QUEUE_NAMES).toEqual({
      offerIngestion: "offer-ingestion",
      dealEvaluation: "deal-evaluation",
      contentGeneration: "content-generation",
      publication: "publication",
      analyticsProcessing: "analytics-processing",
      scheduledPublish: "scheduled-publish",
    });
  });

  it("has all unique string values", () => {
    const values = Object.values(QUEUE_NAMES);
    expect(values).toHaveLength(new Set(values).size);
    for (const value of values) {
      expect(typeof value).toBe("string");
    }
  });
});
