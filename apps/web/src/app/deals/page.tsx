import { DealCard, type DealCardData } from "@/components/deal-card";
import { Disclosure } from "@/components/disclosure";
import { Nav } from "@/components/nav";
import { apiGet } from "@/lib/api";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "All deals" };

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const pageNum = Number(page ?? "1") || 1;

  const data = await apiGet<{ deals: DealCardData[] }>(`/public/deals?page=${pageNum}&pageSize=24`);
  const deals = data?.deals ?? [];

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="mb-6 text-2xl font-bold">All deals</h1>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {deals.map((deal) => (
            <DealCard key={deal.slug} deal={deal} />
          ))}
        </div>
        {deals.length === 0 && <p className="text-neutral-500">No deals on this page.</p>}
        <div className="mt-10">
          <Disclosure />
        </div>
      </main>
    </div>
  );
}
