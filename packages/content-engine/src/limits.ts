/**
 * Character limits are configurable, not hard-coded assumptions about a
 * platform that changes its rules over time. 280 is the default local
 * UTF-16 code-unit ceiling, not a full implementation of X's weighted
 * Unicode/URL counter; X remains the final validator. Pass a different
 * local ceiling without touching template code.
 */
export interface ContentLimits {
  x: number;
}

export const DEFAULT_CONTENT_LIMITS: ContentLimits = {
  x: 280,
};
