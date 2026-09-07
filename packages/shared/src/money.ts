/**
 * All monetary values in this system are integer cents (BRL). Never use
 * floating point for money: floats accumulate rounding error across price
 * history aggregation and revenue math. `Cents` is a branded alias purely
 * for readability at call sites; it is still a plain number at runtime.
 */
export type Cents = number;

export function toCents(amount: number): Cents {
  return Math.round(amount * 100);
}

export function fromCents(cents: Cents): number {
  return cents / 100;
}

/** Formats cents as a BRL currency string, e.g. 129990 -> "R$ 1.299,90". */
export function formatCentsBRL(cents: Cents): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    fromCents(cents),
  );
}

export function percentageOff(fromPrice: Cents, toPrice: Cents): number {
  if (fromPrice <= 0) return 0;
  const diff = fromPrice - toPrice;
  return clamp((diff / fromPrice) * 100, 0, 100);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function roundTo(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
