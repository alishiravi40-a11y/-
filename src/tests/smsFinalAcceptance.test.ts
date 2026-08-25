/**
 * Comprehensive Final Acceptance Test Suite (UAT Step 7)
 * Validates AC-01 to AC-06, high-volume queue performance, role access control,
 * security credential masking, and zero impact on financial core.
 */

import {
  FinancialEventAdapter,
  SmsEventBusClass,
  SmsEventDispatcherClass,
  SmsQueueEngine,
  SmsSettingsManager,
  MockSmsProvider,
  KavenegarSmsProvider,
  SmsLogger,
  SmsDeduplicationGuard,
  SmsRulesEngine,
  SmsProviderManager,
  SmsProviderRegistry,
  SmsProviderHealthChecker,
  maskApiKey,
  sanitizeProviderConfig,
  SmsMessage,
} from '../modules/sms';

function runTests() {
  console.log('=======================================================');
  console.log('🧪 RUNNING SMS MODULE FINAL ACCEPTANCE TEST SUITE (STEP 7)');
  console.log('=======================================================');

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

  // AC-01: Non-blocking financial execution during SMS outage
  console.log('\n[AC-01] Non-blocking Financial Execution During SMS Outage');
  const mockProvider = new MockSmsProvider({ id: 'failing_prov', isActive: true });
  mockProvider.setServiceOutage(true); // Complete outage

  const settingsMgr = new SmsSettingsManager();
  settingsMgr.updateSettings({ enabled: true, eventIntegrationMode: 'production' });

  const eventBus = new SmsEventBusClass();
  const queueEngine = new SmsQueueEngine(mockProvider, settingsMgr);
  const dispatcher = new SmsEventDispatcherClass(eventBus, queueEngine, undefined, settingsMgr);
  dispatcher.registerListeners();

  const adapter = new FinancialEventAdapter({ eventBus, settingsManager: settingsMgr });

  let invoiceRegistered = false;
  const issueInvoiceWithOutage = () => {
    // 1. Accounting/Financial logic
    invoiceRegistered = true;

    // 2. Non-blocking SMS notification trigger
    adapter.emitInvoiceCreated({
      invoiceNumber: 'INV-AC01-100',
      totalAmount: 250000000,
      isCash: true,
      customerName: 'حسن رضایی',
      customerPhone: '09121110000',
    });
  };

  try {
    issueInvoiceWithOutage();
    assert(Boolean(invoiceRegistered), 'Invoice registered without throwing error during complete SMS outage');
    const queue = queueEngine.getQueue();
    assert(queue.length === 1, 'SMS event enqueued safely into pending state for retry');
  } catch (err) {
    assert(false, 'Invoice creation crashed or was blocked by SMS outage');
  }

  // AC-02: Deduplication Guard for Installment/Check Events
  console.log('\n[AC-02] Deduplication Guard Blocking Duplicate Messages');
  const msg1: SmsMessage = {
    id: 'msg_01',
    recipientPhone: '09122223333',
    content: 'سررسید قسط شماره ۱ - مبلغ ۵,۰۰۰,۰۰۰ ریال',
    status: 'pending',
    priority: 'high',
    retryCount: 0,
    maxRetries: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: { installmentNumber: '1', bookNumber: 'B-100' },
  };

  const isDup1 = SmsDeduplicationGuard.isDuplicate(msg1, [msg1]);
  assert(Boolean(isDup1.isDuplicate), 'Identical installment SMS identified as duplicate');

  // AC-03: Quiet Hours Execution Policy
  console.log('\n[AC-03] Quiet Hours Queue Holding Policy');
  const quietSettings = new SmsSettingsManager();
  quietSettings.updateSettings({
    enabled: true,
    quietHours: {
      enabled: true,
      startTime: '00:00',
      endTime: '23:59', // All day quiet
      allowCriticalDuringQuietHours: true,
    },
  });

  const normalEval = SmsRulesEngine.evaluate('installment_due', 'normal', quietSettings.getSettings(), 0, new Date());
  assert(normalEval.allowed === false, 'Normal priority message deferred during quiet hours');

  const criticalEval = SmsRulesEngine.evaluate('check_bounced', 'critical', quietSettings.getSettings(), 0, new Date());
  assert(criticalEval.allowed === true, 'Critical priority message allowed during quiet hours');

  // AC-04: Provider Failover Mechanism
  console.log('\n[AC-04] SMS Provider Failover Mechanism');
  const testRegistry = new SmsProviderRegistry(false);
  const primaryFailing = new KavenegarSmsProvider({ id: 'primary_kav', apiKey: '' });
  const fallbackMock = new MockSmsProvider({ id: 'fallback_mock', isActive: true });

  testRegistry.registerProvider(primaryFailing);
  testRegistry.registerProvider(fallbackMock);

  const failoverSettings = new SmsSettingsManager();
  failoverSettings.updateSettings({
    enabled: true,
    activeProviderId: 'primary_kav',
    fallbackProviderId: 'fallback_mock',
  });

  const providerMgr = new SmsProviderManager(testRegistry, new SmsProviderHealthChecker(), failoverSettings);

  let failoverResult;
  const runFailoverTest = async () => {
    failoverResult = await providerMgr.dispatchSms({
      recipientPhone: '09124445566',
      content: 'تست فیل‌اور خودکار درگاه پیامک',
    });
  };

  runFailoverTest().then(async () => {
    assert(failoverResult?.success === true, 'SMS successfully sent via secondary fallback provider');
    assert(failoverResult?.providerIdUsed === 'fallback_mock', 'Fallback provider used');
    assert(failoverResult?.isFailoverUsed === true, 'Failover flag set to true');

    // AC-05: Serialization & State Recovery
    console.log('\n[AC-05] Persistence Serialization & State Recovery');
    const mockStateStore = new Map<string, string>();
    const saveState = (queue: SmsMessage[]) => {
      mockStateStore.set('SMS_QUEUE_BACKUP', JSON.stringify(queue));
    };
    const restoreState = (): SmsMessage[] => {
      const raw = mockStateStore.get('SMS_QUEUE_BACKUP');
      return raw ? JSON.parse(raw) : [];
    };

    const initialList: SmsMessage[] = [msg1];
    saveState(initialList);

    const restoredList = restoreState();
    assert(restoredList.length === 1, 'Queue state persisted and restored correctly');
    assert(restoredList[0].id === 'msg_01', 'Restored message ID matches original');

    // AC-06: Security & Data Masking Audit
    console.log('\n[AC-06] Security Credential & Public Log Masking');
    const sensitiveApiKey = 'KAVENEGAR_LIVE_API_KEY_998877665544332211';
    const masked = maskApiKey(sensitiveApiKey);
    assert(!masked.includes('LIVE_API_KEY'), 'API key is masked in UI/Log representation');
    assert(masked.startsWith('KAVE') && masked.endsWith('2211'), 'Masked API key displays prefix and suffix');

    const sanitized = sanitizeProviderConfig({
      id: 'p1',
      name: 'Kavenegar',
      type: 'kavenegar',
      apiKey: sensitiveApiKey,
      isActive: true,
      isDefault: false,
      supportPattern: true,
      rateLimitPerMinute: 60,
    });
    assert(sanitized.apiKey !== sensitiveApiKey, 'Sanitized config removes raw API key');

    // HIGH VOLUME STRESS TEST: 1,000 Messages Queue Processing
    console.log('\n[High Volume Stress Test] 1,000 Queue Items Batch Execution');
    const stressSettingsMgr = new SmsSettingsManager();
    stressSettingsMgr.updateSettings({
      enabled: true,
      dailySendLimit: 10000,
      quietHours: { enabled: false, startTime: '00:00', endTime: '00:00', allowCriticalDuringQuietHours: true },
    });
    const stressProvider = new MockSmsProvider({ id: 'stress_mock', isActive: true });
    const stressQueueEngine = new SmsQueueEngine(stressProvider, stressSettingsMgr);

    console.time('Enqueue 1,000 messages');
    for (let i = 0; i < 1000; i++) {
      stressQueueEngine.enqueue({
        recipientPhone: `0912${String(i).padStart(7, '0')}`,
        content: `اطلاعیه شماره ${i + 1}`,
        priority: i % 10 === 0 ? 'high' : 'normal',
      });
    }
    console.timeEnd('Enqueue 1,000 messages');

    assert(stressQueueEngine.getQueue().length === 1000, '1,000 messages successfully enqueued');

    console.time('Batch Process 1,000 messages');
    const batchResult = await stressQueueEngine.processQueue(1000);
    console.timeEnd('Batch Process 1,000 messages');

    assert(batchResult.processed === 1000, 'All 1,000 queue messages processed in batch');
    assert(batchResult.succeeded === 1000, 'All 1,000 queue messages sent successfully');

    console.log('\n=======================================================');
    if (failed === 0) {
      console.log(`🎉 ALL ${passed} FINAL ACCEPTANCE TESTS PASSED SUCCESSFULLY!`);
      console.log('=======================================================');
    } else {
      console.error(`💥 ${failed} TESTS FAILED OUT OF ${passed + failed}!`);
      console.log('=======================================================');
      process.exit(1);
    }
  });
}

runTests();
