import { DealCard, type DealCardData } from "@/components/deal-card";
import { Disclosure } from "@/components/disclosure";
import { Nav } from "@/components/nav";
import { apiGet } from "@/lib/api";
import { PUBLIC_DEALS_MAX_PAGE } from "@dev-das-promos/config";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Todas as ofertas",
  alternates: { canonical: "/deals" },
};
const PAGE_SIZE = 24;
const FETCH_PAGE_SIZE = PAGE_SIZE + 1;
const MAX_PAGE = PUBLIC_DEALS_MAX_PAGE;

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const requestedPage = Number(page ?? "1");
  const pageNum =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= MAX_PAGE
      ? requestedPage
      : 1;

  const data = await apiGet<{ deals: DealCardData[] }>(
    `/public/deals?page=${pageNum}&pageSize=${FETCH_PAGE_SIZE}`,
  );
  const deals = data?.deals ?? [];
  const visibleDeals = deals.slice(0, PAGE_SIZE);
  const hasPreviousPage = pageNum > 1;
  const hasNextPage = pageNum < MAX_PAGE && deals.length > PAGE_SIZE;

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="mb-6 text-2xl font-bold">Todas as ofertas</h1>
        <div className="mb-4">
          <Disclosure />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {visibleDeals.map((deal) => (
            <DealCard key={deal.slug} deal={deal} />
          ))}
        </div>
        {deals.length === 0 && <p className="text-neutral-500">Nenhuma oferta nesta página.</p>}
        {(hasPreviousPage || hasNextPage) && (
          <nav aria-label="Paginação de ofertas" className="mt-8 flex justify-between">
            {hasPreviousPage ? (
              <Link
                href={`/deals?page=${pageNum - 1}`}
                rel="prev"
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
              >
                Ofertas anteriores
              </Link>
            ) : (
              <span />
            )}
            {hasNextPage && (
              <Link
                href={`/deals?page=${pageNum + 1}`}
                rel="next"
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
              >
                Mais ofertas
              </Link>
            )}
          </nav>
        )}
      </main>
    </div>
  );
}
