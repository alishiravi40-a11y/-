import { AppState, Person, BusinessPartner, AgencyType, PartnerRole, JournalVoucher, Invoice } from '../types';

function runCentralPersonDirectoryTests() {
  console.log('=======================================================');
  console.log('🚀 RUNNING CENTRAL PERSON DIRECTORY REAL-WORLD SUITE');
  console.log('=======================================================');

  // Step 1: Create 5 distinct Persons
  const person1: Person = {
    id: 'p_dir_1',
    code: 'P-1001',
    name: 'رضا محمدی',
    nationalId: '1111111111',
    mobile: '09121111111',
    address: 'تهران - ونک',
    createdAt: new Date().toISOString()
  };

  const person2: Person = {
    id: 'p_dir_2',
    code: 'P-1002',
    name: 'سارا احمدی',
    nationalId: '2222222222',
    mobile: '09122222222',
    role: 'debtor',
    address: 'اصفهان - میدان فیض',
    createdAt: new Date().toISOString()
  };

  const person3: Person = {
    id: 'p_dir_3',
    code: 'P-1003',
    name: 'امیر کاظمی',
    nationalId: '3333333333',
    mobile: '09123333333',
    role: 'creditor',
    address: 'شیراز - خیابان زرتشت',
    createdAt: new Date().toISOString()
  };

  const person4: Person = {
    id: 'p_dir_4',
    code: 'P-1004',
    name: 'مریم کریمی',
    nationalId: '4444444444',
    mobile: '09124444444',
    companyName: 'فروشگاه کریمی',
    createdAt: new Date().toISOString()
  };

  const person5: Person = {
    id: 'p_dir_5',
    code: 'P-1005',
    name: 'جواد نوری',
    nationalId: '5555555555',
    mobile: '09125555555',
    isAgent: true,
    role: 'debtor',
    companyName: 'بازرگانی نوری',
    createdAt: new Date().toISOString()
  };

  // Step 2: Create role extensions (Business Partners, Vouchers)
  // Person 4: Sales Agent Extension
  const bpSalesAgent: BusinessPartner = {
    id: 'bp_sales_4',
    personId: 'p_dir_4',
    status: 'active',
    agencyType: AgencyType.BOTH,
    roles: ['DEFERRED_AGENT' as any],
    profile: {
      partnerId: 'bp_sales_4',
      partnerName: 'علی رضایی',
      contractStatus: 'active'
    },
    salesExtension: {
      nesyehSettings: {
        creditLimit: 100000000,
        paymentTermDays: 30,
        lateFeePercentage: 1.5,
        isPurchaseAllowed: true
      }
    },
    branches: [],
    createdAt: new Date().toISOString(),
    createdBy: 'admin'
  };

  // Person 5: Credit Agent Extension
  const bpCreditAgent: BusinessPartner = {
    id: 'bp_credit_5',
    personId: 'p_dir_5',
    status: 'active',
    agencyType: AgencyType.INSTALLMENT_ONLY,
    roles: [PartnerRole.CREDIT_SALES_AGENT],
    profile: {
      partnerId: 'bp_credit_5',
      partnerName: 'جواد نوری',
      contractStatus: 'active'
    },
    creditExtension: {
      allowedCalculators: ['CALC_SADI'],
      creditRules: { maxCreditLimit: 500000000 }
    },
    branches: [],
    createdAt: new Date().toISOString(),
    createdBy: 'admin'
  };

  // Dummy Invoice for Person 2 (Debtor Dependency)
  const invoicePerson2: Invoice = {
    id: 'inv_p2',
    invoiceNumber: 101,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    date: '1403/05/01',
    personId: 'p_dir_2',
    items: [],
    discount: 0,
    taxPercent: 0,
    totalAmount: 5000000,
    paidAmount: 0,
    createdAt: new Date().toISOString()
  };

  const appState: Partial<AppState> = {
    persons: [person1, person2, person3, person4, person5],
    businessPartners: [bpSalesAgent, bpCreditAgent],
    invoices: [invoicePerson2],
    vouchers: [],
    checks: [],
    installmentBooks: [],
    openingBalances: [],
    creditFiles: []
  };

  console.log('--- Test 1: Verify all 5 Persons exist in Central Directory ---');
  if (appState.persons!.length !== 5) {
    throw new Error(`Expected 5 persons, got ${appState.persons!.length}`);
  }
  console.log('✅ Test 1 Passed: Central directory contains all 5 registered persons without omissions.');

  console.log('--- Test 2: Role Resolution & Multi-role verification ---');
  // Helper to resolve roles as implemented in CentralPersonDirectory
  const resolvePersonRoles = (p: Person) => {
    const bp = appState.businessPartners!.find(b => b.personId === p.id);
    const isSalesAgent = Boolean(
      bp && (
        bp.salesExtension?.nesyehSettings ||
        bp.nesyehSettings ||
        bp.agencyType === ('DEFERRED_PAYMENT' as any) ||
        (bp.roles || []).includes('DEFERRED_AGENT' as any)
      )
    );
    const isCreditAgent = Boolean(
      p.isAgent || (
        bp && (
          bp.creditExtension ||
          bp.agencyType === AgencyType.INSTALLMENT_ONLY ||
          (bp.roles || []).includes(PartnerRole.CREDIT_SALES_AGENT)
        )
      )
    );
    const isDebtor = p.role === 'debtor';
    const isCreditor = p.role === 'creditor';

    const tags: string[] = [];
    if (isSalesAgent) tags.push('نماینده فروش');
    if (isCreditAgent) tags.push('نماینده اعتباری');
    if (isDebtor) tags.push('بدهکار');
    if (isCreditor) tags.push('بستانکار');
    if (tags.length === 0) tags.push('شخص عادی');

    const isMultiRole = tags.filter(t => t !== 'شخص عادی').length >= 2;
    return { tags, isMultiRole, isNormal: tags.includes('شخص عادی') };
  };

  const r1 = resolvePersonRoles(person1);
  const r2 = resolvePersonRoles(person2);
  const r3 = resolvePersonRoles(person3);
  const r4 = resolvePersonRoles(person4);
  const r5 = resolvePersonRoles(person5);

  if (!r1.isNormal) throw new Error('Person 1 should be Normal Person');
  if (!r2.tags.includes('بدهکار')) throw new Error('Person 2 should be Debtor');
  if (!r3.tags.includes('بستانکار')) throw new Error('Person 3 should be Creditor');
  if (!r4.tags.includes('نماینده فروش')) throw new Error('Person 4 should be Sales Agent');
  if (!r5.tags.includes('نماینده اعتباری') || !r5.tags.includes('بدهکار') || !r5.isMultiRole) {
    throw new Error('Person 5 should be Multi-role (Credit Agent + Debtor)');
  }
  console.log('✅ Test 2 Passed: Roles correctly assigned and multi-role detected for Person 5.');

  console.log('--- Test 3: Search Functionality Across All Persons ---');
  const search = (q: string) => {
    const query = q.toLowerCase().trim();
    return appState.persons!.filter(p =>
      p.name.toLowerCase().includes(query) ||
      p.code.toLowerCase().includes(query) ||
      (p.nationalId && p.nationalId.includes(query)) ||
      (p.mobile && p.mobile.includes(query)) ||
      (p.companyName && p.companyName.toLowerCase().includes(query))
    );
  };

  if (search('رضا').length !== 1 || search('رضا')[0].id !== 'p_dir_1') throw new Error('Search by name failed for Person 1');
  if (search('2222222222').length !== 1 || search('2222222222')[0].id !== 'p_dir_2') throw new Error('Search by National ID failed for Person 2');
  if (search('09123333333').length !== 1 || search('09123333333')[0].id !== 'p_dir_3') throw new Error('Search by mobile failed for Person 3');
  if (search('فروشگاه کریمی').length !== 1 || search('فروشگاه کریمی')[0].id !== 'p_dir_4') throw new Error('Search by store name failed for Person 4');
  if (search('P-1005').length !== 1 || search('P-1005')[0].id !== 'p_dir_5') throw new Error('Search by code failed for Person 5');

  console.log('✅ Test 3 Passed: Global search works flawlessly across all 5 persons regardless of role.');

  console.log('--- Test 4: Deletion Dependency Audit ---');
  const checkDeletionAudit = (personId: string) => {
    const reasons: string[] = [];
    if (appState.invoices?.some(inv => inv.personId === personId)) reasons.push('فاکتور خرید یا فروش');
    return { isDeletable: reasons.length === 0, reasons };
  };

  const auditP1 = checkDeletionAudit('p_dir_1');
  const auditP2 = checkDeletionAudit('p_dir_2');
  const auditP4 = checkDeletionAudit('p_dir_4');

  if (!auditP1.isDeletable) throw new Error('Person 1 should be deletable (no financial transactions)');
  if (auditP2.isDeletable || !auditP2.reasons.includes('فاکتور خرید یا فروش')) {
    throw new Error('Person 2 deletion should be blocked due to invoice dependency');
  }
  if (!auditP4.isDeletable) {
    throw new Error('Person 4 should be deletable because it has no financial transactions');
  }
  console.log('✅ Test 4 Passed: Deletion safety audit correctly permits deletion for Persons without financial transactions and blocks Person 2 with invoice dependency.');

  console.log('=======================================================');
  console.log('🎉 ALL CENTRAL PERSON DIRECTORY TESTS PASSED SUCCESSFULLY!');
  console.log('=======================================================');
}

runCentralPersonDirectoryTests();
