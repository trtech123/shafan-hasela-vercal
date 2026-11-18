export const emptySignature = () => ({ width: 1, height: 1, strokes: [] });
export function validSignature(signature) {
  if (signature?.width !== 1 || signature?.height !== 1 || !Array.isArray(signature.strokes) || signature.strokes.length > 64) return false;
  let count = 0;
  let distinct = false;
  for (const stroke of signature.strokes) {
    if (!Array.isArray(stroke) || stroke.length < 2 || stroke.length > 512) return false;
    count += stroke.length;
    for (const point of stroke) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return false;
      if (stroke[0] && (point.x !== stroke[0].x || point.y !== stroke[0].y)) distinct = true;
    }
  }
  // PostgreSQL stores jsonb with whitespace; reserve more than its per-point
  // punctuation overhead below the RPC's 100000-byte limit. Canvas coordinates
  // are rounded to five decimals, avoiding exponent expansion in jsonb numbers.
  return count <= 4096 && distinct && JSON.stringify(signature).length + count * 6 + signature.strokes.length * 2 + 32 <= 100000;
}
