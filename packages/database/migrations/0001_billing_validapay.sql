CREATE TYPE "public"."billing_audit_source" AS ENUM('checkout', 'webhook', 'reconciliation', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "public"."charge_state" AS ENUM('pending', 'processing', 'awaiting_payment', 'failed', 'expired', 'canceled', 'archived', 'paid', 'dispute', 'partially_refunded', 'refunded', 'charged_back');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('creditcard', 'pix_automatico', 'pix', 'boleto');--> statement-breakpoint
CREATE TYPE "public"."publication_state" AS ENUM('allowed', 'blocked_pending', 'blocked_overdue', 'blocked_canceled', 'blocked_dispute', 'blocked_admin');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_status" AS ENUM('pending', 'processed', 'failed', 'ignored', 'unresolved');--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'pending' BEFORE 'trialing';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'cancel_at_period_end' BEFORE 'canceled';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'completed';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'suspended';--> statement-breakpoint
CREATE TABLE "billing_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"subscription_id" uuid,
	"charge_id" uuid,
	"action" text NOT NULL,
	"source" "billing_audit_source" NOT NULL,
	"actor_user_id" uuid,
	"webhook_event_id" uuid,
	"previous_state" text DEFAULT '' NOT NULL,
	"new_state" text DEFAULT '' NOT NULL,
	"previous_publication" text DEFAULT '' NOT NULL,
	"new_publication" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscription_id" uuid,
	"external_charge_id" text NOT NULL,
	"external_subscription_id" text,
	"external_invoice_id" text,
	"status" charge_state DEFAULT 'pending' NOT NULL,
	"provider_status" text DEFAULT '' NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"refunded_amount_cents" integer DEFAULT 0 NOT NULL,
	"payment_method" "payment_method",
	"cycle_number" integer,
	"description" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"failure_code" text DEFAULT '' NOT NULL,
	"failure_reason" text DEFAULT '' NOT NULL,
	"attempt" smallint,
	"last_synced_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_event_id" text NOT NULL,
	"event" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt" smallint,
	"status" "webhook_event_status" DEFAULT 'pending' NOT NULL,
	"tenant_id" uuid,
	"external_subscription_id" text,
	"external_charge_id" text,
	"payload" jsonb NOT NULL,
	"processing_attempts" smallint DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"error_message" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "billing" jsonb DEFAULT '{"recurrenceType":"MONTHLY","recurrenceInterval":1,"trialDays":null,"paymentMethods":["creditcard"]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "external_product_id" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "external_price_id" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "external_checkout_url" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "external_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "external_sync_error" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_status" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "publication_state" "publication_state" DEFAULT 'allowed' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "payment_method" "payment_method";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "access_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "grace_period_days" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "next_charge_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "current_cycle_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "current_cycle_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancel_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "admin_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "admin_hold_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "admin_hold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "admin_hold_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "dispute_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "dispute_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "external_item_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "external_price_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "external_checkout_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "checkout_session_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "checkout_url" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "checkout_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "intent_token" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_error_message" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_audit_logs" ADD CONSTRAINT "billing_audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit_logs" ADD CONSTRAINT "billing_audit_logs_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit_logs" ADD CONSTRAINT "billing_audit_logs_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit_logs" ADD CONSTRAINT "billing_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit_logs" ADD CONSTRAINT "billing_audit_logs_webhook_event_id_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."webhook_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_audit_tenant_idx" ON "billing_audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_audit_action_idx" ON "billing_audit_logs" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "charges_external_key" ON "charges" USING btree ("external_charge_id");--> statement-breakpoint
CREATE INDEX "charges_tenant_idx" ON "charges" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "charges_subscription_idx" ON "charges" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "charges_status_idx" ON "charges" USING btree ("status");--> statement-breakpoint
CREATE INDEX "charges_sync_idx" ON "charges" USING btree ("status","last_synced_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_external_key" ON "webhook_events" USING btree ("external_event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_status_idx" ON "webhook_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "webhook_events_tenant_idx" ON "webhook_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "webhook_events_subscription_idx" ON "webhook_events" USING btree ("external_subscription_id");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_admin_hold_by_user_id_users_id_fk" FOREIGN KEY ("admin_hold_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pending_plan_id_plans_id_fk" FOREIGN KEY ("pending_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_external_price_key" ON "plans" USING btree ("external_price_id") WHERE "plans"."external_price_id" is not null;--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscriptions_sync_idx" ON "subscriptions" USING btree ("last_synced_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_external_key" ON "subscriptions" USING btree ("external_subscription_id") WHERE "subscriptions"."external_subscription_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_intent_key" ON "subscriptions" USING btree ("intent_token") WHERE "subscriptions"."intent_token" is not null;