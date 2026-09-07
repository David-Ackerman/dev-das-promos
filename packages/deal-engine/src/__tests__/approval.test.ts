import { DEFAULT_APPROVAL_THRESHOLDS } from "@dev-das-promos/config";
import { describe, expect, it } from "vitest";
import { applyApprovalThresholds } from "../approval.js";

describe("applyApprovalThresholds", () => {
  it("auto-approves scores at or above the auto-approve threshold", () => {
    expect(applyApprovalThresholds(90, DEFAULT_APPROVAL_THRESHOLDS)).toBe("auto_approved");
    expect(applyApprovalThresholds(95, DEFAULT_APPROVAL_THRESHOLDS)).toBe("auto_approved");
    expect(applyApprovalThresholds(100, DEFAULT_APPROVAL_THRESHOLDS)).toBe("auto_approved");
  });

  it("sends scores in the review band to pending", () => {
    expect(applyApprovalThresholds(70, DEFAULT_APPROVAL_THRESHOLDS)).toBe("pending");
    expect(applyApprovalThresholds(89.9, DEFAULT_APPROVAL_THRESHOLDS)).toBe("pending");
  });

  it("rejects scores below the review threshold", () => {
    expect(applyApprovalThresholds(69.9, DEFAULT_APPROVAL_THRESHOLDS)).toBe("rejected");
    expect(applyApprovalThresholds(0, DEFAULT_APPROVAL_THRESHOLDS)).toBe("rejected");
  });

  it("respects custom thresholds instead of hard-coded values", () => {
    const custom = { autoApproveMinScore: 80, humanReviewMinScore: 50 };
    expect(applyApprovalThresholds(80, custom)).toBe("auto_approved");
    expect(applyApprovalThresholds(50, custom)).toBe("pending");
    expect(applyApprovalThresholds(49, custom)).toBe("rejected");
  });
});
