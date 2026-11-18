CREATE TABLE "flowstate_voters" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"claim_at" timestamp with time zone,
	"tx_hash" text,
	"voted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flowstate_voters" ADD CONSTRAINT "flowstate_voters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;