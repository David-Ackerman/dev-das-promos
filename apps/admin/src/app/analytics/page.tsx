import { Nav } from "@/components/nav";
import { apiFetchServer } from "@/lib/api-server";
import { requireAdmin } from "@/lib/auth";
import { formatCentsBRL } from "@dev-das-promos/shared";

interface GroupRow {
  key: string;
  label: string;
  clicks: number;
  conversions: number;
  revenueCents: number;
  commissionCents: number;
  conversionRate?: number;
  epcCents?: number;
}

interface AnalyticsResponse {
  totals: {
    totalDeals: number;
    approvedDeals: number;
    publishedDeals: number;
    clicks: number;
    conversions: number;
    revenueCents: number;
    commissionCents: number;
  };
  grouped?: GroupRow[];
}

const DIMENSIONS = ["channel", "marketplace", "category", "deal", "date"] as const;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ dimension?: string }>;
}) {
  await requireAdmin();
  const { dimension: dimensionParam } = await searchParams;
  const dimension = DIMENSIONS.includes(dimensionParam as (typeof DIMENSIONS)[number])
    ? dimensionParam
    : "channel";

  const { totals, grouped } = await apiFetchServer<AnalyticsResponse>(
    `/admin/analytics?dimension=${dimension}`,
  );

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="mb-2 text-xl font-semibold">Analytics</h1>
        <p className="mb-6 text-sm text-neutral-400">
          {totals.clicks} clicks · {totals.conversions} conversions ·{" "}
          {formatCentsBRL(totals.revenueCents)} revenue · {formatCentsBRL(totals.commissionCents)}{" "}
          commission
        </p>

        <div className="mb-4 flex gap-2 text-sm">
          {DIMENSIONS.map((d) => (
            <a
              key={d}
              href={`/analytics?dimension=${d}`}
              className={`rounded-md px-2 py-1 ${dimension === d ? "bg-blue-600 text-white" : "text-neutral-400 hover:bg-neutral-800"}`}
            >
              by {d}
            </a>
          ))}
        </div>

        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-800 text-left text-neutral-400">
              <tr>
                <th className="px-4 py-3 capitalize">{dimension}</th>
                <th className="px-4 py-3">Clicks</th>
                <th className="px-4 py-3">Conversions</th>
                <th className="px-4 py-3">Conv. rate</th>
                <th className="px-4 py-3">EPC</th>
                <th className="px-4 py-3">Revenue</th>
                <th className="px-4 py-3">Commission</th>
              </tr>
            </thead>
            <tbody>
              {(grouped ?? []).map((row) => (
                <tr key={row.key} className="border-b border-neutral-900">
                  <td className="px-4 py-3">{row.label}</td>
                  <td className="px-4 py-3">{row.clicks}</td>
                  <td className="px-4 py-3">{row.conversions}</td>
                  <td className="px-4 py-3">
                    {row.conversionRate !== undefined
                      ? `${(row.conversionRate * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {row.epcCents !== undefined ? formatCentsBRL(row.epcCents) : "—"}
                  </td>
                  <td className="px-4 py-3">{formatCentsBRL(row.revenueCents)}</td>
                  <td className="px-4 py-3">{formatCentsBRL(row.commissionCents)}</td>
                </tr>
              ))}
              {(grouped ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                    No data yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-neutral-500">
          Channel-level revenue/commission is not attributable in this MVP (conversions aren&apos;t
          tagged with a channel yet) -- see docs/analytics.md.
        </p>
      </main>
    </div>
  );
}
