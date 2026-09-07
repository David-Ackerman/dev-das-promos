import { QueryProvider } from "@/components/query-provider";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "das-promos admin",
  description: "Internal deal review dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
