import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "das promos — melhores ofertas com preço verificado",
    template: "%s · das promos",
  },
  description: "Ofertas com histórico de preço verificado em Amazon Brasil e Shopee Brasil.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-white text-neutral-900">{children}</body>
    </html>
  );
}
