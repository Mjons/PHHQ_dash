// Seed the Voluptechne residency pieces (full set).
//
// USAGE: open the dashboard in a logged-in browser tab (any page works),
// open DevTools → Console, paste this whole file, hit Enter. The script
// fetches the live manifest, adds the pieces (skipping any whose `id`
// already exists), and POSTs it back. The POST is gated by your session
// cookie, so this only works when you're already logged in.
//
// Re-runnable: existing ids are skipped, never overwritten.

(async () => {
  const NEW_PIECES = [
    {
      id: "vt4-flesh-and-metal",
      src: "https://superrare-artworks.imgix.net/asset/4d29c0cc48eb264584833b5e4024e0df907da5a9c3d23f7300f84987a76c7d33.jpeg?ixlib=js-3.8.0&auto=format&quality=100&cs=origin&w=799&s=a54899ec3c24e8111ce3b4d40991d201",
      aspect: 0.8,
      preferredFrame: "B",
      artist: "Voluptechne",
      title: "Flesh + Metal",
      link: "https://superrare.com/artwork/eth/0x3caabFCad9c7Bb04f62A1D0703FB202CB31D9Dd4/10",
      tags: ["1/1", "eth", "superrare", "sold", "vt4-residency"],
      batch: "vt4-residency",
    },
    {
      id: "vt4-pour-one-out",
      src: "https://superrare-artworks.imgix.net/asset/40e094a2e636ec8e8eca9e27cb589b8c25a45c34099468e8c335e7be412b2d4a.png?ixlib=js-3.8.0&auto=format&quality=100&cs=origin&w=799&s=1c2ea6cc5c629a19802abec06163b34f",
      aspect: 0.8,
      preferredFrame: "B",
      artist: "Voluptechne",
      title: "Pour One Out for the Art Hoes",
      link: "https://superrare.com/artwork/eth/0x3caabFCad9c7Bb04f62A1D0703FB202CB31D9Dd4/12",
      tags: ["1/1", "eth", "superrare", "available", "vt4-residency"],
      batch: "vt4-residency",
    },
    {
      id: "vt4-body-mapping",
      src: "https://superrare-artworks.imgix.net/asset/7d55d2250e526e004d374f057a1cdabb07400ef3ad5d73ad4b535e9021fdd5a5.mp4?ixlib=js-3.8.0&auto=format&quality=100&dpr=2&cs=origin&s=5acd6fea05a3b82705c177801f109976",
      poster:
        "https://superrare-artworks.imgix.net/asset/f4f481fdb011b96d445177e2f1061c6bc13c1b8eb1f2954bb229b4376e22878a.jpeg?ixlib=js-3.8.0&auto=compress&quality=100&dpr=2&cs=origin&w=800&h=418&fm=jpg&fit=crop&s=ad045a51f5e20b67097f55e1e8b612e9",
      aspect: 1.0,
      preferredFrame: "B",
      artist: "Voluptechne",
      title: "Body Mapping",
      link: "https://superrare.com/artwork/eth/0x1259BA696527156C3B1cbdFC74243edBD57F1a82/35",
      tags: ["1/1", "eth", "superrare", "sold", "animated", "vt4-residency"],
      batch: "vt4-residency",
    },
    {
      id: "vt4-lotus-blooms",
      src: "https://lunalauncher.io/empress-trash/body-scanner.jpg",
      aspect: 0.8,
      preferredFrame: "B",
      artist: "Voluptechne",
      title: "Lotus Blooms (Empress Trash)",
      link: "https://lunalauncher.io/mint/empress-trash-lotus-blooms",
      tags: ["ordinal", "base", "physical-print", "available", "vt4-residency"],
      batch: "vt4-residency",
    },
    {
      id: "vt4-royal-self-portrait-22",
      src: "https://assets.objkt.media/file/assets-003/bafybeienalap55twqwl3wf4hbydvfbrylm7wycljyxqnbkijl4oasccaba/artifact",
      aspect: 0.8,
      preferredFrame: "A",
      artist: "Voluptechne",
      title: "Royal Self Portrait #22",
      link: "https://objkt.com/tokens/KT1QK69Z94UxoxCSux36aEKjD6fWHKg7CsQG/22",
      tags: [
        "series",
        "tezos",
        "objkt",
        "open-edition",
        "centerpiece",
        "vt4-residency",
      ],
      batch: "vt4-residency",
    },
    {
      id: "vt4-seventh-gate",
      src: "https://assets.objkt.media/file/assets-003/bafybeifp3u4s4fdbvkzaeypnb57hjhgrzdijl2uduu2peye4tnla2qovei/artifact",
      aspect: 0.8,
      preferredFrame: "B",
      artist: "Voluptechne",
      title: "The Seventh Gate",
      link: "https://objkt.com/tokens/KT18zrvJo2HmRPMkBvwhYdvbEvyujTbF6tbK/12",
      tags: ["tezos", "objkt", "open-edition", "capstone", "vt4-residency"],
      batch: "vt4-residency",
    },

    // ─── SuperRare ETH 1/1s (rest of the set) ─────────────────────────────
    {
      id: "vt4-proud-mary",
      src: "https://superrare-artworks.imgix.net/asset/eca3faa281488e11ace9deb7970a781adba7b3aeafd620a9a1699ed300e71116.jpeg?ixlib=js-3.8.0&auto=format&quality=100&cs=origin&w=1112&s=db1657949e08f32d15d0cf6aab50faf0",
      aspect: 0.8,
      preferredFrame: "B",
      artist: "Voluptechne",
      title: "Proud Mary",
      link: "https://superrare.com/artwork/eth/0x3caabFCad9c7Bb04f62A1D0703FB202CB31D9Dd4/9",
      tags: ["1/1", "eth", "superrare", "sold", "vt4-residency"],
      batch: "vt4-residency",
    },
    {
      id: "vt4-venus-iridescente",
      src: "https://superrare-artworks.imgix.net/asset/d63237213beca6bc6325c290d437ca744d3c6240727f338b0a44617f2627eeb8.jpeg?ixlib=js-3.8.0&auto=format&quality=100&cs=origin&w=799&s=a7825781441a3d9292a80dc1be0946ca",
      aspect: 0.8,
      preferredFrame: "B",
      artist: "Voluptechne",
      title: "Vénus Iridescente",
      link: "https://superrare.com/artwork/eth/0x3caabFCad9c7Bb04f62A1D0703FB202CB31D9Dd4/11",
      tags: ["1/1", "eth", "superrare", "sold", "vt4-residency"],
      batch: "vt4-residency",
    },
    {
      id: "vt4-simple-case",
      src: "https://superrare-artworks.imgix.net/asset/29efd61554639e4ce5f08e622e6973ab81e42ec5bddc1b8271a3765085d9222e.jpeg?ixlib=js-3.8.0&auto=format&quality=100&cs=origin&w=799&s=48c6a7fd728f3aba073b92ed1e2db108",
      aspect: 0.8,
      preferredFrame: "B",
      artist: "Voluptechne",
      title: "Simple Case",
      link: "https://superrare.com/artwork/eth/0x3caabFCad9c7Bb04f62A1D0703FB202CB31D9Dd4/13",
      tags: ["1/1", "eth", "superrare", "available", "vt4-residency"],
      batch: "vt4-residency",
    },
    {
      id: "vt4-ritual-union",
      src: "https://superrare-artworks.imgix.net/asset/cccf8ffefd9c20bc307db9dab5e7ea105a84d861d3902215ae1d61b233c20e98.jpeg?ixlib=js-3.8.0&auto=format&quality=100&cs=origin&w=799&s=736bddef617ba16d3ba9c341bdfc721a",
      aspect: 0.8,
      preferredFrame: "B",
      artist: "Voluptechne",
      title: "Ritual Union",
      link: "https://superrare.com/artwork/eth/0x3caabFCad9c7Bb04f62A1D0703FB202CB31D9Dd4/14",
      tags: ["1/1", "eth", "superrare", "available", "vt4-residency"],
      batch: "vt4-residency",
    },
    {
      // Video piece — `.mp4` in src so the renderer's extension check picks it up.
      id: "vt4-voluptechne-video",
      src: "https://superrare-artworks.imgix.net/asset/e72cb9aeb3547d0db93b8b02e529c357223efdbfd4f51ba98a2a9beb3e67bf33.mp4?ixlib=js-3.8.0&auto=format&quality=100&dpr=2&cs=origin&s=b12492451860e6fb15e566fc4aafdf43",
      poster:
        "https://superrare-artworks.imgix.net/asset/88009d8cec646f743aed80141dda9b216bb25c51924adbd1e794db071fd67ebe.jpeg?ixlib=js-3.8.0&auto=compress&quality=100&dpr=2&cs=origin&w=800&h=418&fm=jpg&fit=crop&s=449c56c3fac1f83fab0c8426f4411b88",
      aspect: 1.0,
      preferredFrame: "B",
      artist: "Voluptechne",
      title: "Voluptechne",
      link: "https://superrare.com/artwork/eth/0x3caabFCad9c7Bb04f62A1D0703FB202CB31D9Dd4/15",
      tags: [
        "1/1",
        "eth",
        "superrare",
        "video",
        "animated",
        "centerpiece",
        "vt4-residency",
      ],
      batch: "vt4-residency",
    },

    // ─── Tezos open editions (objkt) ───────────────────────────────────────
    // Animated pieces — objkt artifact URLs have no extension, so the renderer
    // relies on the "animated" tag to switch to <video>.
    {
      id: "vt4-proof-of-palm",
      src: "https://assets.objkt.media/file/assets-003/bafybeielvkey5bolr27jxixgkfmqzpvqosnmeu425cbmywvoh4vpixhlq4/artifact?cb=bkimo",
      poster:
        "https://assets.objkt.media/file/assets-003/KT1UXZ8HF2aEHhYrYvAmArD5QGjBq61qCFPc/68/social",
      aspect: 1.0,
      preferredFrame: "A",
      artist: "Voluptechne",
      title: "Proof of Palm: Voluptechne",
      link: "https://objkt.com/tokens/KT1UXZ8HF2aEHhYrYvAmArD5QGjBq61qCFPc/68",
      tags: ["tezos", "objkt", "animated", "open-edition", "vt4-residency"],
      batch: "vt4-residency",
    },
    {
      id: "vt4-body-mapping-ii",
      src: "https://assets.objkt.media/file/assets-003/bafybeigvzkof77nyqysbizamjhv4a7dqdf6ltbqeqrheq6ntwaf66txise/artifact?cb=a00ps",
      // Still poster for the scene (objkt `/social` endpoint serves a static
      // preview from their CDN; safer than an IPFS gateway).
      poster:
        "https://assets.objkt.media/file/assets-003/KT1UXZ8HF2aEHhYrYvAmArD5QGjBq61qCFPc/67/social",
      aspect: 1.0,
      preferredFrame: "B",
      artist: "Voluptechne",
      title: "Body Mapping II",
      link: "https://objkt.com/tokens/KT1UXZ8HF2aEHhYrYvAmArD5QGjBq61qCFPc/67",
      tags: [
        "tezos",
        "objkt",
        "animated",
        "full-moon-airdrop",
        "vt4-residency",
      ],
      batch: "vt4-residency",
    },

    // Royal Self Portrait series — Tezos stills, shared `rsp` tag for filtering.
    {
      id: "vt4-royal-self-portrait-27",
      src: "https://assets.objkt.media/file/assets-003/bafybeidvlilbrj6d4e7nldlzaemxd2h7shfiej4nwqaxpqspcs56ur4pta/artifact?cb=b9q24",
      aspect: 0.8,
      preferredFrame: "A",
      artist: "Voluptechne",
      title: "Royal Self Portrait #27",
      link: "https://objkt.com/tokens/KT1QK69Z94UxoxCSux36aEKjD6fWHKg7CsQG/27",
      tags: [
        "series",
        "rsp",
        "tezos",
        "objkt",
        "open-edition",
        "vt4-residency",
      ],
      batch: "vt4-residency",
    },
    {
      id: "vt4-royal-self-portrait-26",
      src: "https://assets.objkt.media/file/assets-003/bafybeifmx2d5gpadmedcwxcubtsrrndkufprr3m7uvhno3vu5vxho5zvqy/artifact?cb=a4f62",
      aspect: 0.8,
      preferredFrame: "A",
      artist: "Voluptechne",
      title: "Royal Self Portrait #26",
      link: "https://objkt.com/tokens/KT1QK69Z94UxoxCSux36aEKjD6fWHKg7CsQG/26",
      tags: [
        "series",
        "rsp",
        "tezos",
        "objkt",
        "open-edition",
        "vt4-residency",
      ],
      batch: "vt4-residency",
    },
    {
      id: "vt4-royal-self-portrait-25",
      src: "https://assets.objkt.media/file/assets-003/bafybeicp6dyxzcyub7xokblytvabdcynab3yzdrof7fkppgromz6cju7mm/artifact?cb=97jrg",
      aspect: 0.8,
      preferredFrame: "A",
      artist: "Voluptechne",
      title: "Royal Self Portrait #25",
      link: "https://objkt.com/tokens/KT1QK69Z94UxoxCSux36aEKjD6fWHKg7CsQG/25",
      tags: [
        "series",
        "rsp",
        "tezos",
        "objkt",
        "open-edition",
        "vt4-residency",
      ],
      batch: "vt4-residency",
    },
    {
      id: "vt4-royal-self-portrait-24",
      src: "https://assets.objkt.media/file/assets-003/bafybeiemsf5bxrt3gkiuzyncvau6gwsc3nqupmt2ltrftsxlewhgezkbsq/artifact?cb=948jr",
      aspect: 0.8,
      preferredFrame: "A",
      artist: "Voluptechne",
      title: "Royal Self Portrait #24",
      link: "https://objkt.com/tokens/KT1QK69Z94UxoxCSux36aEKjD6fWHKg7CsQG/24",
      tags: [
        "series",
        "rsp",
        "tezos",
        "objkt",
        "open-edition",
        "vt4-residency",
      ],
      batch: "vt4-residency",
    },
    {
      id: "vt4-royal-self-portrait-23",
      src: "https://assets.objkt.media/file/assets-003/bafybeiaficgu3c7uyu757u75qq2fpyhjbpzsv2wblv5w6vfyypbh4dknoe/artifact",
      aspect: 0.8,
      preferredFrame: "A",
      artist: "Voluptechne",
      title: "Royal Self Portrait #23",
      link: "https://objkt.com/tokens/KT1QK69Z94UxoxCSux36aEKjD6fWHKg7CsQG/23",
      tags: [
        "series",
        "rsp",
        "tezos",
        "objkt",
        "open-edition",
        "vt4-residency",
      ],
      batch: "vt4-residency",
    },
    {
      id: "vt4-royal-self-portrait-21",
      src: "https://assets.objkt.media/file/assets-003/bafybeicijwbddl5boc5ordsrx7v4efdad52lymuiq537dyg2zzyathxsgq/artifact",
      aspect: 0.8,
      preferredFrame: "A",
      artist: "Voluptechne",
      title: "Royal Self Portrait #21",
      link: "https://objkt.com/tokens/KT1QK69Z94UxoxCSux36aEKjD6fWHKg7CsQG/21",
      tags: [
        "series",
        "rsp",
        "tezos",
        "objkt",
        "open-edition",
        "vt4-residency",
      ],
      batch: "vt4-residency",
    },
    {
      id: "vt4-royal-self-portrait-20",
      src: "https://assets.objkt.media/file/assets-003/bafybeihy54by7mzqnzwbu4xnyithupgnhmyo5sx3kvqxlzlff3i26wmgbe/artifact",
      aspect: 0.8,
      preferredFrame: "A",
      artist: "Voluptechne",
      title: "Royal Self Portrait #20",
      link: "https://objkt.com/tokens/KT1QK69Z94UxoxCSux36aEKjD6fWHKg7CsQG/20",
      tags: [
        "series",
        "rsp",
        "tezos",
        "objkt",
        "open-edition",
        "vt4-residency",
      ],
      batch: "vt4-residency",
    },
    {
      id: "vt4-royal-self-portrait-19",
      src: "https://assets.objkt.media/file/assets-003/bafybeigekjsq45dubctoljnvcdpn6zuv7v7enyj2d5xfopcsdztzjnabsi/artifact",
      aspect: 0.8,
      preferredFrame: "A",
      artist: "Voluptechne",
      title: "Royal Self Portrait #19",
      link: "https://objkt.com/tokens/KT1QK69Z94UxoxCSux36aEKjD6fWHKg7CsQG/19",
      tags: [
        "series",
        "rsp",
        "tezos",
        "objkt",
        "open-edition",
        "vt4-residency",
      ],
      batch: "vt4-residency",
    },
    {
      id: "vt4-royal-self-portrait-14",
      src: "https://assets.objkt.media/file/assets-003/bafybeidgzu7yl5pa6dh5zcvxuswe7pl4ywjbzafwvq4txdd5okdrzgoe5a/artifact",
      aspect: 0.8,
      preferredFrame: "A",
      artist: "Voluptechne",
      title: "Royal Self Portrait #14",
      link: "https://objkt.com/tokens/KT1QK69Z94UxoxCSux36aEKjD6fWHKg7CsQG/14",
      tags: [
        "series",
        "rsp",
        "tezos",
        "objkt",
        "open-edition",
        "vt4-residency",
      ],
      batch: "vt4-residency",
    },

    // ─── Base airdrop ──────────────────────────────────────────────────────
    {
      id: "vt4-blood-moon-eclipse",
      src: "https://i2c.seadn.io/base/0x28aa49080b332805e5c1fecec92019fd5b3ff151/81ef27565d40e1937c31571c87abd7/9c81ef27565d40e1937c31571c87abd7.jpeg?w=1000",
      aspect: 1.0,
      preferredFrame: "B",
      artist: "Voluptechne",
      title: "Blood Moon Lunar Eclipse",
      link: "https://opensea.io/item/base/0x28aa49080b332805e5c1fecec92019fd5b3ff151/6",
      tags: ["base", "opensea", "airdrop", "fan-favorite", "vt4-residency"],
      batch: "vt4-residency",
    },

    // ─── Text pieces (Lighthouse / IPFS) ───────────────────────────────────
    // Tall narrow aspect for text plaques; preferred frame A (minimal).
    {
      id: "vt4-voluptechne-manifesto",
      src: "https://uptight-possum-3q15c.lighthouseweb3.xyz/ipfs/bafkreigqckrl26f3jrcsmrnnsvz7bbderydfhtrx5pzp3ix4vvsa4mvxqm",
      aspect: 0.7,
      preferredFrame: "A",
      artist: "Voluptechne",
      title: "Voluptechne Manifesto",
      link: "https://objkt.com/tokens/KT1UXZ8HF2aEHhYrYvAmArD5QGjBq61qCFPc/66",
      tags: ["text", "manifesto", "tezos", "vt4-residency"],
      batch: "vt4-residency",
    },
    {
      id: "vt4-voluptechne-definition",
      src: "https://uptight-possum-3q15c.lighthouseweb3.xyz/ipfs/bafkreihn7z2wgmhacmz5uvi7fz2qgu6nn5ddywoseqxb4cwehpeave66zu",
      aspect: 0.7,
      preferredFrame: "A",
      artist: "Voluptechne",
      title: "Voluptechne Definition",
      link: "https://objkt.com/tokens/KT1UXZ8HF2aEHhYrYvAmArD5QGjBq61qCFPc/66",
      tags: ["text", "definition", "tezos", "vt4-residency"],
      batch: "vt4-residency",
    },
  ];

  console.log("[seed] fetching live manifest…");
  const getRes = await fetch("/api/manifest", { cache: "no-store" });
  if (!getRes.ok) throw new Error(`GET /api/manifest: ${getRes.status}`);
  const manifest = await getRes.json();
  console.log(
    `[seed] manifest v${manifest.version} · ${Object.keys(manifest.pieces).length} pieces`,
  );

  const nextPieces = { ...manifest.pieces };
  const added = [];
  const skipped = [];
  for (const p of NEW_PIECES) {
    if (nextPieces[p.id]) {
      skipped.push(p.id);
    } else {
      nextPieces[p.id] = p;
      added.push(p.id);
    }
  }

  if (added.length === 0) {
    console.log("[seed] nothing to do — all pieces already exist:", skipped);
    return;
  }

  console.log("[seed] adding:", added);
  if (skipped.length) console.log("[seed] skipping (already exist):", skipped);

  const postRes = await fetch("/api/manifest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...manifest, pieces: nextPieces }),
  });
  if (!postRes.ok) {
    const text = await postRes.text();
    throw new Error(`POST /api/manifest: ${postRes.status} ${text}`);
  }
  const saved = await postRes.json();
  console.log(
    `[seed] done · manifest v${saved.version} · ${Object.keys(saved.pieces).length} pieces`,
  );
})();
