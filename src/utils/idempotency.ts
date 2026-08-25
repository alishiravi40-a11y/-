/**
 * Idempotency & Request Fingerprint Helpers
 */

export function buildTransferFingerprint(
  organizationId: string,
  sourceWarehouseId: string,
  destinationWarehouseId: string,
  transferDate: string,
  items: Array<{ productId: string; quantity: number; serialNumbers?: string[] }>
): string {
  const normalizedItems = (items || []).map(item => ({
    productId: item.productId,
    quantity: Number(item.quantity),
    serials: item.serialNumbers ? [...item.serialNumbers].sort() : []
  })).sort((a, b) => a.productId.localeCompare(b.productId));

  const raw = JSON.stringify({
    org: organizationId,
    src: sourceWarehouseId,
    dst: destinationWarehouseId,
    date: transferDate,
    items: normalizedItems
  });

  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `fp_tr_${Math.abs(hash)}_${raw.length}`;
}

export function buildReversalFingerprint(
  organizationId: string,
  transactionId: string,
  reversalReason: string
): string {
  const raw = `${organizationId}:${transactionId}:${reversalReason.trim()}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `fp_rev_${Math.abs(hash)}_${raw.length}`;
}
