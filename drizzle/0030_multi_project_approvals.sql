DROP INDEX IF EXISTS "hackathon_approvals_human_unique";--> statement-breakpoint
CREATE INDEX "hackathon_approvals_entry_root_idx" ON "hackathon_approvals" USING btree ("entry_id", "goodid_root");
CREATE INDEX "hackathon_approvals_root_entry_idx" ON "hackathon_approvals" USING btree ("goodid_root", "entry_id");
