import { IngestButtons } from "@/components/ingest-button";
import { Nav } from "@/components/nav";
import { Card, CardTitle, CardValue } from "@/components/ui/card";
import { apiFetchServer } from "@/lib/api-server";
import { requireAdmin } from "@/lib/auth";
import { formatCentsBRL } from "@dev-das-promos/shared";

interface DashboardTotals {
  totalDeals: number;
  approvedDeals: number;
  publishedDeals: number;
  clicks: number;
  conversions: number;
  revenueCents: number;
  commissionCents: number;
  conversionRate: number | undefined;
  epcCents: number | undefined;
}

export default async function DashboardPage() {
  await requireAdmin();
  const { totals } = await apiFetchServer<{ totals: DashboardTotals }>("/admin/analytics");

  const cards: { label: string; value: string }[] = [
    { label: "Total deals", value: String(totals.totalDeals) },
    { label: "Approved deals", value: String(totals.approvedDeals) },
    { label: "Published deals", value: String(totals.publishedDeals) },
    { label: "Clicks", value: String(totals.clicks) },
    { label: "Conversions", value: String(totals.conversions) },
    { label: "Affiliate revenue", value: formatCentsBRL(totals.revenueCents) },
    { label: "Commission", value: formatCentsBRL(totals.commissionCents) },
    {
      label: "Conversion rate",
      value:
        totals.conversionRate !== undefined ? `${(totals.conversionRate * 100).toFixed(1)}%` : "—",
    },
    {
      label: "EPC (earnings/click)",
      value: totals.epcCents !== undefined ? formatCentsBRL(totals.epcCents) : "—",
    },
  ];

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <IngestButtons />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {cards.map((card) => (
            <Card key={card.label}>
              <CardTitle>{card.label}</CardTitle>
              <CardValue>{card.value}</CardValue>
            </Card>
          ))}
        </div>
        <p className="mt-6 text-sm text-neutral-500">
          CTR and true impression-based RPM aren&apos;t shown yet -- this MVP tracks clicks and
          conversions, not ad impressions. See docs/analytics.md.
        </p>
      </main>
    </div>
  );
}
