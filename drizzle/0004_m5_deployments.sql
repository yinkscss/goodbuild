CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"run_id" text NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_name" text NOT NULL,
	"address" text NOT NULL,
	"deployer" text NOT NULL,
	"tx_hash" text NOT NULL,
	"block_number" bigint NOT NULL,
	"constructor_args" text DEFAULT '0x' NOT NULL,
	"compiler_version" text NOT NULL,
	"evm_version" text NOT NULL,
	"source_hash" text NOT NULL,
	"abi" jsonb NOT NULL,
	"std_json_input" jsonb,
	"verify_status" text DEFAULT 'pending' NOT NULL,
	"verify_provider" text,
	"verify_detail" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_chain_address_idx" ON "deployments" USING btree ("chain_id","address");--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_chain_tx_idx" ON "deployments" USING btree ("chain_id","tx_hash");--> statement-breakpoint
CREATE INDEX "deployments_project_idx" ON "deployments" USING btree ("project_id","created_at");