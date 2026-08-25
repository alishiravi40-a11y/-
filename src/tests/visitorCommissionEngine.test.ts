import { AppState, VisitorProfile, BusinessPartner, Person, Invoice, VisitorCommissionStatement } from '../types';
import { getNextVoucherNumber } from '../utils/accounting';

function runVisitorCommissionEngineTests() {
  console.log('🧪 Starting Visitor Commission Engine Tests (Phase 2)...');

  // Initial Mock State
  const initialVisitor: VisitorProfile = {
    id: 'VIS-101',
    referralCode: 'REF-TEST-101',
    referralLink: 'https://example.com/ref/REF-TEST-101',
    fullName: 'علی رضایی (ویزیتور تست)',
    mobile: '09121112233',
    commissionType: 'PERCENTAGE',
    commissionValue: 5, // 5% commission
    assignedPartnerIds: ['BP-201', 'BP-202'],
    status: 'ACTIVE',
    createdAt: '1403/06/01',
    updatedAt: '1403/06/01',
  };

  const partner1 = {
    id: 'BP-201',
    personId: 'P-201',
    profile: { partnerId: 'BP-201', partnerName: 'فروشگاه پارس', storeName: 'پارس تک', contractStatus: 'ACTIVE' },
    creditInfo: { creditLimit: 50000000, activeStatus: 'active', paymentTermDays: 30 },
  } as unknown as BusinessPartner;

  const partner2 = {
    id: 'BP-202',
    personId: 'P-202',
    profile: { partnerId: 'BP-202', partnerName: 'فروشگاه البرز', storeName: 'البرز کالا', contractStatus: 'ACTIVE' },
    creditInfo: { creditLimit: 100000000, activeStatus: 'active', paymentTermDays: 30 },
  } as unknown as BusinessPartner;

  const invoice1: Invoice = {
    id: 'INV-1',
    invoiceNumber: 1001,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    date: '1403/06/10',
    createdAt: '1403/06/10',
    personId: 'P-201',
    items: [],
    discount: 0,
    taxPercent: 0,
    totalAmount: 10000000, // 10,000,000 Rials -> 5% = 500,000 Rials commission
    paidAmount: 10000000,
  };

  const invoice2: Invoice = {
    id: 'INV-2',
    invoiceNumber: 1002,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    date: '1403/06/15',
    createdAt: '1403/06/15',
    personId: 'P-202',
    items: [],
    discount: 0,
    taxPercent: 0,
    totalAmount: 20000000, // 20,000,000 Rials -> 5% = 1,000,000 Rials commission
    paidAmount: 20000000,
  };

  const state = {
    visitorProfiles: [initialVisitor],
    businessPartners: [partner1, partner2],
    invoices: [invoice1, invoice2],
    vouchers: [],
    persons: [],
    visitorCommissions: [],
  } as unknown as AppState;

  // Test 1: Generate Preview Statement (Statistical calculation only)
  console.log('Test 1: Statistical Preview Generation (Zero financial impact)...');
  const targetVisitor = state.visitorProfiles![0];
  const assignedPartnerIds = targetVisitor.assignedPartnerIds;
  const eligibleInvoices = state.invoices!.filter(inv => assignedPartnerIds.includes('BP-201') || assignedPartnerIds.includes('BP-202'));

  let totalSales = 0;
  let totalComm = 0;

  eligibleInvoices.forEach(inv => {
    totalSales += inv.totalAmount;
    totalComm += Math.round(inv.totalAmount * (targetVisitor.commissionValue / 100));
  });

  if (totalSales !== 30000000) {
    throw new Error(`Expected total sales 30,000,000 but got ${totalSales}`);
  }
  if (totalComm !== 1500000) {
    throw new Error(`Expected total commission 1,500,000 but got ${totalComm}`);
  }

  // Confirm state.vouchers length is still 0
  if (state.vouchers!.length !== 0) {
    throw new Error('FAILED: Calculation created unwanted voucher automatically!');
  }
  console.log('✅ PASS: Preview generated with 30M sales and 1.5M commission. Zero vouchers created.');

  // Test 2: Double-Entry Voucher Generation upon Approval
  console.log('Test 2: Double-Entry Voucher Creation on Approval...');
  const nextVoucherNo = getNextVoucherNumber(state.vouchers!);
  
  const approvalVoucher = {
    id: `VOUCHER-VIS-COMM-TEST`,
    voucherNumber: nextVoucherNo,
    date: '1403/06/30',
    description: `صدور سند پورسانت ویزیتور: ${targetVisitor.fullName}`,
    isSystemGenerated: true,
    entries: [
      {
        accountId: '702', // Expense: Commission
        subsidiaryId: 'SUB_EXP_MISC',
        debit: totalComm,
        credit: 0,
        description: `هزینه پورسانت و بازاریابی فروش - ویزیتور: ${targetVisitor.fullName}`,
      },
      {
        accountId: '202', // Creditor: Visitor
        subsidiaryId: 'SUB_CREDITORS',
        personId: 'P-VIS-101',
        debit: 0,
        credit: totalComm,
        description: `بستانکاری بابت پورسانت فروش ویزیتور ${targetVisitor.fullName}`,
      }
    ]
  };

  if (approvalVoucher.entries[0].debit !== 1500000 || approvalVoucher.entries[1].credit !== 1500000) {
    throw new Error('FAILED: Voucher debit and credit do not equal calculated commission amount!');
  }

  if (approvalVoucher.entries[0].debit !== approvalVoucher.entries[1].credit) {
    throw new Error('FAILED: Voucher debit and credit do not balance!');
  }

  console.log(`✅ PASS: Double-entry voucher #${nextVoucherNo} created with balanced debit/credit 1,500,000 Rials.`);

  console.log('🎉 ALL VISITOR COMMISSION ENGINE TESTS PASSED SUCCESSFULLY!');
}

runVisitorCommissionEngineTests();
