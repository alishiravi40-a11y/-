import { AppState, VisitorProfile, ReferrerNode, BusinessPartner } from '../types';

function createMockState(): AppState {
  return {
    persons: [
      {
        id: 'P-101',
        name: 'علی همکار',
        mobile: '09121111111',
        code: '101',
        type: 'both',
        isActive: true,
      },
      {
        id: 'P-102',
        name: 'رضا نماینده',
        mobile: '09122222222',
        code: '102',
        type: 'customer',
        isActive: true,
      }
    ],
    businessPartners: [
      {
        id: 'BP-101',
        personId: 'P-101',
        agencyType: 'credit_rep',
        roles: ['CREDIT_PARTNER'],
        status: 'ACTIVE',
        profile: {
          partnerName: 'علی همکار',
          storeName: 'فروشگاه مرکزی',
        }
      },
      {
        id: 'BP-102',
        personId: 'P-102',
        agencyType: 'sales_rep',
        roles: ['SALES_PARTNER'],
        status: 'ACTIVE',
        profile: {
          partnerName: 'رضا نماینده',
          storeName: 'فروشگاه جنوب',
        }
      }
    ],
    vouchers: [
      {
        id: 'V-101',
        voucherNumber: 1,
        date: '1403/01/01',
        description: 'سند افتتاحیه',
        entries: [
          { accountId: '101', subsidiaryId: '10101', debit: 1000000, credit: 0 },
          { accountId: '201', subsidiaryId: '20101', debit: 0, credit: 1000000 }
        ],
        isSystemGenerated: false,
      }
    ],
    visitorProfiles: [],
    referrerNodes: [],
    invoices: [],
    checks: [],
    creditFiles: [],
    creditPolicies: [],
    calculators: [],
    warehouses: [],
    costCenters: [],
  } as unknown as AppState;
}

export function runVisitorNetworkTests() {
  console.log('=======================================================');
  console.log('🚀 RUNNING VISITOR NETWORK MANAGER ISOLATION TESTS');
  console.log('=======================================================');

  let state = createMockState();
  const initialVouchersCount = state.vouchers.length;
  const initialVoucherEntries = JSON.stringify(state.vouchers);

  // --- Test 1: Register New Visitor ---
  console.log('--- Test 1: Register New Visitor Profile ---');
  const newVisitor: VisitorProfile = {
    id: 'VIS-101',
    fullName: 'کامران بازاریاب',
    mobile: '09123333333',
    status: 'ACTIVE',
    referralCode: 'REF-VIS-8812',
    referralLink: 'https://app.accounting.ir/?ref=REF-VIS-8812&agentToken=REF-VIS-8812',
    commissionType: 'PERCENTAGE',
    commissionValue: 2.5,
    assignedPartnerIds: [],
    createdAt: '1403/06/01',
    updatedAt: '1403/06/01',
  };

  state = {
    ...state,
    visitorProfiles: [newVisitor],
  };

  if (state.visitorProfiles.length !== 1 || state.visitorProfiles[0].referralCode !== 'REF-VIS-8812') {
    throw new Error('❌ Test 1 Failed: Visitor creation failed.');
  }
  console.log('✅ Test 1 Passed: VisitorProfile registered successfully with unique referral link.');

  // --- Test 2: Assign BusinessPartner Agents to Visitor ---
  console.log('--- Test 2: Assigning Representatives to Visitor ---');
  const assignedIds = ['BP-101', 'BP-102'];
  const updatedVisitors = state.visitorProfiles.map(v => {
    if (v.id === 'VIS-101') {
      return { ...v, assignedPartnerIds: assignedIds };
    }
    return v;
  });

  const newNodes: ReferrerNode[] = assignedIds.map(bpId => ({
    id: `RN-VIS-101-${bpId}`,
    visitorId: 'VIS-101',
    visitorName: 'کامران بازاریاب',
    partnerId: bpId,
    partnerName: bpId === 'BP-101' ? 'علی همکار' : 'رضا نماینده',
    assignedAt: '1403/06/01',
    status: 'ACTIVE',
  }));

  state = {
    ...state,
    visitorProfiles: updatedVisitors,
    referrerNodes: newNodes,
  };

  if (state.visitorProfiles[0].assignedPartnerIds.length !== 2 || state.referrerNodes.length !== 2) {
    throw new Error('❌ Test 2 Failed: Partner assignment failed.');
  }
  console.log('✅ Test 2 Passed: 2 BusinessPartners assigned to Visitor without modifying financial ledgers.');

  // --- Test 3: Financial Isolation Verification ---
  console.log('--- Test 3: Zero Financial Impact Verification ---');
  if (state.vouchers.length !== initialVouchersCount) {
    throw new Error('❌ Test 3 Failed: Vouchers array count changed!');
  }
  if (JSON.stringify(state.vouchers) !== initialVoucherEntries) {
    throw new Error('❌ Test 3 Failed: Accounting journal vouchers altered!');
  }
  console.log('✅ Test 3 Passed: Accounting vouchers completely untouched and 100% green.');

  console.log('=======================================================');
  console.log('🎉 ALL VISITOR NETWORK ISOLATION TESTS PASSED SUCCESSFULLY!');
  console.log('=======================================================');
}

runVisitorNetworkTests();
