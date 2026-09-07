/**
 * Character limits are configurable, not hard-coded assumptions about a
 * platform that changes its rules over time. 280 is X's current default
 * limit at the time of writing; pass a different value (e.g. for a
 * Premium/longer-form account) without touching template code.
 */
export interface ContentLimits {
  x: number;
}

export const DEFAULT_CONTENT_LIMITS: ContentLimits = {
  x: 280,
};
