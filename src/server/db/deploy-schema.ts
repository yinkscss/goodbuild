import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { projects, users } from "./schema";

/** A deployment behind a proxy (D33). `address` on its row is the proxy, which never moves. */
export interface ProxyRecord {
  /** The code the proxy uses now, as last checked from the chain when recorded. */
  implementation: string;
  implementationTx: string;
  /** OpenZeppelin ProxyAdmin the proxy created. Its owner holds the upgrade authority. */
  admin: string;
  /** keccak256 of the implementation's runtime code, so an unchanged contract skips its upgrade. */
  codeHash: string;
  /** upgrades-core's storage layout of the implementation: the baseline for the next upgrade. */
  layout: unknown;
}

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
    /** Set for a contract behind a proxy (D33). An upgrade updates this row, because the address stays. */
    proxy: jsonb("proxy").$type<ProxyRecord>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("deployments_chain_address_idx").on(t.chainId, t.address),
    uniqueIndex("deployments_chain_tx_idx").on(t.chainId, t.txHash),
    index("deployments_project_idx").on(t.projectId, t.createdAt),
  ],
);

export type Deployment = typeof deployments.$inferSelect;

/** Projects that opted in to the upgradeable trial (D33). No row means the default: non-upgradeable. */
export const upgradeableProjects = pgTable("upgradeable_projects", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per recorded upgrade, so a retried request can't apply one twice and history is kept (D33). */
export const contractUpgrades = pgTable(
  "contract_upgrades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    txHash: text("tx_hash").notNull(),
    fromImplementation: text("from_implementation").notNull(),
    toImplementation: text("to_implementation").notNull(),
    implementationTx: text("implementation_tx").notNull(),
    version: integer("version").notNull(),
    sourceHash: text("source_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contract_upgrades_chain_tx_idx").on(t.chainId, t.txHash), index("contract_upgrades_deployment_idx").on(t.deploymentId, t.createdAt)],
);

/**
 * Each code version that passed GoodBuild's checks for Celo mainnet (GB-02), one row per project, chain
 * and exact source. Prepare writes it after the exploit gate and the deploy compile pass; recording a
 * mainnet deployment requires the row for that source, so nothing is recorded (or published) on
 * mainnet without having gone through the gate. It is also the audit trail: what was checked, where the
 * code takes in other people's money, and when the owner confirmed they had reviewed it.
 */
export const deployReviews = pgTable(
  "deploy_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    sourceHash: text("source_hash").notNull(),
    /** Lowercased wallet that prepared it, when known. */
    wallet: text("wallet"),
    /** "passed" when exploit tests were required and passed, "not_required" when the code holds nobody's money. */
    exploitTests: text("exploit_tests").notNull(),
    /** custodyText() of each place the code takes in other people's money. Empty when none. */
    custody: jsonb("custody").$type<string[]>().notNull().default([]),
    /** Set when the owner confirmed the review of a money-holding contract outside the known vault/DAO shapes. */
    ownerReviewedAt: timestamp("owner_reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("deploy_reviews_source_unique").on(t.projectId, t.chainId, t.sourceHash)],
);

export type DeployReview = typeof deployReviews.$inferSelect;
