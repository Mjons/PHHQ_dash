import type { PieceT } from "@/schema/manifest";

// True when the piece should render as <video> instead of <img>. Two signals:
// (1) the src path ends in a video extension — covers SuperRare's signed
//     imgix .mp4 URLs (query string stripped before extension check so the
//     `?...&s=...` HMAC param doesn't break detection); and
// (2) the piece is tagged "animated" or "video" — covers objkt's
//     content-addressed artifact URLs that have no extension at all
//     (`.../artifact?cb=...`, served via content-type negotiation).
// Curator workflow: when seeding a video piece from a host that doesn't
// expose extensions, tag it "animated" so the dashboard renders it correctly.
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
export function isVideoPiece(piece: PieceT): boolean {
  let pathname = piece.src;
  try {
    pathname = new URL(piece.src).pathname;
  } catch {
    pathname = piece.src.split("?")[0];
  }
  if (VIDEO_EXT.test(pathname)) return true;
  return (piece.tags ?? []).some((t) => {
    const k = t.toLowerCase();
    return k === "animated" || k === "video";
  });
}
