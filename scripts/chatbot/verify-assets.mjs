// Default is local verification only. --upload is a later, explicit release action.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(await readFile(new URL("../../supabase/functions/_shared/chatbot/assets.json", import.meta.url), "utf8"));
const upload = process.argv.includes("--upload");
const verified = [];
for (const asset of manifest) {
  const path = new URL(`../../docs/chatbot/chatbot-assets/${asset.sourceFilename}`, import.meta.url);
  const bytes = await readFile(path);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== asset.sha256 || bytes.length !== asset.sizeBytes || !asset.enabled) throw new Error(`Asset validation failed: ${asset.id}`);
  verified.push({ asset, bytes });
  console.log(`${asset.auditId} ${asset.id}: ${bytes.length} bytes, SHA-256 verified`);
}
if (upload) {
  const base = new URL(process.env.SUPABASE_URL);
  if (base.protocol !== "https:" || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("HTTPS Supabase URL and service role required");
  const token = process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const { asset, bytes } of verified) {
    const objectPath = `${asset.bucket}/${asset.objectKey}`.split("/").map(encodeURIComponent).join("/");
    const url = new URL(`/storage/v1/object/${objectPath}`, base);
    const headers = { apikey: token, Authorization: `Bearer ${token}` };
    const existing = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (existing.ok) {
      const hash = createHash("sha256").update(new Uint8Array(await existing.arrayBuffer())).digest("hex");
      if (hash !== asset.sha256) throw new Error(`Existing object mismatch: ${asset.id}`);
      console.log(`${asset.id}: already present, verified`);
      continue;
    }
    if (existing.status !== 400 && existing.status !== 404) throw new Error(`Storage read failed: ${asset.id}`);
    const response = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": asset.mimeType, "x-upsert": "false" }, body: bytes, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Storage upload failed: ${asset.id}`);
    const check = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!check.ok || createHash("sha256").update(new Uint8Array(await check.arrayBuffer())).digest("hex") !== asset.sha256) throw new Error(`Storage verification failed: ${asset.id}`);
    console.log(`${asset.id}: uploaded and verified`);
  }
} else {
  console.log(`Verified ${verified.length} local files. No network requests or uploads. Manifest: ${fileURLToPath(new URL("../../supabase/functions/_shared/chatbot/assets.json", import.meta.url))}`);
}
