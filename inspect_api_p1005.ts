import http from 'http';

function fetchState(): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3000/api/app-state', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  try {
    const res = await fetchState();
    const state = res.data;
    console.log("--- SCANNING API STATE ---");
    console.log("vouchers count:", state?.vouchers?.length);
    console.log("creditFiles count:", state?.creditFiles?.length);
    console.log("persons count:", state?.persons?.length);
    console.log("checks count:", state?.checks?.length);
    console.log("partnerCreditRequests count:", state?.partnerCreditRequests?.length);
    
    // Find any key containing 1005 or P1005
    const matchedPersons = state?.persons?.filter((p: any) => JSON.stringify(p).includes('1005') || JSON.stringify(p).includes('P1005'));
    console.log("Matched Persons:", matchedPersons);
    
    const matchedFiles = state?.creditFiles?.filter((f: any) => JSON.stringify(f).includes('1005') || JSON.stringify(f).includes('P1005'));
    console.log("Matched CreditFiles:", matchedFiles);
    
    const matchedVouchers = state?.vouchers?.filter((v: any) => JSON.stringify(v).includes('1005') || JSON.stringify(v).includes('P1005'));
    console.log("Matched Vouchers:", matchedVouchers?.length);
    if (matchedVouchers?.length > 0) {
      matchedVouchers.forEach((v: any) => {
        console.log(`Voucher ${v.voucherNumber} (${v.id}) - Desc: ${v.description}`);
        v.entries?.forEach((e: any) => {
          console.log(`  Sub: ${e.subsidiaryId} - Debit: ${e.debit} - Credit: ${e.credit} - Detailed: ${e.floatingDetailed?.name} (${e.floatingDetailed?.id}) - Desc: ${e.description}`);
        });
      });
    }
    
    const matchedChecks = state?.checks?.filter((c: any) => JSON.stringify(c).includes('1005') || JSON.stringify(c).includes('P1005'));
    console.log("Matched Checks:", matchedChecks);
    
    // Let's print all creditFiles if any
    if (state?.creditFiles?.length > 0) {
      console.log("All CreditFiles in system:");
      state.creditFiles.forEach((f: any) => console.log(f.id, f.code, f.personId, f.representativeId));
    }
  } catch (err) {
    console.error("Fetch failed:", err);
  }
}

run();
