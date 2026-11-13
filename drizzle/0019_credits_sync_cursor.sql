CREATE TABLE "credits_sync_cursor" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"last_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
