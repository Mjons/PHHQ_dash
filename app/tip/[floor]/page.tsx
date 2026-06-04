import { notFound } from "next/navigation";
import { redis, MANIFEST_KEY } from "@/lib/redis";
import {
  Manifest,
  VAULT_FLOOR_LABEL,
  type VaultResidencyT,
} from "@/schema/manifest";
import { SEED_MANIFEST } from "@/lib/seed";
import { isVTFloor } from "@/lib/tips";
import TipPageClient from "./tip-page-client";

// Public tip page. Reached via the in-scene pedestal QR / `openExternalUrl`
// button, or directly from the dashboard's "preview tip page" link.
//
// MVP scope (b): no wallet integration. We render the artist's address,
// EIP-681 deep links for common amounts (works in MetaMask Mobile / Rainbow /
// Trust / Coinbase Wallet on phones), and a copy button as universal
// fallback. Funds go wallet-to-wallet on Polygon; we never custody and
// nothing in our infra has to detect the tx for the artist to be paid.
//
// Tip detection (gold-floor reward + counters) is deferred to v1.5; see
// docs/archive/VAULT_TIPPING_PLAN.md.

async function readManifest() {
  const raw = await redis.get<unknown>(MANIFEST_KEY);
  if (!raw) return SEED_MANIFEST;
  return Manifest.parse(raw);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ floor: string }>;
}) {
  const { floor } = await params;
  return {
    title: `Tip ${floor.toUpperCase()} — Panel Haus`,
    // No-index — these are operational pages, not content. Also discourages
    // a search-indexed page accidentally revealing artist addresses.
    robots: "noindex, nofollow",
  };
}

export default async function TipPage({
  params,
}: {
  params: Promise<{ floor: string }>;
}) {
  const { floor } = await params;
  if (!isVTFloor(floor)) notFound();

  const manifest = await readManifest();
  const residency: VaultResidencyT | undefined =
    manifest.vaultResidencies[floor];

  const floorLabel = VAULT_FLOOR_LABEL[floor];
  const expired = !!(
    residency?.activeUntil && Date.parse(residency.activeUntil) < Date.now()
  );

  if (!residency) {
    return (
      <UnconfiguredState floorLabel={floorLabel}>
        <p>This Vault floor doesn&apos;t currently have a residency.</p>
        <p className="mt-2 text-xs text-muted">
          Come back when the curator activates an artist on this floor.
        </p>
      </UnconfiguredState>
    );
  }

  if (expired) {
    return (
      <UnconfiguredState floorLabel={floorLabel}>
        <p>This residency has ended.</p>
        <p className="mt-2 text-xs text-muted">
          {residency.artistName ?? "The artist"} was in residence here through{" "}
          {new Date(residency.activeUntil!).toLocaleDateString()}.
        </p>
      </UnconfiguredState>
    );
  }

  return (
    <TipPageClient
      floor={floor}
      floorLabel={floorLabel}
      residency={residency}
    />
  );
}

function UnconfiguredState({
  floorLabel,
  children,
}: {
  floorLabel: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-cream text-ink flex items-center justify-center px-6 py-12">
      <div className="max-w-md w-full">
        <div className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">
          Panel Haus · {floorLabel}
        </div>
        <div className="border-[3px] border-ink bg-cream-dark p-6 shadow-[4px_4px_0_var(--color-ink)] text-sm">
          {children}
        </div>
      </div>
    </main>
  );
}
