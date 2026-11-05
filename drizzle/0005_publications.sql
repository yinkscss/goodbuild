CREATE TABLE "publication_files" (
	"publication_id" uuid NOT NULL,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	CONSTRAINT "publication_files_publication_id_path_pk" PRIMARY KEY("publication_id","path")
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"version_number" integer NOT NULL,
	"has_undeployed_contracts" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unpublished_at" timestamp with time zone,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "publication_files" ADD CONSTRAINT "publication_files_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "publications_project_idx" ON "publications" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_slug_idx" ON "publications" USING btree ("slug");