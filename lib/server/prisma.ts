import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
}

function getRawDatabaseUrl() {
  return (
    process.env.DB_POOL_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING
  )
}

function shouldForceTransactionPooler() {
  return process.env.DB_POOL_MODE !== "session"
}

function getNormalizedDatabaseUrl() {
  const rawUrl = getRawDatabaseUrl()

  if (!rawUrl) {
    throw new Error("Missing DATABASE_URL")
  }

  const trimmedUrl = rawUrl.trim().replace(/^"|"$/g, "")
  const protocolSeparatorIndex = trimmedUrl.indexOf("://")

  if (protocolSeparatorIndex === -1) {
    return trimmedUrl
  }

  const authAndHost = trimmedUrl.slice(protocolSeparatorIndex + 3)
  const atIndex = authAndHost.lastIndexOf("@")

  if (atIndex === -1) {
    return trimmedUrl
  }

  const protocol = trimmedUrl.slice(0, protocolSeparatorIndex)
  const credentials = authAndHost.slice(0, atIndex)
  const hostAndPath = authAndHost.slice(atIndex + 1)
  const credentialSeparatorIndex = credentials.indexOf(":")

  if (credentialSeparatorIndex === -1) {
    return trimmedUrl
  }

  const username = credentials.slice(0, credentialSeparatorIndex)
  const password = credentials.slice(credentialSeparatorIndex + 1)
  const normalizedUrl = `${protocol}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${hostAndPath}`

  try {
    const parsedUrl = new URL(normalizedUrl)

    if (
      shouldForceTransactionPooler() &&
      parsedUrl.hostname.endsWith(".pooler.supabase.com") &&
      (!parsedUrl.port || parsedUrl.port === "5432")
    ) {
      parsedUrl.port = "6543"
    }

    if (!parsedUrl.searchParams.has("connection_limit")) {
      // Dashboard routes intentionally issue independent reads in parallel.
      // A single Prisma connection serialized those reads and made the
      // dashboard latency equal to the sum of every query. The Supabase
      // transaction pooler safely multiplexes this small, bounded client pool.
      parsedUrl.searchParams.set("connection_limit", process.env.PRISMA_CONNECTION_LIMIT || "5")
    }

    if (!parsedUrl.searchParams.has("pool_timeout")) {
      parsedUrl.searchParams.set("pool_timeout", "20")
    }

    if (
      shouldForceTransactionPooler() &&
      parsedUrl.hostname.endsWith(".pooler.supabase.com") &&
      !parsedUrl.searchParams.has("pgbouncer")
    ) {
      parsedUrl.searchParams.set("pgbouncer", "true")
    }

    return parsedUrl.toString()
  } catch {
    return normalizedUrl
  }
}

/**
 * Built on first property access rather than at module load.
 *
 * getNormalizedDatabaseUrl() throws "Missing DATABASE_URL" when no connection
 * string is present. Constructing the client at module scope meant that throw
 * fired on *import*, and `next build` imports every route module to collect
 * page data - so any build without a live database URL in its environment
 * failed outright, even though nothing queries at build time. Deferring it
 * keeps the build independent of runtime secrets; a genuinely missing URL now
 * surfaces on the first request instead, where it belongs.
 *
 * Caching semantics are unchanged: reuse the global if present, and only
 * populate the global outside production, exactly as before.
 */
let client: PrismaClient | undefined

function getPrismaClient(): PrismaClient {
  if (!client) {
    client =
      globalForPrisma.prisma ??
      new PrismaClient({
        datasources: {
          db: {
            url: getNormalizedDatabaseUrl(),
          },
        },
        log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
      })

    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = client
    }
  }

  return client
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const instance = getPrismaClient()
    const value = Reflect.get(instance as object, property, receiver)

    return typeof value === "function" ? value.bind(instance) : value
  },
  has(_target, property) {
    return Reflect.has(getPrismaClient() as object, property)
  },
})
