import { redis } from "@/lib/redis";
import { VAULT_FLOORS, type VTFloorT } from "@/schema/manifest";

// Tip state lives OUTSIDE the manifest. Rationale (docs/VAULT_TIPPING_PLAN.md
// §"Storage split"): the manifest is edge-cached and version-bumped per write;
// mutating it on every on-chain tip would pollute version history with
// financial events that don't belong to the curator's edit timeline.

const KEY_PREFIX = "panelhaus:tips:";

// Hash holding the durable counters for a floor.
//   totalUsd       float   running sum (HINCRBYFLOAT)
//   tipCount       int     running count (HINCRBY)
//   lastTipAt      string  ISO datetime of most recent tip
const tipHashKey = (floor: VTFloorT) => `${KEY_PREFIX}${floor}`;

// Sibling key with EXPIRE 86400. Existence = frame override is active.
// When the key expires, the floor visually decays back to its configured
// frames. No cron job, no read-time TTL math.
const overrideKey = (floor: VTFloorT) => `${KEY_PREFIX}${floor}:override`;

// Capped list of recent tips for the dashboard activity panel.
const recentKey = (floor: VTFloorT) => `${KEY_PREFIX}${floor}:recent`;

const RECENT_CAP = 10;
const OVERRIDE_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export type TipRecord = {
  from: string; // 0x address of the tipper
  usd: number;
  txHash: string;
  at: string; // ISO datetime
};

export type TipStateT = {
  totalUsd: number;
  tipCount: number;
  lastTipAt: string | null;
  frameOverride: "B" | null;
  recent: TipRecord[];
};

export type TipStateMap = Partial<Record<VTFloorT, TipStateT>>;

const EMPTY_STATE: TipStateT = {
  totalUsd: 0,
  tipCount: 0,
  lastTipAt: null,
  frameOverride: null,
  recent: [],
};

function coerceNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function readTipState(floor: VTFloorT): Promise<TipStateT> {
  const [hash, overrideExists, recent] = await Promise.all([
    redis.hgetall<Record<string, unknown>>(tipHashKey(floor)),
    redis.exists(overrideKey(floor)),
    redis.lrange<string>(recentKey(floor), 0, RECENT_CAP - 1),
  ]);
  if (!hash || Object.keys(hash).length === 0) {
    // Even with no tips, the override key check is meaningful for testing;
    // but with no hash there's no meaningful state to report.
    return { ...EMPTY_STATE };
  }
  return {
    totalUsd: coerceNumber(hash.totalUsd),
    tipCount: coerceNumber(hash.tipCount),
    lastTipAt: typeof hash.lastTipAt === "string" ? hash.lastTipAt : null,
    frameOverride: overrideExists ? "B" : null,
    recent: (recent ?? [])
      .map((raw) => {
        try {
          const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
          if (
            parsed &&
            typeof parsed === "object" &&
            typeof parsed.from === "string" &&
            typeof parsed.txHash === "string"
          ) {
            return parsed as TipRecord;
          }
        } catch {
          // Drop malformed entries silently — they don't break the activity feed.
        }
        return null;
      })
      .filter((r): r is TipRecord => r !== null),
  };
}

export async function readAllTipState(): Promise<TipStateMap> {
  const entries = await Promise.all(
    VAULT_FLOORS.map(async (f) => [f, await readTipState(f)] as const),
  );
  const out: TipStateMap = {};
  for (const [f, s] of entries) {
    // Only include floors that have actually received tips. The dashboard
    // can still call readTipState directly per-floor for an empty-state row.
    if (s.tipCount > 0 || s.frameOverride) out[f] = s;
  }
  return out;
}

// Atomic-ish tip recording. Upstash REST doesn't expose MULTI/EXEC over a
// single roundtrip in the JS client, but each command is independently
// durable — partial application would leave counters slightly desynced from
// recent[], which is recoverable and not financially material (we don't
// custody funds; this is just display state).
//
// Idempotency: callers MUST pre-check that this txHash hasn't been recorded
// before. The Alchemy webhook handler dedupes via a `panelhaus:tips:tx:<hash>`
// marker key; see app/api/tips/webhook/route.ts.
export async function recordTip(args: {
  floor: VTFloorT;
  usd: number;
  from: string;
  txHash: string;
  at?: string;
}): Promise<void> {
  const { floor, usd, from, txHash, at = new Date().toISOString() } = args;
  const record: TipRecord = { from, usd, txHash, at };
  await Promise.all([
    redis.hincrbyfloat(tipHashKey(floor), "totalUsd", usd),
    redis.hincrby(tipHashKey(floor), "tipCount", 1),
    redis.hset(tipHashKey(floor), { lastTipAt: at }),
    // Set the override sentinel with a fresh 24h TTL. Each new tip extends
    // the window — a hot floor stays gold until activity stops for a day.
    redis.set(overrideKey(floor), "B", { ex: OVERRIDE_TTL_SECONDS }),
    redis.lpush(recentKey(floor), JSON.stringify(record)),
    redis.ltrim(recentKey(floor), 0, RECENT_CAP - 1),
  ]);
}

// Returns true if this txHash has not been recorded yet, false otherwise.
// Sets the dedupe marker as a side-effect with a long TTL.
export async function markTxIfNew(txHash: string): Promise<boolean> {
  const key = `${KEY_PREFIX}tx:${txHash.toLowerCase()}`;
  // NX = only set if not exists. 90-day TTL: long enough to dedupe any
  // realistic webhook retry storm; short enough to not bloat Redis forever.
  const set = await redis.set(key, "1", { nx: true, ex: 90 * 24 * 60 * 60 });
  return set === "OK";
}

// Admin / testing — wipe a floor's tip state. Not exposed via API.
export async function clearTipState(floor: VTFloorT): Promise<void> {
  await Promise.all([
    redis.del(tipHashKey(floor)),
    redis.del(overrideKey(floor)),
    redis.del(recentKey(floor)),
  ]);
}

export function isVTFloor(s: string): s is VTFloorT {
  return (VAULT_FLOORS as readonly string[]).includes(s);
}
