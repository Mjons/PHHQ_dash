import { Redis } from "@upstash/redis";

// Vercel Marketplace's Upstash Redis integration sets URL + TOKEN env vars.
// Different integrations use different prefixes — check both.
function pickEnv(...keys: string[]): string {
  for (const k of keys) {
    const v = process.env[k];
    if (v) return v;
  }
  return "";
}

const url = pickEnv("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL");
const token = pickEnv("UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN");

if (!url || !token) {
  // Soft-warn at import time — runtime calls will fail with a clearer error.
  // (Build-time evaluation won't always have these set; that's fine.)
  if (typeof console !== "undefined") {
    console.warn("[redis] missing UPSTASH_REDIS_REST_URL / _TOKEN env vars");
  }
}

export const redis = new Redis({ url, token });

export const MANIFEST_KEY = "panelhaus:manifest:v1";
