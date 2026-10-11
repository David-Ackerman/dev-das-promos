import { apiGet } from "@/lib/api";
import { PUBLIC_DEALS_MAX_PAGE, PUBLIC_DEALS_MAX_PAGE_SIZE } from "@dev-das-promos/config";
import { unstable_cache } from "next/cache";

export const SITEMAP_URLS_PER_FILE = 40_000;
const SITEMAP_REVALIDATE_SECONDS = 300;

interface SitemapDeal {
  slug: string;
  productSlug: string;
}

interface SitemapCategory {
  slug: string;
}

interface SitemapCategoryPage {
  category: SitemapCategory;
  deals: { slug: string }[];
}

/** Returns only routes that the public API currently exposes. */
export const getSitemapPaths = unstable_cache(
  async (): Promise<string[]> => {
    const [categoryData, dealPages] = await Promise.all([
      apiGet<{ categories: SitemapCategory[] }>("/public/categories", SITEMAP_REVALIDATE_SECONDS),
      getPublishedDeals(),
    ]);
    const populatedCategories: (SitemapCategoryPage | null)[] = [];
    const categories = categoryData?.categories ?? [];
    for (let index = 0; index < categories.length; index += 25) {
      const batch = categories.slice(index, index + 25);
      populatedCategories.push(
        ...(await Promise.all(
          batch.map((category) =>
            apiGet<SitemapCategoryPage>(
              `/public/categories/${encodeURIComponent(category.slug)}`,
              SITEMAP_REVALIDATE_SECONDS,
            ),
          ),
        )),
      );
    }

    const routes = new Set<string>(["/", "/deals"]);
    for (const categoryPage of populatedCategories) {
      if (categoryPage && categoryPage.deals?.length > 0) {
        routes.add(`/category/${encodeURIComponent(categoryPage.category.slug)}`);
      }
    }
    for (const deal of dealPages) {
      routes.add(`/deal/${encodeURIComponent(deal.slug)}`);
      routes.add(`/product/${encodeURIComponent(deal.productSlug)}`);
    }
    return [...routes];
  },
  ["public-sitemap-v2"],
  { revalidate: SITEMAP_REVALIDATE_SECONDS },
);

async function getPublishedDeals(): Promise<SitemapDeal[]> {
  const deals: SitemapDeal[] = [];
  const pageSize = PUBLIC_DEALS_MAX_PAGE_SIZE;

  for (let page = 1; page <= PUBLIC_DEALS_MAX_PAGE; page += 1) {
    const result = await apiGet<{ deals: SitemapDeal[] }>(
      `/public/deals?page=${page}&pageSize=${pageSize}`,
      SITEMAP_REVALIDATE_SECONDS,
    );
    const currentPage = result?.deals ?? [];
    deals.push(...currentPage);
    if (currentPage.length < pageSize) return deals;
  }

  return deals;
}
