import { formatCentsBRL } from "@dev-das-promos/shared";
import Image from "next/image";
import Link from "next/link";
import { ScoreBadge } from "./score-badge";

export interface DealCardData {
  slug: string;
  productName: string;
  imageUrl: string | null;
  marketplace: string;
  effectivePriceCents: number;
  realDiscountPercentage: number;
  dealScore: number;
  scoreLabel: string;
}

const MARKETPLACE_LABEL: Record<string, string> = {
  amazon_br: "Amazon BR",
  shopee_br: "Shopee BR",
  mercado_livre: "Mercado Livre",
};

export function DealCard({ deal }: { deal: DealCardData }) {
  return (
    <Link
      href={`/deal/${deal.slug}`}
      className="card flex flex-col overflow-hidden transition hover:shadow-md"
    >
      <div className="relative aspect-square bg-white">
        {deal.imageUrl && (
          <Image
            src={deal.imageUrl}
            alt={deal.productName}
            fill
            className="object-contain p-4"
            unoptimized
          />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <span className="text-xs text-neutral-500">
          {MARKETPLACE_LABEL[deal.marketplace] ?? deal.marketplace}
        </span>
        <h3 className="line-clamp-2 text-sm font-medium">{deal.productName}</h3>
        <div className="mt-auto flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">{formatCentsBRL(deal.effectivePriceCents)}</div>
            {deal.realDiscountPercentage > 0 && (
              <div className="text-xs font-medium text-emerald-700">
                -{deal.realDiscountPercentage.toFixed(0)}%
              </div>
            )}
          </div>
          <ScoreBadge score={deal.dealScore} label={deal.scoreLabel} />
        </div>
      </div>
    </Link>
  );
}
