export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

export const XML_CACHE_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=300",
};
