import { relations } from "drizzle-orm";
import { affiliatePrograms } from "./affiliate-program.js";
import { categories } from "./category.js";
import { clickEvents } from "./click-event.js";
import { conversions } from "./conversion.js";
import { dealCandidates } from "./deal-candidate.js";
import { marketplaceProducts } from "./marketplace-product.js";
import { offers } from "./offer.js";
import { products } from "./product.js";
import { publications } from "./publication.js";
import { redirects } from "./redirect.js";

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "categoryParent",
  }),
  children: many(categories, { relationName: "categoryParent" }),
  products: many(products),
  affiliatePrograms: many(affiliatePrograms),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  marketplaceProducts: many(marketplaceProducts),
}));

export const marketplaceProductsRelations = relations(marketplaceProducts, ({ one, many }) => ({
  product: one(products, {
    fields: [marketplaceProducts.productId],
    references: [products.id],
  }),
  offers: many(offers),
}));

export const offersRelations = relations(offers, ({ one, many }) => ({
  marketplaceProduct: one(marketplaceProducts, {
    fields: [offers.marketplaceProductId],
    references: [marketplaceProducts.id],
  }),
  dealCandidates: many(dealCandidates),
}));

export const affiliateProgramsRelations = relations(affiliatePrograms, ({ one }) => ({
  category: one(categories, {
    fields: [affiliatePrograms.categoryId],
    references: [categories.id],
  }),
}));

export const dealCandidatesRelations = relations(dealCandidates, ({ one, many }) => ({
  offer: one(offers, {
    fields: [dealCandidates.offerId],
    references: [offers.id],
  }),
  publications: many(publications),
  redirects: many(redirects),
  clickEvents: many(clickEvents),
  conversions: many(conversions),
}));

export const publicationsRelations = relations(publications, ({ one }) => ({
  dealCandidate: one(dealCandidates, {
    fields: [publications.dealCandidateId],
    references: [dealCandidates.id],
  }),
}));

export const redirectsRelations = relations(redirects, ({ one, many }) => ({
  dealCandidate: one(dealCandidates, {
    fields: [redirects.dealCandidateId],
    references: [dealCandidates.id],
  }),
  clickEvents: many(clickEvents),
}));

export const clickEventsRelations = relations(clickEvents, ({ one }) => ({
  redirect: one(redirects, {
    fields: [clickEvents.redirectId],
    references: [redirects.id],
  }),
  dealCandidate: one(dealCandidates, {
    fields: [clickEvents.dealCandidateId],
    references: [dealCandidates.id],
  }),
}));

export const conversionsRelations = relations(conversions, ({ one }) => ({
  dealCandidate: one(dealCandidates, {
    fields: [conversions.dealCandidateId],
    references: [dealCandidates.id],
  }),
}));
