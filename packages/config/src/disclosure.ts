/**
 * Affiliate disclosure text, configurable per publication channel.
 * Kept as data (not sprinkled through content-engine templates) so legal/
 * compliance copy can be changed in one place.
 */
export const DISCLOSURE_TEXT: Record<"telegram" | "x" | "web", string> = {
  telegram: "📢 Link de afiliado — podemos receber uma comissão sem custo extra para você. #publi",
  x: "Link de afiliado #publi #ad",
  web: "Este site pode ganhar uma comissão de afiliado quando você compra através de nossos links, sem custo extra para você.",
};
