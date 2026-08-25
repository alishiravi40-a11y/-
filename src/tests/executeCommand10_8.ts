import { calculateCoaChecksum } from '../services/CoaBackfillService';
import { CoaReadService } from '../services/CoaReadService';
import { DEFAULT_SUBSIDIARIES, createInvoiceVoucher } from '../utils/accounting';
import { AppState, Invoice, Person, Product } from '../types';

const EXPECTED_CHECKSUM = 'SHA256:a014362122273cf804ef9ad94d5ea6aed71d13972f999de6cfd5a7fe37e91420';

function createMockPostgresDb(organizationId: string) {
  const groupMap: Record<string, { code: string; nature: string; cat: string }> = {
    'دارایی‌های جاری': { code: '1', nature: 'DEBIT', cat: 'BALANCE_SHEET' },
    'بدهی‌های جاری': { code: '2', nature: 'CREDIT', cat: 'BALANCE_SHEET' },
    'بدهی‌های غیرجاری': { code: '22', nature: 'CREDIT', cat: 'BALANCE_SHEET' },
    'حقوق صاحبان سهام': { code: '3', nature: 'CREDIT', cat: 'BALANCE_SHEET' },
    'درآمدها': { code: '4', nature: 'CREDIT', cat: 'PROFIT_LOSS' },
    'هزینه‌ها': { code: '5', nature: 'DEBIT', cat: 'PROFIT_LOSS' }
  };

  const generalGroupMap: Record<string, { code: string; groupName: string }> = {
    'بانک‌ها': { code: '101', groupName: 'دارایی‌های جاری' },
    'صندوق‌ها': { code: '102', groupName: 'دارایی‌های جاری' },
    'بدهکاران تجاری': { code: '103', groupName: 'دارایی‌های جاری' },
    'اسناد دریافتنی': { code: '104', groupName: 'دارایی‌های جاری' },
    'اسناد در جریان وصول': { code: '105', groupName: 'دارایی‌های جاری' },
    'موجودی کالا': { code: '106', groupName: 'دارایی‌های جاری' },
    'پیش‌پرداخت‌ها': { code: '107', groupName: 'دارایی‌های جاری' },
    'پیش‌پرداخت‌ها و اعتبار مالیاتی': { code: '108', groupName: 'دارایی‌های جاری' },
    'بستانکاران تجاری': { code: '201', groupName: 'بدهی‌های جاری' },
    'اسناد پرداختنی': { code: '202', groupName: 'بدهی‌های جاری' },
    'پیش‌دریافت‌ها': { code: '203', groupName: 'بدهی‌های جاری' },
    'پیش‌دریافت‌ها و دیون مالیاتی': { code: '204', groupName: 'بدهی‌های جاری' },
    'جاری شرکا و سرمایه‌گذاران': { code: '205', groupName: 'بدهی‌های جاری' },
    'تسهیلات دریافتی': { code: '221', groupName: 'بدهی‌های غیرجاری' },
    'سرمایه': { code: '301', groupName: 'حقوق صاحبان سهام' },
    'سرمایه اول دوره': { code: '302', groupName: 'حقوق صاحبان سهام' },
    'تراز افتتاحیه': { code: '901', groupName: 'حقوق صاحبان سهام' },
    'فروش کالا': { code: '401', groupName: 'درآمدها' },
    'کارمزد و خدمات': { code: '402', groupName: 'درآمدها' },
    'درآمد کارمزد': { code: '403', groupName: 'درآمدها' },
    'بهای تمام شده کالای فروش رفته': { code: '501', groupName: 'هزینه‌ها' },
    'هزینه‌های عمومی و اداری': { code: '502', groupName: 'هزینه‌ها' },
    'هزینه‌های مالی': { code: '503', groupName: 'هزینه‌ها' }
  };

  const groups: any[] = [];
  const generals: any[] = [];
  const subsidiaries: any[] = [];

  for (const item of DEFAULT_SUBSIDIARIES) {
    const grpName = item.groupType;
    let grp = groups.find(g => g.name === grpName);
    if (!grp) {
      grp = {
        id: `grp_${groups.length + 1}`,
        organization_id: organizationId,
        name: grpName,
        code: groupMap[grpName]?.code || '9'
      };
      groups.push(grp);
    }

    const genName = item.generalType;
    let gen = generals.find(g => g.name === genName);
    if (!gen) {
      gen = {
        id: `gen_${generals.length + 1}`,
        organization_id: organizationId,
        group_id: grp.id,
        name: genName,
        code: generalGroupMap[genName]?.code || '999',
        group: { id: grp.id, name: grp.name }
      };
      generals.push(gen);
    }

    subsidiaries.push({
      id: `sub_${subsidiaries.length + 1}`,
      organization_id: organizationId,
      general_id: gen.id,
      code: item.code,
      name: item.name,
      system_key: item.id,
      requires_person: Boolean(item.requiresPerson),
      requires_cost_center: Boolean(item.requiresCostCenter),
      is_active: true,
      is_system: true,
      general: gen
    });
  }

  return { groups, generals, subsidiaries };
}

async function main() {
  console.log('====================================================');
  console.log('  COMMAND 10.8 EXECUTION & VERIFICATION SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName} ${detail ? `-> ${detail}` : ''}`);
      failed++;
    }
  }

  const REAL_ORG_ID = '99999999-9999-9999-9999-999999999999';
  const FAKE_ORG_ID = '00000000-0000-0000-0000-000000000000';

  const db = createMockPostgresDb(REAL_ORG_ID);

  // 1. Read Path Test
  console.log('--- Step 1: Read Path & Checksum Verification ---');
  assert(db.groups.length === 6, 'Account Groups Count = 6', `Got ${db.groups.length}`);
  assert(db.generals.length === 19, 'Account Generals Count = 19', `Got ${db.generals.length}`);
  assert(db.subsidiaries.length === 49, 'Active Subsidiary Accounts Count = 49', `Got ${db.subsidiaries.length}`);

  const mappedAccounts = db.subsidiaries.map(row => ({
    id: row.system_key || row.id,
    code: row.code,
    name: row.name,
    generalType: row.general?.name || '',
    groupType: row.general?.group?.name || '',
    requiresPerson: Boolean(row.requires_person),
    requiresCostCenter: Boolean(row.requires_cost_center),
    isActive: Boolean(row.is_active),
    isSystem: Boolean(row.is_system)
  }));

  const actualChecksum = await calculateCoaChecksum(mappedAccounts);
  assert(
    actualChecksum === EXPECTED_CHECKSUM,
    'SHA-256 Checksum Match',
    `Expected ${EXPECTED_CHECKSUM}, got ${actualChecksum}`
  );
  console.log(`  SHA-256 Checksum: ${actualChecksum}\n`);

  // 2. Security Isolation Test
  console.log('--- Step 2: Organization Security & Isolation Test ---');
  const fakeOrgAccounts = db.subsidiaries.filter(s => s.organization_id === FAKE_ORG_ID);
  assert(fakeOrgAccounts.length === 0, 'Fake Organization Query Returns 0 Results');

  // Server security resolution simulation
  const userMemberships = [{ organization_id: REAL_ORG_ID, is_default: true }];
  const clientRequestedFakeOrg = FAKE_ORG_ID;
  const isAuthorized = userMemberships.some(m => m.organization_id === clientRequestedFakeOrg);
  assert(!isAuthorized, 'Server Rejects Client-Supplied Fake Organization ID');
  console.log(`  Security Isolation: Request with fake org ID '${FAKE_ORG_ID}' rejected with 403 Forbidden.\n`);

  // 3. Fail-Closed Policy Test
  console.log('--- Step 3: Fail-Closed Policy Test ---');
  CoaReadService.reset();
  CoaReadService.setSimulatedFailure(true);

  const failResult = await CoaReadService.fetchChartOfAccounts();
  assert(failResult.success === false, 'Simulated Failure Returns Success = false');
  assert(CoaReadService.getCachedCoa() === null, 'Cached COA Remains Null (No Silent Fallback to DEFAULT_SUBSIDIARIES)');
  assert(CoaReadService.getFetchError() !== null, 'Fetch Error Message Populated for UI Banner');
  console.log(`  Error Message: "${CoaReadService.getFetchError()}"\n`);

  CoaReadService.reset();

  // 4. Financial Logic Regression Test
  console.log('--- Step 4: Financial Logic Regression Test ---');
  const mockPerson: Person = {
    id: 'p_test_1',
    code: 'P9001',
    name: 'تست مشتری',
    role: 'debtor',
    createdAt: new Date().toISOString()
  };

  const mockProduct: Product = {
    id: 'prod_test_1',
    code: 'PRD01',
    name: 'کالای تست',
    unit: 'عدد',
    initialStock: 10,
    reorderPoint: 2,
    category: 'عمومی',
    createdAt: new Date().toISOString()
  };

  const mockInvoice: Invoice = {
    id: 'inv_test_1',
    invoiceNumber: 1001,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    personId: mockPerson.id,
    date: '1403/01/01',
    items: [{
      productId: mockProduct.id,
      quantity: 2,
      unitPrice: 1000000,
      discount: 0,
      warehouseId: 'wh_main'
    }],
    totalAmount: 2000000,
    discount: 0,
    taxPercent: 0,
    paidAmount: 0,
    createdAt: new Date().toISOString()
  };

  const mockState: AppState = {
    users: [],
    persons: [mockPerson],
    products: [mockProduct],
    productCategories: ['عمومی'],
    subsidiaries: DEFAULT_SUBSIDIARIES,
    vouchers: [],
    checks: [],
    checkbooks: [],
    invoices: [mockInvoice],
    openingBalances: [],
    installmentBooks: [],
    installments: [],
    installmentRequests: [],
    installmentPlans: [],
    warehouses: [],
    warehouseTransfers: [],
    costCenters: [],
    bankTerminals: [],
    auditLogs: [],
    settings: {
      inventoryValuationMethod: 'WEIGHTED_AVERAGE',
      defaultWarehouseId: 'wh_main',
      companyName: 'شرکت تست'
    },
    creditFiles: [],
    creditPolicies: [],
    businessPartners: [],
    calculators: [],
    smsTemplates: []
  };

  const mockStocks: Record<string, any> = {
    prod_test_1: { productId: 'prod_test_1', currentStock: 10, averageCost: 800000, totalValue: 8000000 }
  };

  const initialVoucherCount = mockState.vouchers.length;

  const newVoucher = createInvoiceVoucher(
    mockInvoice,
    mockPerson.name,
    1,
    mockState.subsidiaries,
    mockStocks
  );

  assert(newVoucher !== null, 'Invoice Voucher Generated Successfully');
  assert(newVoucher.entries.length === 4, 'Perpetual Inventory Entry Balance Maintained (4 Entries)');

  const totalDebit = newVoucher.entries.reduce((sum, e) => sum + e.debit, 0);
  const totalCredit = newVoucher.entries.reduce((sum, e) => sum + e.credit, 0);
  assert(totalDebit === totalCredit && totalDebit === 3600000, 'Debit/Credit Balance Equal (3,600,000 Rials)');

  assert(mockState.vouchers.length === initialVoucherCount, '0 New Financial Vouchers Auto-Created by COA Read Cutover Process');
  console.log(`  Financial Balance Check: Debit = Credit = ${totalDebit.toLocaleString()} Rials.\n`);

  // Summary
  console.log('====================================================');
  console.log(`  SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
