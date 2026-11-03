/** One estimator for chunking and (later) packing. It is an estimate, not provider usage or billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}
