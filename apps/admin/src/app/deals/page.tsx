import { Nav } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { apiFetchServer } from "@/lib/api-server";
import { requireAdmin } from "@/lib/auth";
import { formatCentsBRL } from "@dev-das-promos/shared";
import Link from "next/link";

interface DealRow {
  id: string;
  slug: string;
  dealScore: number;
  realDiscountPercentage: number;
  commissionScore: number;
  status: string;
  createdAt: string;
  productName: string;
  marketplace: string;
  priceCents: number;
}

const STATUS_FILTERS = [
  "all",
  "pending",
  "approved",
  "auto_approved",
  "rejected",
  "published",
  "expired",
] as const;

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;
  const query = status && status !== "all" ? `?status=${status}` : "";

  const { deals, total } = await apiFetchServer<{ deals: DealRow[]; total: number }>(
    `/admin/deals${query}`,
  );

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Deals ({total})</h1>
          <div className="flex gap-2 text-sm">
            {STATUS_FILTERS.map((s) => (
              <Link
                key={s}
                href={s === "all" ? "/deals" : `/deals?status=${s}`}
                className={`rounded-md px-2 py-1 ${status === s || (!status && s === "all") ? "bg-blue-600 text-white" : "text-neutral-400 hover:bg-neutral-800"}`}
              >
                {s}
              </Link>
            ))}
          </div>
        </div>

        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-800 text-left text-neutral-400">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Marketplace</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Real discount</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((deal) => (
                <tr key={deal.id} className="border-b border-neutral-900 hover:bg-neutral-900/50">
                  <td className="px-4 py-3">
                    <Link href={`/deals/${deal.id}`} className="text-blue-400 hover:underline">
                      {deal.productName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral-400">{deal.marketplace}</td>
                  <td className="px-4 py-3">{formatCentsBRL(deal.priceCents)}</td>
                  <td className="px-4 py-3">{deal.realDiscountPercentage.toFixed(0)}%</td>
                  <td className="px-4 py-3 font-medium">{deal.dealScore.toFixed(0)}</td>
                  <td className="px-4 py-3">
                    <Badge status={deal.status}>{deal.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-neutral-500">
                    {new Date(deal.createdAt).toLocaleDateString("pt-BR")}
                  </td>
                </tr>
              ))}
              {deals.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                    No deals yet -- trigger ingestion to generate some.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
