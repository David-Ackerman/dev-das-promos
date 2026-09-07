# Deal engine

`packages/deal-engine` is the scoring brain of the platform. It is a pure,
framework-independent TypeScript package (no database, no HTTP, no queue) --
every function takes plain data in and returns plain data out, which is
what makes it exhaustively unit-testable (`packages/deal-engine/src/__tests__`)
and safe to re-run from the admin "Re-evaluate" action without side effects.

## Why "real" discount, not advertised discount

Marketplaces routinely inflate a "was" price to manufacture a bigger
percentage-off badge. Rather than trust that number, `calculateRealDiscount()`
(`packages/deal-engine/src/discount.ts`) compares the current price against
an **observed historical baseline**, preferring the widest, most reliable
window first:

1. **90-day average price** -- most representative of "normal" price.
   Confidence: `60 + min(sampleCount, 40)`, capped at 100.
2. **30-day average price** -- used only when 90-day history is too thin.
   Confidence: `35 + min(sampleCount, 25)`, capped at 70.
3. **Advertised original price** -- last resort, and the least trustworthy
   (it's the exact number we don't otherwise trust). Fixed confidence: 25.
4. **None available** -- discount is reported as 0% with confidence 0, and
   a `PRICE_HISTORY_INSUFFICIENT` signal is attached so downstream UI can
   show "not enough data" instead of a fabricated deal.

The advertised discount is still computed separately
(`calculateAdvertisedDiscount()`) and shown to admins for comparison, but it
never drives the score on its own -- see `discountScore()` below.

## Scoring formula

`scoreDeal()` (`packages/deal-engine/src/scoring.ts`) combines seven
components, each normalized to 0-100, with configurable weights
(`DEFAULT_DEAL_SCORE_WEIGHTS` in `packages/config/src/scoring-config.ts`):

| Component | Weight | What it measures |
|---|---|---|
| `historicalDiscount` | 0.30 | Real discount vs. the historical baseline above |
| `discount` | 0.20 | Advertised discount (falls back to the historical score if no advertised price) |
| `commission` | 0.15 | Affiliate commission rate for this offer |
| `seller` | 0.10 | Seller rating (0-100) |
| `popularity` | 0.10 | Popularity/demand proxy (sales rank, review volume) |
| `conversion` | 0.10 | Historical conversion rate for this product/category/channel |
| `freshness` | 0.05 | How recently the offer was captured |

```
score = historicalDiscount*0.30 + discount*0.20 + commission*0.15
      + seller*0.10 + popularity*0.10 + conversion*0.10 + freshness*0.05
```

Weights are a parameter, not a constant baked into the function -- passing
a different `DealScoreWeights` object re-scores with different priorities
without touching `deal-engine` itself (useful for A/B-testing scoring
strategies later; see `docs/roadmap.md`).

### Component curves

- **historicalDiscount / discount**: linear ramp, 0% off → 0, **40%+ off
  saturates to 100** (`scoreFromDiscountPercentage()`). If the current
  price is at or below the lowest price ever seen for this listing, the
  historical-discount score is forced to 100 regardless of the percentage,
  with signal `ALL_TIME_LOW` (all-time) or `LOWEST_PRICE_90D` (lowest in
  the 90-day window only).
- **commission**: linear ramp, **12% commission rate saturates to 100**.
  Missing rate defaults to 50 with signal `COMMISSION_RATE_UNKNOWN`.
  Score ≥ 80 attaches `HIGH_COMMISSION_CATEGORY`.
- **seller**: seller rating used directly (already 0-100). Missing
  defaults to 60 (`SELLER_RATING_UNKNOWN`); below 70 attaches
  `SELLER_RATING_LOW`.
- **popularity**: used directly (already 0-100). Missing defaults to 50
  (`POPULARITY_UNKNOWN`).
- **conversion**: linear ramp, **3% historical conversion rate saturates
  to 100**. Missing defaults to 50 (`CONVERSION_DATA_UNAVAILABLE`) -- see
  `apps/api/src/services/conversion-signal.ts` for how a real rate is
  derived once enough click/conversion data exists (20-click minimum
  before it's trusted).
- **freshness**: linear decay over 24 hours from `capturedAt` to `now` (a
  brand-new offer scores 100, a 24h+-old offer scores 0). Below 30
  attaches `STALE_OFFER`.

Every component returns both a score and zero or more human-readable
**signals** (e.g. `ALL_TIME_LOW`, `HIGH_COMMISSION_CATEGORY`,
`PRICE_HISTORY_INSUFFICIENT`) that are deduplicated and surfaced verbatim
in the admin UI and in a generated `reasoning` sentence
(`buildReasoning()`), so a human reviewer never has to reverse-engineer why
a deal scored the way it did.

## Approval thresholds

`applyApprovalThresholds()` (`packages/deal-engine/src/approval.ts`) maps
the final score to a `DealCandidate` status using
`DEFAULT_APPROVAL_THRESHOLDS` (`packages/config/src/scoring-config.ts`):

```
score >= 90                    -> auto_approved  (published without a human)
70 <= score < 90                -> pending        (queued for human review)
score < 70                      -> rejected
```

Both thresholds are configuration, not hardcoded branches, so they can be
tuned per environment (e.g. stricter in production while the model is
young) without a code change.

## Monetization estimate

`estimateMonetization()` (`packages/deal-engine/src/monetization.ts`)
gives every scored deal an expected-value estimate, using the standard
affiliate formula:

```
estimatedRevenue = impressions * CTR * conversionRate * price * commissionRate
estimatedEpc (earnings per click) = conversionRate * price * commissionRate
estimatedRevenuePer1000Impressions = 1000 * CTR * conversionRate * price * commissionRate
```

`conversionRate` prefers a real `historicalConversionRate` when available
(basis: `"historical"`); otherwise it falls back to a conservative default
of 2% CTR / 2% conversion (basis: `"heuristic"`) -- see
`DEFAULT_MONETIZATION_ASSUMPTIONS`. The `basis` field is always returned
alongside the numbers so nothing downstream mistakes a heuristic guess for
a measured figure.

## Confidence, not just a score

`confidenceScore` (0-100, tied to which baseline `calculateRealDiscount()`
used) is reported separately from the deal score itself. A deal can score
well but carry a low confidence (e.g. a great advertised discount with
only 3 days of price history) -- the admin UI shows both so a reviewer can
tell "trustworthy 75" from "unverified 75" at a glance.

## Testing

`packages/deal-engine/src/__tests__` covers discount baseline fallback
order, every component's saturation/default/signal behavior, full-formula
weight configurability, approval threshold boundaries, and monetization
basis switching -- run with `pnpm --filter @dev-das-promos/deal-engine test`.
