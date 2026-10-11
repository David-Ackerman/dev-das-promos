import { SITE_URL } from "@/lib/api";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: {
    default: "das promos — melhores ofertas com preço verificado",
    template: "%s · das promos",
  },
  description: "Ofertas com histórico de preço verificado em Amazon Brasil e Shopee Brasil.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-white text-neutral-900">
        {children}
        <footer className="border-t border-neutral-200">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-5 text-sm text-neutral-600">
            <span>das promos · ofertas com preço verificado</span>
            <a href="/privacy" className="hover:text-neutral-950">
              Privacidade
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
