CREATE TABLE "app_data_deals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"collection" text NOT NULL,
	"host" text NOT NULL,
	"room" text NOT NULL,
	"players" jsonb NOT NULL,
	"stock" jsonb NOT NULL,
	"hands" jsonb NOT NULL,
	"drawn" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_data_deals" ADD CONSTRAINT "app_data_deals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_data_deals_project_idx" ON "app_data_deals" USING btree ("project_id","collection");--> statement-breakpoint
CREATE INDEX "app_data_deals_host_idx" ON "app_data_deals" USING btree ("project_id","host");