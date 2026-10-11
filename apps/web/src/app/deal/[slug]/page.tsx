import { Disclosure } from "@/components/disclosure";
import { Nav } from "@/components/nav";
import { PriceChart, type PricePoint } from "@/components/price-chart";
import { ScoreBadge } from "@/components/score-badge";
import { apiGet, apiGoUrl } from "@/lib/api";
import { formatCentsBRL } from "@dev-das-promos/shared";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

interface DealDetail {
  dealCandidateId: string;
  slug: string;
  dealScore: number;
  scoreLabel: string;
  realDiscountPercentage: number;
  effectivePriceCents: number;
  originalPriceCents: number | null;
  currency: string;
  marketplace: string;
  sellerName: string | null;
  sellerRating: number | null;
  productName: string;
  brand: string | null;
  imageUrl: string | null;
  description: string | null;
  reasoning: string | null;
  signals: string[];
  redirectCode: string | undefined;
  history: {
    avg7dCents?: number;
    avg30dCents?: number;
    avg90dCents?: number;
    min90dCents?: number;
    historicalMinCents?: number;
  };
}

const MARKETPLACE_LABEL: Record<string, string> = {
  amazon_br: "Amazon Brasil",
  shopee_br: "Shopee Brasil",
  mercado_livre: "Mercado Livre",
};

async function getDeal(slug: string) {
  return apiGet<DealDetail>(`/public/deals/${encodeURIComponent(slug)}`);
}

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const deal = await getDeal(slug);
  if (!deal) return {};

  return {
    title: `${deal.productName} — ${formatCentsBRL(deal.effectivePriceCents)}`,
    description: `${deal.productName} por ${formatCentsBRL(deal.effectivePriceCents)} na ${MARKETPLACE_LABEL[deal.marketplace] ?? deal.marketplace}. Nota da oferta: ${deal.dealScore.toFixed(0)}/100.`,
    alternates: { canonical: `/deal/${encodeURIComponent(deal.slug)}` },
  };
}

export default async function DealPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const deal = await getDeal(slug);
  if (!deal) notFound();

  const priceHistory = await apiGet<{ points: PricePoint[] }>(
    `/public/deals/${encodeURIComponent(slug)}/price-history?range=90d`,
  );

  const baseline = deal.history.avg90dCents ?? deal.history.avg30dCents;

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="card relative aspect-square bg-white">
            {deal.imageUrl && (
              <Image
                src={deal.imageUrl}
                alt={deal.productName}
                fill
                className="object-contain p-6"
                referrerPolicy="no-referrer"
                unoptimized
              />
            )}
          </div>

          <div>
            <span className="text-sm text-neutral-500">
              {MARKETPLACE_LABEL[deal.marketplace] ?? deal.marketplace}
            </span>
            <h1 className="mt-1 text-2xl font-bold">{deal.productName}</h1>
            {deal.brand && <p className="text-sm text-neutral-500">{deal.brand}</p>}

            <div className="mt-4 flex items-center gap-3">
              <span className="text-3xl font-extrabold">
                {formatCentsBRL(deal.effectivePriceCents)}
              </span>
              {deal.originalPriceCents && deal.originalPriceCents > deal.effectivePriceCents && (
                <span className="text-neutral-400 line-through">
                  {formatCentsBRL(deal.originalPriceCents)}
                </span>
              )}
            </div>

            {baseline && (
              <p className="mt-1 text-sm text-neutral-600">
                Preço típico: {formatCentsBRL(baseline)} ({deal.realDiscountPercentage.toFixed(0)}%
                abaixo)
              </p>
            )}

            <div className="mt-4">
              <ScoreBadge score={deal.dealScore} label={deal.scoreLabel} />
            </div>

            {deal.reasoning && <p className="mt-3 text-sm text-neutral-600">{deal.reasoning}</p>}

            <p className="mt-3 text-sm text-neutral-500">
              {deal.sellerName ? `Vendido por ${deal.sellerName}` : "Vendedor não informado"}
              {deal.sellerRating !== null ? ` · avaliação ${deal.sellerRating}/100` : ""}
            </p>

            <div className="mt-4">
              <Disclosure />
            </div>

            {deal.redirectCode && (
              <a
                href={apiGoUrl(deal.redirectCode)}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="mt-6 inline-flex items-center justify-center rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Ver oferta na {MARKETPLACE_LABEL[deal.marketplace] ?? deal.marketplace}
              </a>
            )}
          </div>
        </div>

        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">Histórico de preço (90 dias)</h2>
          <div className="card p-4">
            <PriceChart points={priceHistory?.points ?? []} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <PriceInsight label="Média 7d" value={deal.history.avg7dCents} />
            <PriceInsight label="Média 30d" value={deal.history.avg30dCents} />
            <PriceInsight label="Média 90d" value={deal.history.avg90dCents} />
            <PriceInsight label="Menor preço já visto" value={deal.history.historicalMinCents} />
          </div>
        </section>
      </main>
    </div>
  );
}

function PriceInsight({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="font-medium">{value ? formatCentsBRL(value) : "—"}</div>
    </div>
  );
}
