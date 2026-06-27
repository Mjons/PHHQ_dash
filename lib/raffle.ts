import { redis } from "@/lib/redis";

// DUMPSTR raffle storage. Dead-simple per the handoff's reduced scope
// (docs/DUMPSTR_RAFFLE_DASHBOARD_HANDOFF.md): collect Solana payout addresses,
// draw a winner, hand the address off for the NFT airdrop. No quest-status
// poll, no auth-chain — we just dedupe on the SOL address itself.

const ENTRIES_KEY = "panelhaus:raffle:dumpstr:entries"; // hash: solWallet -> JSON
const DRAWS_KEY = "panelhaus:raffle:dumpstr:draws"; // list: JSON draw records

export type RaffleEntry = {
  solWallet: string; // base58, validated; the payout target
  postUrl: string | null; // X post tagging @panelhaus + #smudgethesponge
  ethWallet: string | null; // optional, captured from ?wallet if present
  ts: number; // epoch ms
  verified?: boolean; // operator confirmed the post + tags
};

export type RaffleDraw = {
  seed: string; // hex; makes the draw reproducible/auditable
  drawnAt: number; // epoch ms
  winners: string[]; // winning SOL wallets
  entrantCount: number; // pool size at draw time
};

// --- Solana address validation -------------------------------------------
// A valid address is a base58 string that decodes to exactly 32 bytes
// (the ed25519 public key). We decode rather than just length-check so we
// reject look-alikes (and ETH 0x… input, which isn't base58 anyway).
const B58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP: Record<string, number> = {};
for (let i = 0; i < B58_ALPHABET.length; i++) B58_MAP[B58_ALPHABET[i]] = i;

function base58DecodeLength(input: string): number | null {
  if (input.length === 0) return null;
  const bytes: number[] = [];
  for (const ch of input) {
    const val = B58_MAP[ch];
    if (val === undefined) return null; // not base58
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's are leading zero bytes.
  let leadingZeros = 0;
  for (const ch of input) {
    if (ch === "1") leadingZeros++;
    else break;
  }
  return leadingZeros + bytes.length;
}

export function isSolanaAddress(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const s = input.trim();
  // Quick guards: Solana addresses are ~32–44 chars, and never start 0x.
  if (s.length < 32 || s.length > 44) return false;
  if (s.startsWith("0x") || s.startsWith("0X")) return false;
  return base58DecodeLength(s) === 32;
}

// Light check for the entry's X post link. The real verification (did it tag
// @panelhaus + #smudgethesponge?) happens at draw time by the operator opening
// the link — here we just confirm it looks like an X/Twitter status URL.
const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);

export function isLikelyXPostUrl(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const s = input.trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (!X_HOSTS.has(u.hostname.toLowerCase())) return false;
    // Must point at a post, not just the profile root.
    return u.pathname.replace(/\/+$/, "").length > 1;
  } catch {
    return false;
  }
}

// --- Reads / writes -------------------------------------------------------

// Upsert keyed on the SOL address — re-pasting the same wallet is a no-op,
// not a duplicate entry. Re-submitting updates the post link but clears the
// operator's `verified` flag (the post may have changed). Returns true if
// this was a new entrant.
export async function addEntry(
  solWallet: string,
  postUrl: string | null,
  ethWallet: string | null,
): Promise<boolean> {
  const key = solWallet.trim();
  const existing = await redis.hget<RaffleEntry>(ENTRIES_KEY, key);
  const entry: RaffleEntry = {
    solWallet: key,
    postUrl: postUrl ?? existing?.postUrl ?? null,
    ethWallet: ethWallet ?? existing?.ethWallet ?? null,
    ts: existing?.ts ?? Date.now(),
    // A changed post link can't keep an old verification.
    verified:
      existing && existing.postUrl === postUrl ? existing.verified : false,
  };
  await redis.hset(ENTRIES_KEY, { [key]: entry });
  return !existing;
}

// Operator marks an entrant verified (post confirmed) or not. No-op if the
// entrant doesn't exist.
export async function setVerified(
  solWallet: string,
  verified: boolean,
): Promise<void> {
  const key = solWallet.trim();
  const existing = await redis.hget<RaffleEntry>(ENTRIES_KEY, key);
  if (!existing) return;
  await redis.hset(ENTRIES_KEY, { [key]: { ...existing, verified } });
}

export async function readAllEntries(): Promise<RaffleEntry[]> {
  const all = await redis.hgetall<Record<string, RaffleEntry>>(ENTRIES_KEY);
  if (!all) return [];
  return Object.values(all).sort((a, b) => a.ts - b.ts);
}

export async function readDraws(): Promise<RaffleDraw[]> {
  const raw = await redis.lrange<RaffleDraw>(DRAWS_KEY, 0, -1);
  return raw ?? [];
}

// Seeded shuffle (mulberry32) so a recorded draw can be re-run and verified —
// never an unseeded pick we can't reproduce.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Draw N distinct winners over the sorted entrant list using a fresh random
// seed, then persist the draw record. With `verifiedOnly`, only entrants the
// operator confirmed are eligible. Returns the draw.
export async function drawWinners(
  n: number,
  verifiedOnly = false,
): Promise<RaffleDraw> {
  const entries = await readAllEntries();
  const eligible = verifiedOnly ? entries.filter((e) => e.verified) : entries;
  const pool = eligible.map((e) => e.solWallet);
  const count = Math.max(1, Math.min(n, pool.length));

  const seedBytes = new Uint32Array(1);
  crypto.getRandomValues(seedBytes);
  const seed = seedBytes[0];

  const rng = mulberry32(seed);
  // Fisher–Yates over a copy.
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const winners = shuffled.slice(0, count);

  const draw: RaffleDraw = {
    seed: seed.toString(16),
    drawnAt: Date.now(),
    winners,
    entrantCount: pool.length,
  };
  await redis.rpush(DRAWS_KEY, draw);
  return draw;
}
