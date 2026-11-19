import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// One Prisma client per server process (also survives dev hot reloads). Created lazily, so
// `next build` without DATABASE_URL works; the first query fails loudly if it is missing.
const globalForDb = globalThis as unknown as { gedpDb?: PrismaClient };

// The Supabase session pooler allows 15 clients in total. pg's default (10 per process) let one
// dev server plus one stale process exhaust it, so every page failed with EMAXCONNSESSION.
const DB_POOL_MAX_CONNECTIONS = 5;

export function db(): PrismaClient {
  if (globalForDb.gedpDb) return globalForDb.gedpDb;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: DB_POOL_MAX_CONNECTIONS }) });
  globalForDb.gedpDb = client;
  return client;
}
