import { DealCard, type DealCardData } from "@/components/deal-card";
import { Disclosure } from "@/components/disclosure";
import { Nav } from "@/components/nav";
import { apiGet } from "@/lib/api";
import type { Metadata } from "next";

// The API is only needed when a visitor requests the page, not during a build.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function HomePage() {
  const data = await apiGet<{ deals: DealCardData[] }>("/public/deals?pageSize=12");
  const deals = data?.deals ?? [];

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Ofertas verificadas por histórico de preço</h1>
          <p className="mt-2 max-w-2xl text-neutral-600">
            Cada oferta é comparada com a média de preço dos últimos 90 dias antes de entrar no site
            -- nada de desconto inflado.
          </p>
        </div>

        <div className="mb-4">
          <Disclosure />
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {deals.map((deal) => (
            <DealCard key={deal.slug} deal={deal} />
          ))}
        </div>

        {deals.length === 0 && <p className="text-neutral-500">Nenhuma oferta publicada ainda.</p>}
      </main>
    </div>
  );
}
