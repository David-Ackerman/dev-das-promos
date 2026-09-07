import { DealCard, type DealCardData } from "@/components/deal-card";
import { Disclosure } from "@/components/disclosure";
import { Nav } from "@/components/nav";
import { apiGet } from "@/lib/api";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

interface CategoryDetail {
  category: CategoryRow;
  children: CategoryRow[];
  deals: DealCardData[];
}

async function getCategory(slug: string) {
  return apiGet<CategoryDetail>(`/public/categories/${slug}`);
}

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await getCategory(slug);
  if (!data) return {};

  return {
    title: data.category.name,
    description: `Melhores ofertas de ${data.category.name} com histórico de preço verificado.`,
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getCategory(slug);
  if (!data) notFound();

  const { category, children, deals } = data;

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold">{category.name}</h1>

        {children.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {children.map((child) => (
              <Link
                key={child.id}
                href={`/category/${child.slug}`}
                className="rounded-full border border-neutral-200 px-3 py-1 text-sm text-neutral-600 hover:border-neutral-400"
              >
                {child.name}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {deals.map((deal) => (
            <DealCard key={deal.slug} deal={deal} />
          ))}
        </div>

        {deals.length === 0 && (
          <p className="text-neutral-500">Nenhuma oferta publicada nesta categoria ainda.</p>
        )}

        <div className="mt-10">
          <Disclosure />
        </div>
      </main>
    </div>
  );
}
