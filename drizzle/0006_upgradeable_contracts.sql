CREATE TABLE "contract_upgrades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"from_implementation" text NOT NULL,
	"to_implementation" text NOT NULL,
	"implementation_tx" text NOT NULL,
	"version" integer NOT NULL,
	"source_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upgradeable_projects" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "proxy" jsonb;--> statement-breakpoint
ALTER TABLE "contract_upgrades" ADD CONSTRAINT "contract_upgrades_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgradeable_projects" ADD CONSTRAINT "upgradeable_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_upgrades_chain_tx_idx" ON "contract_upgrades" USING btree ("chain_id","tx_hash");--> statement-breakpoint
CREATE INDEX "contract_upgrades_deployment_idx" ON "contract_upgrades" USING btree ("deployment_id","created_at");