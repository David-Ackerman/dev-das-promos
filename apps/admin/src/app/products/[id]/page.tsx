import { Nav } from "@/components/nav";
import { apiFetchServer } from "@/lib/api-server";
import { requireAdmin } from "@/lib/auth";
import { formatCentsBRL } from "@dev-das-promos/shared";

interface Listing {
  id: string;
  marketplace: string;
  url: string;
  sellerName: string | null;
  sellerRating: number | null;
  priceHistory: {
    currentEffectivePriceCents?: number;
    avg30dCents?: number;
    avg90dCents?: number;
    historicalMinCents?: number;
  };
}

interface ProductDetail {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  categoryName: string | null;
  listings: Listing[];
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const product = await apiFetchServer<ProductDetail>(`/admin/products/${id}`);

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        <div>
          <h1 className="text-xl font-semibold">{product.name}</h1>
          <p className="text-sm text-neutral-400">
            {product.brand ?? "—"} · {product.categoryName ?? "Uncategorized"}
          </p>
        </div>
        {product.description && <p className="text-sm text-neutral-400">{product.description}</p>}

        <div className="space-y-3">
          {product.listings.map((listing) => (
            <div key={listing.id} className="card p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{listing.marketplace}</span>
                <a
                  href={listing.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-400 hover:underline"
                >
                  View listing
                </a>
              </div>
              <p className="text-xs text-neutral-500">
                {listing.sellerName ?? "Unknown seller"}
                {listing.sellerRating !== null ? ` · rating ${listing.sellerRating}/100` : ""}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div>
                  <div className="text-xs text-neutral-500">Current</div>
                  <div>
                    {listing.priceHistory.currentEffectivePriceCents
                      ? formatCentsBRL(listing.priceHistory.currentEffectivePriceCents)
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">30d avg</div>
                  <div>
                    {listing.priceHistory.avg30dCents
                      ? formatCentsBRL(listing.priceHistory.avg30dCents)
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">90d avg</div>
                  <div>
                    {listing.priceHistory.avg90dCents
                      ? formatCentsBRL(listing.priceHistory.avg90dCents)
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">All-time min</div>
                  <div>
                    {listing.priceHistory.historicalMinCents
                      ? formatCentsBRL(listing.priceHistory.historicalMinCents)
                      : "—"}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
