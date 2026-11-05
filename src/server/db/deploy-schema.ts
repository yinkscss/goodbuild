import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { projects, users } from "./schema";

/**
 * Deployed contracts (P3: the deployments table is the source of truth). Written only after the
 * server has read the receipt from the chain, never from client-reported addresses
 * (CONTRACTS_AND_DEPLOYMENT.md §3). Kept in its own file so M5 doesn't touch the shared schema.
 */
export const deployments = pgTable(
  "deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The project version whose code was deployed. */
    version: integer("version").notNull(),
    /** Groups the contracts deployed together from one manifest. */
    runId: text("run_id").notNull(),
    chainId: integer("chain_id").notNull(),
    contractName: text("contract_name").notNull(),
    address: text("address").notNull(),
    /** Lowercased wallet that signed; equals the session wallet. */
    deployer: text("deployer").notNull(),
    txHash: text("tx_hash").notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    /** Hex of the ABI-encoded constructor arguments (the tail of the creation input). */
    constructorArgs: text("constructor_args").notNull().default("0x"),
    compilerVersion: text("compiler_version").notNull(),
    evmVersion: text("evm_version").notNull(),
    /** Hash of the exact sources and settings compiled, so "is this the current code?" is answerable. */
    sourceHash: text("source_hash").notNull(),
    abi: jsonb("abi").$type<unknown[]>().notNull(),
    /** Solidity standard JSON input, kept so verification can be retried without recompiling. */
    stdJsonInput: jsonb("std_json_input").$type<Record<string, unknown>>(),
    /** pending | verified | failed | unsupported */
    verifyStatus: text("verify_status").notNull().default("pending"),
    verifyProvider: text("verify_provider"),
    verifyDetail: text("verify_detail"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("deployments_chain_address_idx").on(t.chainId, t.address),
    uniqueIndex("deployments_chain_tx_idx").on(t.chainId, t.txHash),
    index("deployments_project_idx").on(t.projectId, t.createdAt),
  ],
);

export type Deployment = typeof deployments.$inferSelect;
