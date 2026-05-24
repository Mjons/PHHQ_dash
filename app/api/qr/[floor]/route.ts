import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { isVTFloor } from "@/lib/tips";

// GET /api/qr/<floor>.png
// Returns a PNG QR code that encodes the public tip URL for the given VT
// floor. The QR is purely a function of (origin, floor) — never changes for
// a stable deployment URL — so we cache aggressively.
//
// Used by the in-scene pedestal as a wall texture and by the dashboard's
// Vault tab preview. The scene fetches it once at boot and reuses forever.

export const dynamic = "force-static";

// Strip a `.png` suffix so the URL can be either /api/qr/vt3 or
// /api/qr/vt3.png — the scene's texture loader prefers explicit extensions.
function normalizeFloorParam(raw: string): string {
  return raw.replace(/\.png$/i, "").toLowerCase();
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ floor: string }> },
) {
  const { floor: rawFloor } = await params;
  const floor = normalizeFloorParam(rawFloor);
  if (!isVTFloor(floor)) {
    return new NextResponse("unknown vt floor", { status: 404 });
  }

  // Use request origin so the QR works in any environment (preview deploys,
  // localhost, prod) without baking the URL into env.
  // NOTE: in `force-static` mode `_req.url` may be the build-time URL; if
  // that becomes an issue in preview deploys, drop force-static and switch
  // to `dynamic = "force-dynamic"` with a long max-age — the cost difference
  // is trivial since the QR data is ~1 KB per floor.
  const base =
    process.env.NEXT_PUBLIC_DASHBOARD_URL ??
    "https://phhq-dash-rkwi.vercel.app";
  const tipUrl = `${base}/tip/${floor}`;

  const png = await QRCode.toBuffer(tipUrl, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512,
    color: {
      // Match the venue's ink-on-cream palette so the QR reads as part of
      // the pedestal rather than a foreign artifact.
      dark: "#0a0a0a",
      light: "#f4ecd8",
    },
  });

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      // QR contents are URL-stable; cache for a year at the edge, allow
      // immutable revalidation. Scene-side and dashboard both want to load
      // these without a roundtrip cost.
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*",
    },
  });
}
