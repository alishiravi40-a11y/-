cat << 'INNER_EOF' >> src/utils/accounting.ts

export function getAvailableSerialNumbers(productId: string, state: AppState): string[] {
  const added = new Set<string>();
  const removed = new Set<string>();

  // Add from opening balances
  state.openingBalances.forEach(ob => {
    ob.items.forEach(item => {
      if (item.productId === productId && item.serialNumbers) {
        item.serialNumbers.forEach(sn => added.add(sn));
      }
    });
  });

  // Add from buy invoices, remove from sell invoices
  state.invoices.forEach(inv => {
    if (inv.isProInvoice) return;
    inv.items.forEach(item => {
      if (item.productId === productId && item.serialNumbers) {
        if (inv.type === 'buy' || inv.type === 'return_sell') {
          item.serialNumbers.forEach(sn => added.add(sn));
        } else if (inv.type === 'sell' || inv.type === 'return_buy') {
          item.serialNumbers.forEach(sn => removed.add(sn));
        }
      }
    });
  });

  return Array.from(added).filter(sn => !removed.has(sn));
}
INNER_EOF
