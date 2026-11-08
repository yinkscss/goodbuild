CREATE TABLE "credit_quotes" (
	"ref" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"chain_id" integer NOT NULL,
	"wallet" text NOT NULL,
	"goodid_root" text,
	"pack" integer NOT NULL,
	"credits_micro" bigint NOT NULL,
	"bonus_micro" bigint DEFAULT 0 NOT NULL,
	"gd_wei" text NOT NULL,
	"gd_usd" text NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"paid_tx" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_quotes" ADD CONSTRAINT "credit_quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_quotes_root_idx" ON "credit_quotes" USING btree ("goodid_root","created_at");--> statement-breakpoint
CREATE INDEX "credit_quotes_user_idx" ON "credit_quotes" USING btree ("user_id");