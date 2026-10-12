import manifest from "./assets.json" with { type: "json" };

export const assetManifest = Object.freeze(manifest.map((asset) => Object.freeze(asset)));

export function getAsset(id, assets = assetManifest) {
  return assets.find((asset) => asset.id === id && asset.enabled === true) ?? null;
}

// Service-role client only. No URL, object key or filename is accepted from the customer.
export function createAssetLoader(client, assets = assetManifest) {
  return async function loadAsset(id, checksum) {
    try {
      const asset = getAsset(id, assets);
      if (!asset || checksum !== asset.sha256 || !client) throw new Error();
      const { data, error } = await client.storage.from(asset.bucket).download(asset.objectKey);
      if (error || !data || data.size !== asset.sizeBytes || data.type !== asset.mimeType) throw new Error();
      const bytes = new Uint8Array(await data.arrayBuffer());
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      if (hash !== asset.sha256) throw new Error();
      const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!(asset.mimeType === "application/pdf" && isPdf) && !(asset.mimeType === "image/jpeg" && isJpeg)) throw new Error();
      return { asset, blob: data };
    } catch {
      throw new Error("chatbot_asset_unavailable");
    }
  };
}
