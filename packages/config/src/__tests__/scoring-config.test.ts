import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPROVAL_THRESHOLDS,
  DEFAULT_DEAL_SCORE_WEIGHTS,
  DEFAULT_SCORE_LABELS,
  approvalThresholdsSchema,
  dealScoreWeightsSchema,
  getScoreLabel,
  scoreLabelSchema,
} from "../scoring-config.js";

describe("dealScoreWeightsSchema", () => {
  it("accepts the default weights", () => {
    expect(dealScoreWeightsSchema.safeParse(DEFAULT_DEAL_SCORE_WEIGHTS).success).toBe(true);
  });

  it("rejects a weight outside the 0-1 range", () => {
    const invalid = { ...DEFAULT_DEAL_SCORE_WEIGHTS, discount: 1.5 };
    expect(dealScoreWeightsSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a config missing a required weight", () => {
    const { freshness, ...missingFreshness } = DEFAULT_DEAL_SCORE_WEIGHTS;
    expect(dealScoreWeightsSchema.safeParse(missingFreshness).success).toBe(false);
  });
});

describe("approvalThresholdsSchema", () => {
  it("accepts the default thresholds", () => {
    expect(approvalThresholdsSchema.safeParse(DEFAULT_APPROVAL_THRESHOLDS).success).toBe(true);
  });

  it("rejects a score outside the 0-100 range", () => {
    const invalid = { autoApproveMinScore: 150, humanReviewMinScore: 70 };
    expect(approvalThresholdsSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("scoreLabelSchema", () => {
  it("accepts every default score label", () => {
    for (const label of DEFAULT_SCORE_LABELS) {
      expect(scoreLabelSchema.safeParse(label).success).toBe(true);
    }
  });
});

describe("getScoreLabel", () => {
  it("labels a top score as exceptional", () => {
    expect(getScoreLabel(95)).toBe("Exceptional deal");
  });

  it("labels a score at the exact threshold with that threshold's label", () => {
    expect(getScoreLabel(90)).toBe("Exceptional deal");
    expect(getScoreLabel(80)).toBe("Great deal");
    expect(getScoreLabel(70)).toBe("Good deal");
    expect(getScoreLabel(50)).toBe("Average");
  });

  it("labels a low score as a weak deal", () => {
    expect(getScoreLabel(10)).toBe("Weak deal");
  });

  it("labels a score of zero as a weak deal", () => {
    expect(getScoreLabel(0)).toBe("Weak deal");
  });

  it("supports custom label sets", () => {
    const customLabels = [
      { minScore: 50, label: "High" },
      { minScore: 0, label: "Low" },
    ];
    expect(getScoreLabel(75, customLabels)).toBe("High");
    expect(getScoreLabel(25, customLabels)).toBe("Low");
  });

  it("does not depend on the input order of the label set", () => {
    const shuffled = [...DEFAULT_SCORE_LABELS].reverse();
    expect(getScoreLabel(85, shuffled)).toBe("Great deal");
  });

  it("falls back to the lowest label's value when score is below every minScore", () => {
    const noZeroFloor = [
      { minScore: 90, label: "High" },
      { minScore: 50, label: "Mid" },
    ];
    expect(getScoreLabel(10, noZeroFloor)).toBe("Mid");
  });
});
