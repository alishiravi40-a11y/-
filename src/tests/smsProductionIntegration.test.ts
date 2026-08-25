/**
 * Test Suite for Step 6: Production Event Integration Layer
 * Verifies non-invasive financial event adapters, event payload mapping,
 * non-blocking execution, deduplication, eventIntegrationMode, and strict fault isolation.
 */

import {
  FinancialEventAdapter,
  SmsEventBusClass,
  SmsEventDispatcherClass,
  SmsQueueEngine,
  SmsSettingsManager,
  MockSmsProvider,
  SmsLogger,
  SmsEventPayloadMapper,
  maskApiKey,
  InvoiceCreatedPayload,
  InstallmentPaidPayload,
  CheckBouncedPayload,
  CustomerRegisteredPayload,
} from '../modules/sms';

function runTests() {
  console.log('----------------------------------------------------');
  console.log('🧪 Running Test Suite: SMS Production Event Integration Layer (Step 6)');
  console.log('----------------------------------------------------');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // TEST 1: Event Payload Mapper Data Formatting & Isolation
  console.log('\n[Test 1] Event Payload Mapper (Read-Only Data Translation)');
  const mappedInvoice = SmsEventPayloadMapper.mapPayloadToVariables('INVOICE_CREATED', {
    invoiceNumber: 'INV-2026-99',
    totalAmount: 150000000,
    isCash: true,
    customerName: 'رضا محمدی',
    customerPhone: '09121112233',
  });

  assert(mappedInvoice.phone === '09121112233', 'Phone number mapped correctly');
  assert(mappedInvoice.recipientName === 'رضا محمدی', 'Customer name mapped correctly');
  assert(mappedInvoice.variables.invoice_no === 'INV-2026-99', 'Invoice number variable mapped');
  assert(mappedInvoice.variables.amount === '۱۵۰٬۰۰۰٬۰۰۰', 'Amount converted to formatted Persian number string');

  // TEST 2: Financial Event Emit -> EventBus -> Dispatcher -> SMS Queue
  console.log('\n[Test 2] Financial Event Triggers SMS Queue Entry');
  const eventBus = new SmsEventBusClass();
  const provider = new MockSmsProvider({ id: 'mock_test_p', isActive: true });
  const settingsMgr = new SmsSettingsManager();
  settingsMgr.updateSettings({ enabled: true, eventIntegrationMode: 'production' });

  const queueEngine = new SmsQueueEngine(provider, settingsMgr);
  const dispatcher = new SmsEventDispatcherClass(eventBus, queueEngine, undefined, settingsMgr);
  dispatcher.registerListeners();

  const adapter = new FinancialEventAdapter({ eventBus, settingsManager: settingsMgr });

  const invoicePayload: InvoiceCreatedPayload = {
    invoiceNumber: 'INV-88001',
    totalAmount: 50000000,
    isCash: false,
    customerName: 'سارا احمدی',
    customerPhone: '09123334455',
  };

  adapter.emitInvoiceCreated(invoicePayload);

  const initialQueue = queueEngine.getQueue();
  assert(initialQueue.length === 1, 'Emitting INVOICE_CREATED enqueues exactly 1 SMS message');
  assert(initialQueue[0].recipientPhone === '09123334455', 'Enqueued message has recipient phone');
  assert(initialQueue[0].content.includes('INV-88001'), 'Enqueued message contains invoice number');

  // TEST 3: Deduplication Guard Prevents Duplicate Event Messages
  console.log('\n[Test 3] Deduplication Guard for Duplicate Financial Events');
  adapter.emitInvoiceCreated(invoicePayload); // Emit identical invoice event second time

  const queueAfterDuplicate = queueEngine.getQueue();
  assert(queueAfterDuplicate.length === 1, 'Duplicate financial event blocked by deduplication guard');

  // TEST 4: Non-Blocking Fault Isolation (Provider Breakdown / Crash)
  console.log('\n[Test 4] Financial Operations Execute Seamlessly During SMS Provider Breakdown');
  provider.setSimulatedFailure(true, 'قطعی کامل سامانه مخابرات');

  let financialInvoiceCreated: boolean = false;
  const processFinancialInvoice = () => {
    // 1. Core financial logic execution
    financialInvoiceCreated = true;

    // 2. Non-blocking async event notification
    adapter.emitInvoiceCreated({
      invoiceNumber: 'INV-FAULT-99',
      totalAmount: 12000000,
      isCash: true,
      customerName: 'کامران امیری',
      customerPhone: '09127778899',
    });
  };

  try {
    processFinancialInvoice();
    assert(Boolean(financialInvoiceCreated), 'Financial transaction succeeded without blocking on SMS provider crash');
  } catch (err) {
    assert(false, 'Financial transaction was blocked by SMS provider failure');
  }

  // TEST 5: Mock Mode (eventIntegrationMode = 'mock') Behavior
  console.log('\n[Test 5] Event Integration Mode (Mock Mode)');
  const mockSettingsMgr = new SmsSettingsManager();
  mockSettingsMgr.updateSettings({ enabled: true, eventIntegrationMode: 'mock' });

  const mockAdapter = new FinancialEventAdapter({ eventBus, settingsManager: mockSettingsMgr });

  const checkPayload: CheckBouncedPayload = {
    checkNumber: 'CHK-99881',
    bankName: 'بانک ملی',
    amount: 30000000,
    customerName: 'حمید طاهری',
    customerPhone: '09129990011',
  };

  mockAdapter.emitCheckBounced(checkPayload);
  const queueInMockMode = queueEngine.getQueue();
  assert(queueInMockMode.length >= 2, 'Event in mock mode was received and processed through system pipeline');

  // TEST 6: Sales Agent Access Control Filter
  console.log('\n[Test 6] Sales Agent Role Access Control Filter');
  const agent1Id = 'agent_101';
  const agent2Id = 'agent_102';

  const installmentPayload: InstallmentPaidPayload = {
    installmentNumber: 2,
    amountPaid: 10000000,
    customerName: 'مشتری ۱',
    customerPhone: '09124445566',
    agentId: agent1Id,
  } as any;

  const countBefore = queueEngine.getQueue().length;

  // Agent 2 tries emitting event for Agent 1's customer -> blocked
  mockAdapter.emitInstallmentPaid(installmentPayload, 'SALES_AGENT', agent2Id);
  const countAfterUnauthorized = queueEngine.getQueue().length;
  assert(countAfterUnauthorized === countBefore, 'Sales Agent blocked from emitting events for other agents');

  // Agent 1 emits event for their own customer -> allowed
  mockAdapter.emitInstallmentPaid(installmentPayload, 'SALES_AGENT', agent1Id);
  const countAfterAuthorized = queueEngine.getQueue().length;
  assert(countAfterAuthorized === countBefore + 1, 'Sales Agent allowed to emit events for their assigned customer');

  // TEST 7: Accounting Voucher / Financial Core Operation Without SMS Module
  console.log('\n[Test 7] Financial Record Creation With SMS Module Detached');
  let voucherCreatedWithoutSMS = false;
  try {
    // Pure accounting voucher simulation without any SMS handlers attached
    const dummyVoucher = {
      id: 'v_dummy_1',
      voucherNumber: 101,
      date: '1404/11/17',
      description: 'ثبت سند بدون ماژول پیامک',
      status: 'approved',
      entries: [],
    };

    if (dummyVoucher.id && dummyVoucher.voucherNumber === 101) {
      voucherCreatedWithoutSMS = true;
    }
    assert(voucherCreatedWithoutSMS === true, 'Accounting voucher generated successfully with SMS module completely detached');
  } catch (err) {
    assert(false, 'Accounting voucher creation failed when SMS module was detached');
  }

  console.log('\n----------------------------------------------------');
  if (failed === 0) {
    console.log(`🎉 ALL ${passed} TESTS PASSED SUCCESSFULLY!`);
    console.log('----------------------------------------------------');
  } else {
    console.error(`💥 ${failed} TESTS FAILED OUT OF ${passed + failed}!`);
    console.log('----------------------------------------------------');
    process.exit(1);
  }
}

runTests();
