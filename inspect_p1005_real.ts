import fs from 'fs';
const state = JSON.parse(fs.readFileSync('central_app_state.json', 'utf8'));

const person = state.persons.find((p: any) => p.code === 'P1005' || p.name === 'باقالی');
if (!person) {
  console.log("Person P1005 not found");
  process.exit(1);
}
console.log("Person ID:", person.id, "Name:", person.name);

const creditFiles = state.creditFiles.filter((f: any) => f.personId === person.id);
console.log("\n--- Credit Files ---");
console.log(JSON.stringify(creditFiles, null, 2));

const checks = state.checks.filter((c: any) => c.personId === person.id);
console.log("\n--- Checks ---");
console.log(JSON.stringify(checks, null, 2));

const vouchers = state.vouchers.filter((v: any) => {
  return v.entries.some((e: any) => e.floatingDetailed?.id === person.id) || 
         creditFiles.some((f: any) => (v.creditFileId === f.id || v.description?.includes(f.id)));
});
console.log("\n--- Vouchers ---");
vouchers.forEach((v: any) => {
  console.log(`Voucher #${v.voucherNumber} (${v.id}) - ${v.description}`);
  v.entries.forEach((e: any) => {
    console.log(`  [${e.subsidiaryId}] - Debit: ${e.debit} - Credit: ${e.credit} - Detailed: ${e.floatingDetailed?.name} (${e.floatingDetailed?.id}) - Desc: ${e.description}`);
  });
});

