// Shared helpers for endpoints the DCL scene calls via `signedFetch`.
//
// signedFetch attaches the Decentraland auth-chain as `x-identity-auth-chain-N`
// headers; link 0 is the SIGNER, whose `payload` is the player's wallet. We do
// NOT cryptographically verify the signature (lowest-friction, low-value prize —
// same stance as app/api/quest-status/route.ts). If a reward ever gates real
// value, upgrade here with `@dcl/crypto` + `Authenticator.validateSignature`.

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

// Extract the signer wallet from the auth-chain header, or null when absent /
// unparseable (the scene just keeps polling — the correct degrade).
export function signerFromAuthChain(req: Request): string | null {
  const raw = req.headers.get("x-identity-auth-chain-0");
  if (!raw) return null;
  try {
    const link = JSON.parse(raw);
    const payload = link?.payload;
    if (typeof payload === "string" && WALLET_RE.test(payload)) {
      return payload;
    }
  } catch {
    // Malformed header — treat as unauthenticated.
  }
  return null;
}

// signedFetch sends custom x-identity-* headers (not CORS-safelisted), so the
// DCL runtime issues a preflight. Echo the allowed headers so the real request
// goes through. Covers GET (status) and POST (issue).
export const DCL_CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers":
    "x-identity-auth-chain-0, x-identity-auth-chain-1, x-identity-auth-chain-2, x-identity-timestamp, x-identity-metadata, content-type",
  "access-control-max-age": "86400",
};
