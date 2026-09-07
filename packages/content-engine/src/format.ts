export function formatCents(cents: number, currency: string): string {
  const locale = currency === "BRL" ? "pt-BR" : "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}
