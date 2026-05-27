import type { ManifestT } from "@/schema/manifest";

// Empty starter manifest used when KV is cold and no manifest has been saved yet.
// First successful POST overwrites this with real data.
export const SEED_MANIFEST: ManifestT = {
  version: 0,
  updatedAt: new Date(0).toISOString(),
  pieces: {},
  anchors: [],
  series: [],
  bookAnchors: [],
  tracks: {},
  playlists: {},
  nowPlaying: { kind: "off" },
  vaultResidencies: {},
  playbackStartedAt: new Date(0).toISOString(),
};
