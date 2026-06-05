import { redis } from "@/lib/redis";
import { randomBytes } from "crypto";

// Per-player prize codes for the Creator Quest chain (currently Q6 "The
// Commute"). Lives OUTSIDE the manifest for the same reason submissions + tips
// do (no version churn, not a curator action).
//
// Identity model (mirrors lib/submissions.ts):
//   - ISSUE + STATUS derive the wallet from the DCL signedFetch auth-chain
//     header (see lib/dcl-identity.ts), so a player can only mint / read THEIR
//     OWN code.
//   - REDEEM is by code alone: the code is the secret. One-time, atomic flag.

const KEY_PREFIX = "panelhaus:reward:";
// Per-code hash: { wallet, quest, issuedAt, redeemed, redeemedAt }.
const codeKey = (code: string) => `${KEY_PREFIX}code:${code}`;
// wallet+quest → code. The idempotency anchor (one code per wallet per quest).
const byWalletKey = (quest: string, wallet: string) =>
  `${KEY_PREFIX}byWallet:${quest}:${wallet}`;
// wallet+quest → redeemed marker. The atomic once-per-wallet gate at redeem time
// (belt-and-suspenders on top of the one-code-per-wallet issue idempotency).
const redeemedWalletKey = (quest: string, wallet: string) =>
  `${KEY_PREFIX}redeemed:${quest}:${wallet}`;
// Set of all issued codes, for an optional admin list (no SCAN needed).
const INDEX_KEY = `${KEY_PREFIX}index`;

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
export function isWalletAddress(s: string): s is string {
  return WALLET_RE.test(s);
}

// Normalize so the issue path (auth-chain payload, any casing) and any later
// lookup agree on the key.
function norm(wallet: string): string {
  return wallet.toLowerCase();
}

export type RewardT = {
  code: string;
  wallet: string;
  quest: string;
  issuedAt: string;
  redeemed: boolean;
  redeemedAt: string | null;
};

// Crockford-ish alphabet — no 0/O/1/I to keep codes easy to read aloud.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(): string {
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++)
    s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `PHAUS-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

// Idempotent per wallet+quest: returns the existing code if one was already
// minted, otherwise generates + stores a fresh one. The byWallet key is the
// atomic anchor (SET NX), so two concurrent issues can't double-mint.
export async function issueCode(
  wallet: string,
  quest: string,
): Promise<string> {
  const w = norm(wallet);
  const bw = byWalletKey(quest, w);

  const existing = await redis.get<string>(bw);
  if (existing) return existing;

  const code = genCode();
  const reserved = await redis.set(bw, code, { nx: true });
  if (reserved !== "OK") {
    // Lost the race — another request just minted it; return theirs.
    const winner = await redis.get<string>(bw);
    if (winner) return winner;
  }

  await Promise.all([
    redis.hset(codeKey(code), {
      wallet: w,
      quest,
      issuedAt: new Date().toISOString(),
      redeemed: false,
      redeemedAt: "",
    }),
    redis.sadd(INDEX_KEY, code),
  ]);
  return code;
}

// The {code, redeemed} the scene polls. code is null if none was issued yet.
export async function getStatus(
  wallet: string,
  quest: string,
): Promise<{ code: string | null; redeemed: boolean }> {
  const code = await redis.get<string>(byWalletKey(quest, norm(wallet)));
  if (!code) return { code: null, redeemed: false };
  const redeemed =
    (await redis.hget<boolean>(codeKey(code), "redeemed")) === true;
  return { code, redeemed };
}

export type RedeemResult =
  | { ok: true; quest: string }
  | { ok: false; reason: "not-found" | "already" };

// One-time redemption, enforced ONCE PER WALLET per quest. The per-wallet
// `redeemed:` key is reserved with SET NX — that reservation is the atomic gate
// (it also closes the read-then-flip race on the same code). So even if a wallet
// somehow held more than one code, only the first claim for that wallet+quest
// succeeds; the rest read as already-claimed.
export async function redeemCode(code: string): Promise<RedeemResult> {
  const key = codeKey(code);
  const data = await redis.hgetall<Record<string, unknown>>(key);
  if (!data || Object.keys(data).length === 0) {
    return { ok: false, reason: "not-found" };
  }
  if (data.redeemed === true) return { ok: false, reason: "already" };

  const wallet = typeof data.wallet === "string" ? data.wallet : "";
  const quest = typeof data.quest === "string" ? data.quest : "";

  // Atomic once-per-wallet gate. Fails if this wallet already claimed a prize
  // for this quest (this code or any other).
  const reserved = await redis.set(redeemedWalletKey(quest, wallet), code, {
    nx: true,
  });
  if (reserved !== "OK") return { ok: false, reason: "already" };

  await redis.hset(key, {
    redeemed: true,
    redeemedAt: new Date().toISOString(),
  });
  return { ok: true, quest };
}

// Optional admin enumeration (newest first).
export async function readAllRewards(): Promise<RewardT[]> {
  const codes = await redis.smembers(INDEX_KEY);
  if (!codes || codes.length === 0) return [];
  const records = await Promise.all(
    codes.map(async (code): Promise<RewardT | null> => {
      const h = await redis.hgetall<Record<string, unknown>>(codeKey(code));
      if (!h || Object.keys(h).length === 0) return null;
      return {
        code,
        wallet: typeof h.wallet === "string" ? h.wallet : "",
        quest: typeof h.quest === "string" ? h.quest : "",
        issuedAt: typeof h.issuedAt === "string" ? h.issuedAt : "",
        redeemed: h.redeemed === true,
        redeemedAt:
          typeof h.redeemedAt === "string" && h.redeemedAt.length > 0
            ? h.redeemedAt
            : null,
      };
    }),
  );
  return records
    .filter((r): r is RewardT => r !== null)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}
