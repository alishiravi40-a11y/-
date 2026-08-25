import { finalizeCreditFile, cancelCreditFileAtomic } from '../utils/partnerProcess';
import { CreditFile, Person, Invoice, Check, Product, JournalVoucher } from '../types';
import { 
  DEFAULT_SUBSIDIARIES, 
  createInvoiceVoucher, 
  createCheckStateVoucher, 
  calculateInstallments, 
  calculateProductStocks, 
  calculatePersonBalances,
  getFilteredPersonsForSell,
  isValidCheckTransition
} from '../utils/accounting';

// Helper to sum up accounts
function calculateBalances(vouchers: any[], personId?: string) {
  const balances: Record<string, number> = {};
  vouchers.forEach(v => {
    v.entries.forEach((e: any) => {
      if (personId && e.floatingDetailed?.id !== personId) return;
      const amount = e.debit - e.credit;
      balances[e.subsidiaryId] = (balances[e.subsidiaryId] || 0) + amount;
    });
  });
  return balances;
}

function verifyVoucherBalance(voucher: JournalVoucher): boolean {
  const totalDebit = voucher.entries.reduce((sum, e) => sum + (e.debit || 0), 0);
  const totalCredit = voucher.entries.reduce((sum, e) => sum + (e.credit || 0), 0);
  return totalDebit === totalCredit;
}

function runTests() {
  console.log("=======================================================");
  console.log("🚀 Running Financial & Operational Regression Guard v1");
  console.log("=======================================================\n");

  const customerPersonId = "cust_1";
  const partnerPersonId = "part_1";

  const customer: Person = {
    id: customerPersonId,
    name: "Customer A", code: "CUST1",
    createdAt: new Date().toISOString()
  };

  const partner: Person = {
    id: partnerPersonId,
    name: "Partner A", code: "PART1",
    isAgent: true,
    createdAt: new Date().toISOString()
  };

  const persons = [customer, partner];

  // -------------------------------------------------------------
  // SUITE 1: Credit Request & Commission Engine
  // -------------------------------------------------------------
  // Test 1: Credit request WITHOUT agent commission
  const req1: CreditFile = {
    id: "req_1",
    personId: customerPersonId,
    representativeId: partnerPersonId,
    status: "final_approved",
    requestedAmount: 100000000,
    creditAmount: 100000000,
    termCount: 12,
    calcType: 'sadi_bazaar',
    agentCommissionAmount: 0,
    createdAt: new Date().toISOString(),
    calculationResults: {
      totalRepayment: 142000000,
      totalCommission: 42000000,
      partnerCommission: 0,
      installments: [],
      representativeCommissionAmount: 0,
      representativeCommissionPercent: 0
    }
  } as any;

  const state1: any = { persons, vouchers: [], checks: [], installmentBooks: [], creditFiles: [req1] };
  const res1 = finalizeCreditFile(req1.id, state1);

  const balances1Customer = calculateBalances(res1.vouchers || [], customerPersonId);
  const balances1Partner = calculateBalances(res1.vouchers || [], partnerPersonId);
  const totalBalances1 = calculateBalances(res1.vouchers || []);

  const expectedTotalRepayment1 = 142000000; 
  if (balances1Customer['SUB_DEBTORS_INSTALLMENT'] !== expectedTotalRepayment1) {
    throw new Error(`Test 1 Failed: Expected customer debit ${expectedTotalRepayment1}, got ${balances1Customer['SUB_DEBTORS_INSTALLMENT']}`);
  }
  if (totalBalances1['SUB_INTEREST_INCOME'] !== -42000000) {
    throw new Error(`Test 1 Failed: Expected interest income -42000000, got ${totalBalances1['SUB_INTEREST_INCOME']}`);
  }
  if (balances1Partner['SUB_CREDITORS'] !== -100000000) {
    throw new Error(`Test 1 Failed: Expected partner creditor -100000000, got ${balances1Partner['SUB_CREDITORS']}`);
  }
  console.log("✅ Test 1 Passed: Credit Request WITHOUT Agent Commission");

  // Test 2: Credit request WITH agent commission
  const req2: CreditFile = {
    ...req1,
    id: "req_2",
    agentCommissionAmount: 5000000,
    agentCommissionRate: 5,
    calculationResults: {
      totalRepayment: 147000000,
      totalCommission: 47000000,
      partnerCommission: 0,
      installments: [],
      representativeCommissionAmount: 5000000,
      representativeCommissionPercent: 5
    }
  } as any;
  
  const state2: any = { persons, vouchers: [], checks: [], installmentBooks: [], creditFiles: [req2] };
  const res2 = finalizeCreditFile(req2.id, state2);

  const balances2Customer = calculateBalances(res2.vouchers || [], customerPersonId);
  const balances2Partner = calculateBalances(res2.vouchers || [], partnerPersonId);
  const totalBalances2 = calculateBalances(res2.vouchers || []);

  const expectedTotalRepayment2 = 147000000;
  if (balances2Customer['SUB_DEBTORS_INSTALLMENT'] !== expectedTotalRepayment2) {
    throw new Error(`Test 2 Failed: Expected customer debit ${expectedTotalRepayment2}, got ${balances2Customer['SUB_DEBTORS_INSTALLMENT']}`);
  }
  if (totalBalances2['SUB_INTEREST_INCOME'] !== -42000000) {
    throw new Error(`Test 2 Failed: Expected NET interest income -42000000, got ${totalBalances2['SUB_INTEREST_INCOME']}`);
  }
  if (balances2Partner['SUB_CREDITORS'] !== -105000000) {
    throw new Error(`Test 2 Failed: Expected partner creditor -105000000, got ${balances2Partner['SUB_CREDITORS']}`);
  }
  console.log("✅ Test 2 Passed: Credit Request WITH Agent Commission");

  // -------------------------------------------------------------
  // SUITE 2: Voucher Balance & Accounting Integrity (الف)
  // -------------------------------------------------------------
  // Test 3: Voucher debit == credit balance check
  res2.vouchers?.forEach((v, idx) => {
    if (!verifyVoucherBalance(v)) {
      throw new Error(`Test 3 Failed: Voucher ${v.id || idx} is unbalanced.`);
    }
  });
  
  // Unbalanced voucher rejection check
  const unbalancedVoucher: JournalVoucher = {
    id: "v_err",
    voucherNumber: 999,
    date: "1403/01/01",
    description: "Unbalanced test",
    status: "active",
    gregorianDate: new Date().toISOString(),
    isAutomatic: true,
    entries: [
      {  subsidiaryId: "SUB_DEBTORS", debit: 100, credit: 0, description: "D" },
      {  subsidiaryId: "SUB_REVENUE", debit: 0, credit: 90, description: "C" }
    ]
  };
  if (verifyVoucherBalance(unbalancedVoucher) !== false) {
    throw new Error("Test 3 Failed: Unbalanced voucher was wrongly marked as balanced!");
  }
  console.log("✅ Test 3 Passed: Voucher Double-Entry Balance Verification Guard");

  // -------------------------------------------------------------
  // SUITE 3: Sales Cycle & Voucher Linkage (ب)
  // -------------------------------------------------------------
  // Test 4: Sales Invoice to Voucher Generation & Reference Control
  const testProduct: Product = {
    id: "prod_1",
    code: "P1",
    name: "Test Laptop",
    unit: "عدد", category: "Test", reorderPoint: 5, createdAt: new Date().toISOString(),
    initialUnitCost: 10000000,
    defaultSalePrice: 15000000,
    initialStock: 10
  };

  const sellInvoice: Invoice = {
    id: "inv_sell_1",
    invoiceNumber: 1001,
    type: "sell",
    date: "1403/01/10",
    personId: customerPersonId,
    items: [
      {
        productId: testProduct.id,
        quantity: 2,
        unitPrice: 15000000,
        warehouseId: "w1",
        discount: 0,
        totalCostPrice: 20000000
      }
    ],
    totalAmount: 30000000,
    discount: 0,
    taxPercent: 0,
    paidAmount: 0,
    status: "active",
    isProInvoice: false,
    isConverted: false,
    createdAt: new Date().toISOString()
  };

  const dummyCurrentStocks: any = {
    [testProduct.id]: { initialStock: 10, totalCost: 100000000, averageCost: 10000000 }
  };

  const invoiceVoucher = createInvoiceVoucher(
    sellInvoice,
    customer.name,
    101,
    DEFAULT_SUBSIDIARIES,
    dummyCurrentStocks
  );

  if (!verifyVoucherBalance(invoiceVoucher)) {
    throw new Error("Test 4 Failed: Sales Invoice Voucher is not balanced.");
  }

  // Check accounts inside sales voucher
  const salesDebit = invoiceVoucher.entries.find(e => e.subsidiaryId === 'SUB_DEBTORS')?.debit;
  const salesCredit = invoiceVoucher.entries.find(e => e.subsidiaryId === 'SUB_REVENUE')?.credit;
  const cogsDebit = invoiceVoucher.entries.find(e => e.subsidiaryId === 'SUB_COGS')?.debit;
  const inventoryCredit = invoiceVoucher.entries.find(e => e.subsidiaryId === 'SUB_INVENTORY')?.credit;

  if (salesDebit !== 30000000 || salesCredit !== 30000000) {
    throw new Error(`Test 4 Failed: Sales revenue entries incorrect. Debit: ${salesDebit}, Credit: ${salesCredit}`);
  }
  if (cogsDebit !== 20000000 || inventoryCredit !== 20000000) {
    throw new Error(`Test 4 Failed: COGS/Inventory entries incorrect. COGS: ${cogsDebit}, Inventory: ${inventoryCredit}`);
  }
  console.log("✅ Test 4 Passed: Sales Cycle Voucher Creation & Account Allocation");

  // -------------------------------------------------------------
  // SUITE 4: Installments Engine (ج)
  // -------------------------------------------------------------
  // Test 5: Installments calculation precision & sum integrity
  const plan = {
    id: "p1",
    name: "Standard Plan",
    interestRate: 24, // 24% annual
    maxTerms: 12,
    prepaymentPercent: 10,
    penaltyRate: 0.1,
    maxTerm: 12,
    isActive: true
  };

  const instResult = calculateInstallments(100000000, 20000000, 12, plan, "1403/01/01", 30);
  
  if (instResult.installments.length !== 12) {
    throw new Error(`Test 5 Failed: Expected 12 installments, got ${instResult.installments.length}`);
  }

  const sumInstallments = instResult.installments.reduce((sum, item) => sum + item.amount, 0);
  if (Math.abs(sumInstallments - instResult.totalPayable) > 100) {
    throw new Error(`Test 5 Failed: Sum of installments (${sumInstallments}) does not match totalPayable (${instResult.totalPayable})`);
  }
  if (Math.abs((80000000 + instResult.totalInterest) - instResult.totalPayable) > 100) {
    throw new Error(`Test 5 Failed: Principal + Interest does not equal totalPayable.`);
  }
  console.log("✅ Test 5 Passed: Installments Calculation & Total Sum Consistency");

  // -------------------------------------------------------------
  // SUITE 5: Check Lifecycle & Vouchers (د)
  // -------------------------------------------------------------
  // Test 6: Check State Transitions and Vouchers
  const sampleCheck: Check = {
    id: "chk_101",
    checkNumber: "778899",
    bankName: "Melli",
    personId: customerPersonId,
    amount: 15000000,
    dueDate: "1403/02/15",
    type: "received",
    currentState: "present_in_cashbox", history: [],
    createdAt: new Date().toISOString()
  };

  // Transition: in_hand -> in_bank
  const chkVoucher1 = createCheckStateVoucher(
    sampleCheck,
    customer.name,
    "present_in_cashbox",
    "deposited_to_bank",
    201,
    "SUB_BANK_MELI"
  );
  if (!verifyVoucherBalance(chkVoucher1)) {
    throw new Error("Test 6 Failed: Check in_bank voucher unbalanced.");
  }

  // Transition: in_bank -> cleared
  const chkVoucher2 = createCheckStateVoucher(
    sampleCheck,
    customer.name,
    "deposited_to_bank",
    "cleared",
    202,
    "SUB_BANK_MELI"
  );
  if (!verifyVoucherBalance(chkVoucher2)) {
    throw new Error("Test 6 Failed: Check cleared voucher unbalanced.");
  }
  console.log("✅ Test 6 Passed: Check Lifecycle Status Vouchers");

  // -------------------------------------------------------------
  // SUITE 6: Warehouse Stock Tracking (هـ)
  // -------------------------------------------------------------
  // Test 7: Stock calculation based on Buy and Sell Invoices
  const buyInvoice: Invoice = {
    id: "inv_buy_1",
    invoiceNumber: 1,
    type: "buy",
    date: "1403/01/01",
    personId: partnerPersonId,
    items: [
      { productId: testProduct.id, quantity: 10, unitPrice: 10000000, warehouseId: "w1", discount: 0 }
    ],
    totalAmount: 100000000,
    discount: 0,
    taxPercent: 0,
    paidAmount: 0,
    status: "active",
    isProInvoice: false,
    isConverted: false,
    createdAt: new Date().toISOString()
  };

  const calculatedStocks = calculateProductStocks(
    [testProduct],
    [buyInvoice, sellInvoice], // 10 bought, 2 sold
    [],
    []
  );

  const productStockInfo = calculatedStocks[testProduct.id];
  if (!productStockInfo || productStockInfo.quantity !== 8) { // 10 bought - 2 sold = 8
    throw new Error(`Test 7 Failed: Expected quantity 8, got ${productStockInfo?.quantity}`);
  }
  console.log("✅ Test 7 Passed: Warehouse Stock In/Out Calculations");

  // -------------------------------------------------------------
  // SUITE 7: Person Ledger Balances (و)
  // -------------------------------------------------------------
  // Test 8: Person balances calculation from journal vouchers
  const sampleVouchers: JournalVoucher[] = [
    {
      id: "v_10",
      voucherNumber: 10,
      date: "1403/01/01",
      description: "Sales invoice debit",
      status: "active",
      gregorianDate: new Date().toISOString(),
      isAutomatic: true,
      entries: [
        {  subsidiaryId: "SUB_DEBTORS", debit: 30000000, credit: 0, floatingDetailed: { type: 'person', id: customerPersonId, name: customer.name } },
        {  subsidiaryId: "SUB_REVENUE", debit: 0, credit: 30000000 }
      ]
    },
    {
      id: "v_11",
      voucherNumber: 11,
      date: "1403/01/05",
      description: "Payment received",
      status: "active",
      gregorianDate: new Date().toISOString(),
      isAutomatic: true,
      entries: [
        {  subsidiaryId: "SUB_BANK_MELI", debit: 10000000, credit: 0 },
        {  subsidiaryId: "SUB_DEBTORS", debit: 0, credit: 10000000, floatingDetailed: { type: 'person', id: customerPersonId, name: customer.name } }
      ]
    }
  ];

  const personBalances = calculatePersonBalances(sampleVouchers, customerPersonId, "SUB_DEBTORS");
  const customerBalance = personBalances[customerPersonId];

  // Debit 30M, Credit 10M => Net balance = 20,000,000 (Nature: بدهکار)
  if (customerBalance?.net !== 20000000 || customerBalance?.nature !== 'بدهکار') {
    throw new Error(`Test 8 Failed: Expected customer net 20M بدهکار, got ${customerBalance?.net} (${customerBalance?.nature})`);
  }
  console.log("✅ Test 8 Passed: Person Account Ledger Balance Calculation");

  // -------------------------------------------------------------
  // SUITE 9: Sales Invoice Buyer Filtering (Smart Filter)
  // -------------------------------------------------------------
  const testPersons: Person[] = [
    { id: 'p1', code: 'P1001', name: 'علی محمدی (نماینده اعتباری)', nationalId: '1234567890', isAgent: true, role: 'debtor', createdAt: '' },
    { id: 'p2', code: 'P1002', name: 'احمد رضایی (نماینده اعتباری)', nationalId: '9876543210', isAgent: true, role: 'debtor', createdAt: '' },
    { id: 'p3', code: 'P1003', name: 'احمد رضایی (نماینده فروش)', nationalId: '9876543210', isAgent: false, role: 'debtor', createdAt: '' }
  ];

  const testBusinessPartners: any[] = [
    { id: 'bp2', personId: 'p2', agencyType: 'CREDIT_ONLY', roles: ['CREDIT_SALES_AGENT'], status: 'active', profile: {}, branches: [] },
    { id: 'bp3', personId: 'p3', agencyType: 'INSTALLMENT_ONLY', roles: ['DEFERRED_AGENT'], nesyehSettings: { creditLimit: 1000 }, status: 'active', profile: {}, branches: [] }
  ];

  const filteredForSell = getFilteredPersonsForSell(testPersons, testBusinessPartners);
  
  // Should include all active persons, no longer grouping by name to avoid zombie resurrections.
  const hasP1 = filteredForSell.some(p => p.id === 'p1');
  const hasP2 = filteredForSell.some(p => p.id === 'p2');
  const hasP3 = filteredForSell.some(p => p.id === 'p3');

  if (!hasP1 || !hasP2 || !hasP3) {
    throw new Error(`Test 9 Failed: Filtering incorrect. hasP1=${hasP1}, hasP2=${hasP2}, hasP3=${hasP3} (all expected true)`);
  }
  console.log("✅ Test 9 Passed: Sales Invoice Buyer Filter (Does not group/hide twins to prevent zombie resurrections)");

  // -------------------------------------------------------------
  // SUITE 10: Atomic Credit Cancellation (Architectural Directive #32)
  // -------------------------------------------------------------
  const reqCancelTest: CreditFile = {
    id: "req_cancel_1",
    personId: customerPersonId,
    representativeId: partnerPersonId,
    status: "approved",
    requestedAmount: 50000000,
    plan: "beta",
    agentCommissionAmount: 0,
    createdAt: new Date().toISOString(),
    calculationResults: {
      creditAmount: 50000000,
      installmentCount: 6,
      installmentAmount: 9000000,
      totalCommission: 4000000,
      totalRepayment: 54000000
    }
  } as any;

  const baseStateForCancel: any = {
    persons,
    vouchers: [],
    checks: [],
    installmentBooks: [],
    installments: [],
    creditFiles: [reqCancelTest],
    auditLogs: []
  };

  // Finalize to generate booklet, installments, vouchers
  const finalizedImpact = finalizeCreditFile(reqCancelTest.id, baseStateForCancel);
  const stateAfterFinalize: any = {
    ...baseStateForCancel,
    ...finalizedImpact,
    creditFiles: [ { ...reqCancelTest, status: 'approved' } ]
  };

  // Test Scenario 2: Try to cancel when an installment is paid
  const bookletId = stateAfterFinalize.installmentBooks[0].id;
  const modifiedInstallments = stateAfterFinalize.installments.map((inst: any, idx: number) => {
    if (idx === 0) {
      return { ...inst, status: 'paid', paidAmount: inst.amount };
    }
    return inst;
  });
  const stateWithPaidInstallment = {
    ...stateAfterFinalize,
    installments: modifiedInstallments
  };

  const cancelResPaid = cancelCreditFileAtomic(reqCancelTest.id, stateWithPaidInstallment);
  if (cancelResPaid.success !== false) {
    throw new Error("Test 10 Scenario 2 Failed: Expected cancellation to be blocked when installment is paid");
  }
  console.log("✅ Test 10 Scenario 2 Passed: Cancellation blocked when installment is paid");

  // Test Scenario 1 & 3: Cancel when NO installment is paid
  const cancelResSuccess = cancelCreditFileAtomic(reqCancelTest.id, stateAfterFinalize);
  if (!cancelResSuccess.success || !cancelResSuccess.newState) {
    throw new Error(`Test 10 Scenario 1 Failed: Expected successful cancellation, got message: ${cancelResSuccess.message}`);
  }

  const newState = cancelResSuccess.newState;
  const updatedBook = newState.installmentBooks.find((b: any) => b.id === bookletId);
  const activeInstallmentsCount = newState.installments.filter((i: any) => i.bookId === bookletId && i.status === 'upcoming').length;
  const canceledInstallmentsCount = newState.installments.filter((i: any) => i.bookId === bookletId && i.status === 'canceled').length;
  const updatedFile = newState.creditFiles.find((f: any) => f.id === reqCancelTest.id);

  if (updatedBook.status !== 'canceled') {
    throw new Error(`Test 10 Scenario 3 Failed: Expected booklet status to be 'canceled', got ${updatedBook.status}`);
  }
  if (activeInstallmentsCount > 0) {
    throw new Error(`Test 10 Scenario 3 Failed: Expected 0 active installments after cancellation, got ${activeInstallmentsCount}`);
  }
  if (canceledInstallmentsCount !== 6) {
    throw new Error(`Test 10 Scenario 3 Failed: Expected 6 canceled installments, got ${canceledInstallmentsCount}`);
  }
  if (updatedFile.status !== 'canceled') {
    throw new Error(`Test 10 Scenario 3 Failed: Expected credit file status to be 'canceled', got ${updatedFile.status}`);
  }
  console.log("✅ Test 10 Scenario 1 & 3 Passed: Atomic Credit Cancellation and Integrity Verification");

  // -------------------------------------------------------------
  // SUITE 11: Received Check State Machine Verification (ی)
  // -------------------------------------------------------------
  console.log("\n=======================================================");
  console.log("🚀 Running Received Check State Machine Verification...");
  console.log("=======================================================");

  // Scenario 1: present_in_cashbox -> passed_to_others -> cleared (should fail)
  const sc1Result1 = isValidCheckTransition('received', 'present_in_cashbox', 'passed_to_others');
  if (!sc1Result1.allowed) {
    throw new Error("State Machine Test Failed: present_in_cashbox -> passed_to_others should be allowed.");
  }
  const sc1Result2 = isValidCheckTransition('received', 'passed_to_others', 'cleared');
  if (sc1Result2.allowed) {
    throw new Error("State Machine Test Failed: passed_to_others -> cleared should be blocked.");
  }
  console.log("✅ Scenario 1 Passed: present_in_cashbox -> passed_to_others -> cleared (blocked)");

  // Scenario 2: passed_to_others -> deposited_to_bank (should fail)
  const sc2Result = isValidCheckTransition('received', 'passed_to_others', 'deposited_to_bank');
  if (sc2Result.allowed) {
    throw new Error("State Machine Test Failed: passed_to_others -> deposited_to_bank should be blocked.");
  }
  console.log("✅ Scenario 2 Passed: passed_to_others -> deposited_to_bank (blocked)");

  // Scenario 3: passed_to_others -> present_in_cashbox (should succeed)
  const sc3Result = isValidCheckTransition('received', 'passed_to_others', 'present_in_cashbox');
  if (!sc3Result.allowed) {
    throw new Error("State Machine Test Failed: passed_to_others -> present_in_cashbox should be allowed.");
  }
  console.log("✅ Scenario 3 Passed: passed_to_others -> present_in_cashbox (allowed)");

  // Scenario 4: present_in_cashbox (after return) -> deposited_to_bank (should succeed)
  const sc4Result = isValidCheckTransition('received', 'present_in_cashbox', 'deposited_to_bank');
  if (!sc4Result.allowed) {
    throw new Error("State Machine Test Failed: present_in_cashbox -> deposited_to_bank should be allowed.");
  }
  console.log("✅ Scenario 4 Passed: present_in_cashbox (after return) -> deposited_to_bank (allowed)");

  // Scenario 5: present_in_cashbox (after return) -> cleared (should succeed)
  const sc5Result = isValidCheckTransition('received', 'present_in_cashbox', 'cleared');
  if (!sc5Result.allowed) {
    throw new Error("State Machine Test Failed: present_in_cashbox -> cleared should be allowed.");
  }
  console.log("✅ Scenario 5 Passed: present_in_cashbox (after return) -> cleared (allowed)");

  // Scenario 6: present_in_cashbox (after return) -> passed_to_others (should succeed)
  const sc6Result = isValidCheckTransition('received', 'present_in_cashbox', 'passed_to_others');
  if (!sc6Result.allowed) {
    throw new Error("State Machine Test Failed: present_in_cashbox -> passed_to_others should be allowed.");
  }
  console.log("✅ Scenario 6 Passed: present_in_cashbox (after return) -> passed_to_others (allowed)");

  console.log("\n=======================================================");
  console.log("🎉 ALL REGRESSION & STATE MACHINE TESTS PASSED SUCCESSFULLY!");
  console.log("=======================================================\n");
}

runTests();

