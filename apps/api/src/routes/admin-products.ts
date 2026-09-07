import {
  categories,
  getPriceHistorySummary,
  marketplaceProducts,
  products,
} from "@dev-das-promos/database";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

export default async function adminProductsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAdmin);

  fastify.get("/admin/products", async () => {
    const rows = await fastify.db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        brand: products.brand,
        imageUrl: products.imageUrl,
        categoryName: categories.name,
        createdAt: products.createdAt,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .orderBy(products.name);

    return { products: rows };
  });

  fastify.get("/admin/products/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [product] = await fastify.db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        brand: products.brand,
        description: products.description,
        imageUrl: products.imageUrl,
        categoryName: categories.name,
        metadata: products.metadata,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(products.id, id));

    if (!product) return reply.code(404).send({ error: "Product not found" });

    const listings = await fastify.db
      .select({
        id: marketplaceProducts.id,
        marketplace: marketplaceProducts.marketplace,
        url: marketplaceProducts.url,
        sellerName: marketplaceProducts.sellerName,
        sellerRating: marketplaceProducts.sellerRating,
      })
      .from(marketplaceProducts)
      .where(eq(marketplaceProducts.productId, id));

    const listingsWithHistory = await Promise.all(
      listings.map(async (listing) => ({
        ...listing,
        priceHistory: await getPriceHistorySummary(fastify.db, listing.id),
      })),
    );

    return { ...product, listings: listingsWithHistory };
  });
}
