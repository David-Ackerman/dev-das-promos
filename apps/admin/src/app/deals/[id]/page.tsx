import { DealActions } from "@/components/deal-actions";
import { Nav } from "@/components/nav";
import { ScoreBreakdown } from "@/components/score-breakdown";
import { Badge } from "@/components/ui/badge";
import { apiFetchServer } from "@/lib/api-server";
import { requireAdmin } from "@/lib/auth";
import { formatCentsBRL } from "@dev-das-promos/shared";

interface PublicationRow {
  id: string;
  channel: string;
  status: string;
  content: string | null;
  publishedAt: string | null;
  externalPublicationId: string | null;
}

interface DealDetail {
  dealCandidateId: string;
  slug: string;
  dealScore: number;
  scoreLabel: string;
  realDiscountPercentage: number;
  advertisedDiscountPercentage: number | null;
  historicalPriceScore: number;
  discountScore: number;
  commissionScore: number;
  sellerScore: number;
  popularityScore: number;
  conversionScore: number;
  freshnessScore: number;
  confidenceScore: number;
  estimatedEpcCents: number;
  estimatedRevenuePer1000ImpressionsCents: number;
  estimateBasis: string;
  signals: string[];
  reasoning: string | null;
  status: string;
  effectivePriceCents: number;
  originalPriceCents: number | null;
  currency: string;
  marketplace: string;
  sellerName: string | null;
  sellerRating: number | null;
  productName: string;
  brand: string | null;
  history: {
    avg30dCents?: number;
    avg90dCents?: number;
    min90dCents?: number;
    historicalMinCents?: number;
    sampleCount: number;
  };
  publications: PublicationRow[];
}

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const deal = await apiFetchServer<DealDetail>(`/admin/deals/${id}`);

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">{deal.productName}</h1>
            <Badge status={deal.status}>{deal.status}</Badge>
          </div>
          <p className="text-sm text-neutral-400">
            {deal.marketplace} {deal.sellerName ? `· sold by ${deal.sellerName}` : ""}
            {deal.brand ? ` · ${deal.brand}` : ""}
          </p>
        </div>

        <div className="card grid grid-cols-2 gap-6 p-6 md:grid-cols-4">
          <div>
            <div className="text-xs text-neutral-500">Price</div>
            <div className="text-lg font-semibold">{formatCentsBRL(deal.effectivePriceCents)}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Real discount</div>
            <div className="text-lg font-semibold">{deal.realDiscountPercentage.toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Est. EPC</div>
            <div className="text-lg font-semibold">
              {formatCentsBRL(deal.estimatedEpcCents)}{" "}
              <span className="text-xs font-normal text-neutral-500">({deal.estimateBasis})</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Est. RPM</div>
            <div className="text-lg font-semibold">
              {formatCentsBRL(deal.estimatedRevenuePer1000ImpressionsCents)}
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="mb-4 flex items-baseline gap-3">
            <h2 className="text-2xl font-bold">Deal Score: {deal.dealScore.toFixed(0)}</h2>
            <span className="text-neutral-400">{deal.scoreLabel}</span>
            <span className="text-xs text-neutral-500">
              confidence {deal.confidenceScore.toFixed(0)}/100
            </span>
          </div>
          <ScoreBreakdown
            components={{
              historicalDiscount: deal.historicalPriceScore,
              discount: deal.discountScore,
              commission: deal.commissionScore,
              seller: deal.sellerScore,
              popularity: deal.popularityScore,
              conversion: deal.conversionScore,
              freshness: deal.freshnessScore,
            }}
          />
          {deal.reasoning && <p className="mt-4 text-sm text-neutral-400">{deal.reasoning}</p>}
          {deal.signals.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {deal.signals.map((s) => (
                <span
                  key={s}
                  className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="card p-6">
          <h2 className="mb-3 text-sm font-medium text-neutral-400">Price history</h2>
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <div className="text-xs text-neutral-500">30d avg</div>
              <div>{deal.history.avg30dCents ? formatCentsBRL(deal.history.avg30dCents) : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">90d avg</div>
              <div>{deal.history.avg90dCents ? formatCentsBRL(deal.history.avg90dCents) : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">90d min</div>
              <div>{deal.history.min90dCents ? formatCentsBRL(deal.history.min90dCents) : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">All-time min</div>
              <div>
                {deal.history.historicalMinCents
                  ? formatCentsBRL(deal.history.historicalMinCents)
                  : "—"}
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            {deal.history.sampleCount} price observations
          </p>
        </div>

        <div className="card p-6">
          <h2 className="mb-3 text-sm font-medium text-neutral-400">Actions</h2>
          <DealActions dealId={deal.dealCandidateId} status={deal.status} />
        </div>

        {deal.publications.length > 0 && (
          <div className="card p-6">
            <h2 className="mb-3 text-sm font-medium text-neutral-400">Publications</h2>
            <div className="space-y-3">
              {deal.publications.map((pub) => (
                <div key={pub.id} className="rounded-md border border-neutral-800 p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{pub.channel}</span>
                    <Badge status={pub.status}>{pub.status}</Badge>
                  </div>
                  {pub.content && (
                    <pre className="mt-2 whitespace-pre-wrap text-xs text-neutral-400">
                      {pub.content}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
