import { redis } from "@/lib/redis";

// Creator Quest Q5 "Make Your Mark" submissions live OUTSIDE the manifest, for
// the same reason tip state does (see lib/tips.ts): the manifest is edge-cached
// and version-bumped per curator edit, and player submissions are neither a
// curator action nor something we want polluting the manifest version history.
//
// Identity model (see docs CREATOR_QUEST contract):
//   - WRITE is trust-on-write: the wallet arrives as a query param on /submit.
//     A crafted URL could mark another wallet done; the only stake is an
//     unearned wearable, so that's acceptable.
//   - READ derives the wallet from the DCL signedFetch auth-chain header. We do
//     NOT cryptographically verify the signature (lowest-friction, low-value
//     prize). See app/api/quest-status/route.ts for the upgrade path.

const KEY_PREFIX = "panelhaus:submissions:";

// Per-wallet hash. EXISTENCE of this hash == the player submitted, which is the
// only boolean the scene's poll needs. Fields are for the curator review page.
//   comicUrl   string  Vercel Blob URL of the uploaded comic
//   dclName    string  the player's Decentraland name (self-reported)
//   at         string  ISO datetime of submission
const subKey = (wallet: string) => `${KEY_PREFIX}${wallet}`;

// Set of all submitter wallets, so the review page can enumerate without a
// SCAN over the keyspace.
const INDEX_KEY = `${KEY_PREFIX}index`;

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

export type SubmissionT = {
  wallet: string;
  comicUrl: string;
  dclName: string;
  at: string;
};

// Validates an Ethereum address shape. Narrows the type so callers can pass the
// value on as a known-good wallet string.
export function isWalletAddress(s: string): s is string {
  return WALLET_RE.test(s);
}

// Normalize to lowercase so the write path (?wallet= query, any casing) and the
// read path (auth-chain SIGNER payload, any casing) agree on the key.
function norm(wallet: string): string {
  return wallet.toLowerCase();
}

// Record a player's comic submission. Idempotent per wallet: a re-submission
// overwrites the prior comic/name and refreshes the timestamp (the blob upload
// uses the same wallet-derived path, so it overwrites too).
export async function recordSubmission(args: {
  wallet: string;
  comicUrl: string;
  dclName: string;
  at?: string;
}): Promise<void> {
  const wallet = norm(args.wallet);
  const at = args.at ?? new Date().toISOString();
  await Promise.all([
    redis.hset(subKey(wallet), {
      comicUrl: args.comicUrl,
      dclName: args.dclName,
      at,
    }),
    redis.sadd(INDEX_KEY, wallet),
  ]);
}

// The boolean the scene polls for. True once a submission hash exists.
export async function hasSubmitted(wallet: string): Promise<boolean> {
  const n = await redis.exists(subKey(norm(wallet)));
  return n > 0;
}

// Full record for the curator review page (null if never submitted).
export async function getSubmission(
  wallet: string,
): Promise<SubmissionT | null> {
  const w = norm(wallet);
  const hash = await redis.hgetall<Record<string, unknown>>(subKey(w));
  if (!hash || Object.keys(hash).length === 0) return null;
  return {
    wallet: w,
    comicUrl: typeof hash.comicUrl === "string" ? hash.comicUrl : "",
    dclName: typeof hash.dclName === "string" ? hash.dclName : "",
    at: typeof hash.at === "string" ? hash.at : "",
  };
}

// Curator-only: wipe a wallet's submission so the scene's poll reads
// makeYourMark:false again (the player must redo Q5). Returns the comicUrl that
// was recorded, if any, so the caller can also delete the orphaned blob.
export async function deleteSubmission(wallet: string): Promise<string | null> {
  const w = norm(wallet);
  const existing = await getSubmission(w);
  await Promise.all([redis.del(subKey(w)), redis.srem(INDEX_KEY, w)]);
  return existing?.comicUrl ?? null;
}

// All submissions, newest first, for the curator review page.
export async function readAllSubmissions(): Promise<SubmissionT[]> {
  const wallets = await redis.smembers(INDEX_KEY);
  if (!wallets || wallets.length === 0) return [];
  const records = await Promise.all(wallets.map((w) => getSubmission(w)));
  return records
    .filter((r): r is SubmissionT => r !== null)
    .sort((a, b) => b.at.localeCompare(a.at));
}
