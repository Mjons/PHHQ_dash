import { list, put } from "@vercel/blob";

const SOURCE_TOKEN = process.env.SOURCE_BLOB_TOKEN;
const DEST_TOKEN = process.env.DEST_BLOB_TOKEN;
if (!SOURCE_TOKEN || !DEST_TOKEN) {
  console.error("Set SOURCE_BLOB_TOKEN and DEST_BLOB_TOKEN env vars.");
  process.exit(1);
}

async function migrate() {
  let cursor;
  let count = 0;
  let bytes = 0;
  const failed = [];

  do {
    const page = await list({ cursor, token: SOURCE_TOKEN, limit: 1000 });
    for (const blob of page.blobs) {
      try {
        const res = await fetch(blob.url);
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const body = await res.arrayBuffer();
        await put(blob.pathname, body, {
          access: "public",
          token: DEST_TOKEN,
          addRandomSuffix: false,
          contentType: blob.contentType,
        });
        count++;
        bytes += blob.size;
        console.log(`[${count}] ${blob.pathname}  (${blob.size} bytes)`);
      } catch (e) {
        console.error(`FAIL ${blob.pathname}: ${e.message}`);
        failed.push(blob.pathname);
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  console.log(`\nDone: ${count} blobs, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  if (failed.length) {
    console.log(`Failed (${failed.length}):`);
    failed.forEach((p) => console.log("  " + p));
    process.exit(2);
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
