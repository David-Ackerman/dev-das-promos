import { Disclosure } from "@/components/disclosure";
import { Nav } from "@/components/nav";
import { ScoreBadge } from "@/components/score-badge";
import { apiGet } from "@/lib/api";
import { formatCentsBRL } from "@dev-das-promos/shared";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

interface ProductListing {
  marketplaceProductId: string;
  marketplace: string;
  sellerName: string | null;
  sellerRating: number | null;
  dealSlug: string;
  dealScore: number;
  dealStatus: string;
  effectivePriceCents: number;
  currency: string;
  scoreLabel: string;
  priceHistory: {
    avg90dCents?: number;
    historicalMinCents?: number;
  };
}

interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  description: string | null;
  imageUrl: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  listings: ProductListing[];
}

const MARKETPLACE_LABEL: Record<string, string> = {
  amazon_br: "Amazon Brasil",
  shopee_br: "Shopee Brasil",
  mercado_livre: "Mercado Livre",
};

async function getProduct(slug: string) {
  return apiGet<ProductDetail>(`/public/products/${encodeURIComponent(slug)}`);
}

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return {};

  return {
    title: product.name,
    description:
      product.description ??
      `Compare preços e ofertas de ${product.name} na Amazon Brasil e Shopee Brasil com histórico de preço verificado.`,
    alternates: { canonical: `/product/${encodeURIComponent(product.slug)}` },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();

  const listings = product.listings.filter((l) => l.dealStatus === "published");
  const sorted = [...listings].sort((a, b) => a.effectivePriceCents - b.effectivePriceCents);

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-10">
        {product.categoryName && product.categorySlug && (
          <Link
            href={`/category/${encodeURIComponent(product.categorySlug)}`}
            className="text-sm text-neutral-500 hover:underline"
          >
            {product.categoryName}
          </Link>
        )}

        <div className="mt-2 grid gap-8 md:grid-cols-2">
          <div className="card relative aspect-square bg-white">
            {product.imageUrl && (
              <Image
                src={product.imageUrl}
                alt={product.name}
                fill
                className="object-contain p-6"
                referrerPolicy="no-referrer"
                unoptimized
              />
            )}
          </div>

          <div>
            <h1 className="text-2xl font-bold">{product.name}</h1>
            {product.brand && <p className="text-sm text-neutral-500">{product.brand}</p>}
            {product.description && (
              <p className="mt-3 text-sm text-neutral-600">{product.description}</p>
            )}
          </div>
        </div>

        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">Comparar preços</h2>
          <div className="mb-4">
            <Disclosure />
          </div>

          {sorted.length === 0 && (
            <p className="text-neutral-500">Nenhuma oferta disponível no momento.</p>
          )}

          <div className="flex flex-col gap-3">
            {sorted.map((listing, index) => (
              <Link
                key={listing.marketplaceProductId}
                href={`/deal/${encodeURIComponent(listing.dealSlug)}`}
                className="card flex items-center justify-between p-4 transition hover:shadow-md"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {MARKETPLACE_LABEL[listing.marketplace] ?? listing.marketplace}
                    </span>
                    {index === 0 && sorted.length > 1 && (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        Menor preço
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">
                    {listing.sellerName
                      ? `Vendido por ${listing.sellerName}`
                      : "Vendedor não informado"}
                    {listing.sellerRating !== null
                      ? ` · avaliação ${listing.sellerRating}/100`
                      : ""}
                  </p>
                  {listing.priceHistory.historicalMinCents !== undefined && (
                    <p className="mt-1 text-xs text-neutral-500">
                      Menor preço já visto:{" "}
                      {formatCentsBRL(listing.priceHistory.historicalMinCents)}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold">
                    {formatCentsBRL(listing.effectivePriceCents)}
                  </span>
                  <ScoreBadge score={listing.dealScore} label={listing.scoreLabel} />
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
