CREATE TYPE "public"."availability" AS ENUM('in_stock', 'low_stock', 'out_of_stock', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."deal_candidate_status" AS ENUM('pending', 'approved', 'rejected', 'auto_approved', 'published', 'expired');--> statement-breakpoint
CREATE TYPE "public"."estimate_basis" AS ENUM('heuristic', 'historical');--> statement-breakpoint
CREATE TYPE "public"."marketplace" AS ENUM('amazon_br', 'shopee_br');--> statement-breakpoint
CREATE TYPE "public"."publication_channel" AS ENUM('telegram', 'x', 'web');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('queued', 'publishing', 'published', 'failed');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"brand" text,
	"category_id" text,
	"image_url" text,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "marketplace_products" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"marketplace" "marketplace" NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"seller_name" text,
	"seller_rating" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_products_marketplace_external_unique" UNIQUE("marketplace","external_id")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"marketplace_product_id" text NOT NULL,
	"price_cents" integer NOT NULL,
	"original_price_cents" integer,
	"shipping_price_cents" integer DEFAULT 0 NOT NULL,
	"coupon_value_cents" integer DEFAULT 0 NOT NULL,
	"effective_price_cents" integer NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"availability" "availability" DEFAULT 'unknown' NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_programs" (
	"id" text PRIMARY KEY NOT NULL,
	"marketplace" "marketplace" NOT NULL,
	"category_id" text,
	"commission_rate_bps" integer NOT NULL,
	"extra_commission_rate_bps" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"slug" text NOT NULL,
	"deal_score" real NOT NULL,
	"real_discount_percentage" real NOT NULL,
	"advertised_discount_percentage" real,
	"historical_price_score" real NOT NULL,
	"discount_score" real NOT NULL,
	"commission_score" real NOT NULL,
	"seller_score" real NOT NULL,
	"popularity_score" real NOT NULL,
	"conversion_score" real NOT NULL,
	"freshness_score" real NOT NULL,
	"confidence_score" real NOT NULL,
	"estimated_epc_cents" integer DEFAULT 0 NOT NULL,
	"estimated_rpm_cents" integer DEFAULT 0 NOT NULL,
	"estimate_basis" "estimate_basis" DEFAULT 'heuristic' NOT NULL,
	"status" "deal_candidate_status" DEFAULT 'pending' NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reasoning" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_candidates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_candidate_id" text NOT NULL,
	"channel" "publication_channel" NOT NULL,
	"external_publication_id" text,
	"status" "publication_status" DEFAULT 'queued' NOT NULL,
	"content" text,
	"error_message" text,
	"published_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publications_deal_channel_unique" UNIQUE("deal_candidate_id","channel")
);
--> statement-breakpoint
CREATE TABLE "redirects" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"deal_candidate_id" text NOT NULL,
	"destination_url" text NOT NULL,
	"channel" "publication_channel",
	"campaign" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redirects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "click_events" (
	"id" text PRIMARY KEY NOT NULL,
	"redirect_id" text NOT NULL,
	"deal_candidate_id" text NOT NULL,
	"channel" "publication_channel",
	"campaign" text,
	"source" text,
	"referrer" text,
	"user_agent_summary" text,
	"ip_hash" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversions" (
	"id" text PRIMARY KEY NOT NULL,
	"marketplace" "marketplace" NOT NULL,
	"deal_candidate_id" text,
	"order_reference" text NOT NULL,
	"revenue_cents" integer NOT NULL,
	"commission_cents" integer NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_products" ADD CONSTRAINT "marketplace_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_marketplace_product_id_marketplace_products_id_fk" FOREIGN KEY ("marketplace_product_id") REFERENCES "public"."marketplace_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_programs" ADD CONSTRAINT "affiliate_programs_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_candidates" ADD CONSTRAINT "deal_candidates_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_deal_candidate_id_deal_candidates_id_fk" FOREIGN KEY ("deal_candidate_id") REFERENCES "public"."deal_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_deal_candidate_id_deal_candidates_id_fk" FOREIGN KEY ("deal_candidate_id") REFERENCES "public"."deal_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_redirect_id_redirects_id_fk" FOREIGN KEY ("redirect_id") REFERENCES "public"."redirects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_deal_candidate_id_deal_candidates_id_fk" FOREIGN KEY ("deal_candidate_id") REFERENCES "public"."deal_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_deal_candidate_id_deal_candidates_id_fk" FOREIGN KEY ("deal_candidate_id") REFERENCES "public"."deal_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "marketplace_products_product_idx" ON "marketplace_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "offers_marketplace_product_idx" ON "offers" USING btree ("marketplace_product_id");--> statement-breakpoint
CREATE INDEX "offers_captured_at_idx" ON "offers" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "offers_mp_captured_idx" ON "offers" USING btree ("marketplace_product_id","captured_at");--> statement-breakpoint
CREATE INDEX "affiliate_programs_marketplace_idx" ON "affiliate_programs" USING btree ("marketplace");--> statement-breakpoint
CREATE INDEX "affiliate_programs_category_idx" ON "affiliate_programs" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "deal_candidates_offer_idx" ON "deal_candidates" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "deal_candidates_status_idx" ON "deal_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deal_candidates_score_idx" ON "deal_candidates" USING btree ("deal_score");--> statement-breakpoint
CREATE INDEX "publications_status_idx" ON "publications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "redirects_deal_idx" ON "redirects" USING btree ("deal_candidate_id");--> statement-breakpoint
CREATE INDEX "click_events_redirect_idx" ON "click_events" USING btree ("redirect_id");--> statement-breakpoint
CREATE INDEX "click_events_deal_idx" ON "click_events" USING btree ("deal_candidate_id");--> statement-breakpoint
CREATE INDEX "click_events_occurred_idx" ON "click_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "conversions_deal_idx" ON "conversions" USING btree ("deal_candidate_id");--> statement-breakpoint
CREATE INDEX "conversions_occurred_idx" ON "conversions" USING btree ("occurred_at");