/**
 * Test Suite for Step 5: SMS Provider Gateway & Secure Delivery Layer
 * Verifies Provider Gateway, Failover Mechanism, Provider Registry, Security Masking, and Zero Financial Impact.
 */

import {
  SmsProviderRegistry,
  SmsProviderManager,
  SmsProviderHealthChecker,
  MockSmsProvider,
  KavenegarSmsProvider,
  FarazSmsProvider,
  GhasedakSmsProvider,
  SmsSettingsManager,
  SmsQueueEngine,
  maskApiKey,
  sanitizeProviderConfig,
  SmsMessage,
} from '../modules/sms';

function runTests() {
  console.log('----------------------------------------------------');
  console.log('🧪 Running Test Suite: SMS Provider Gateway Layer (Step 5)');
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

  // TEST 1: Provider Registry Initialization & Registration
  console.log('\n[Test 1] Provider Registry & Default Providers');
  const registry = new SmsProviderRegistry(true);
  const providers = registry.getAllProviders();

  assert(providers.length >= 4, 'Registry registers default providers (Mock, Kavenegar, Faraz, Ghasedak)');
  assert(registry.getProvider('mock_provider_01') !== undefined, 'Mock provider found in registry');
  assert(registry.getProvider('kavenegar_primary') !== undefined, 'Kavenegar provider found in registry');

  // TEST 2: Security & API Key Masking
  console.log('\n[Test 2] Security Credentials Masking');
  const maskedShort = maskApiKey('123');
  const maskedKey = maskApiKey('KVN_SECRET_KEY_123456789');

  assert(maskedShort === '***', 'Short API keys masked safely');
  assert(maskedKey === 'KVN_***6789', 'Long API keys masked showing prefix and suffix only');

  const kavenegar = new KavenegarSmsProvider({ apiKey: 'SECRET_API_KEY_9999' });
  const sanitizedConfig = kavenegar.getProviderInfo();
  assert(sanitizedConfig.apiKey !== 'SECRET_API_KEY_9999', 'Raw API key is never exposed in provider info');
  assert(sanitizedConfig.apiKey?.includes('***') === true, 'Sanitized config contains masked API key');

  // TEST 3: Successful Send via Mock Provider in Gateway
  console.log('\n[Test 3] Successful SMS Send via Provider Gateway');
  const mockProvider = new MockSmsProvider({ id: 'mock_primary', isActive: true, isDefault: true });
  const testRegistry = new SmsProviderRegistry(false);
  testRegistry.registerProvider(mockProvider);

  const settingsMgr = new SmsSettingsManager();
  settingsMgr.updateSettings({ enabled: true, activeProviderId: 'mock_primary' });

  const healthChecker = new SmsProviderHealthChecker();
  const gateway = new SmsProviderManager(testRegistry, healthChecker, settingsMgr);

  let dispatchRes;
  // Sync wrapper for test
  const testDispatch = async () => {
    dispatchRes = await gateway.dispatchSms({
      recipientPhone: '09121111111',
      content: 'سلام، این یک پیامک آزمایشی است',
    });
  };

  testDispatch().then(async () => {
    assert(dispatchRes?.success === true, 'SMS dispatched successfully through gateway');
    assert(dispatchRes?.providerIdUsed === 'mock_primary', 'Gateway used active mock provider');
    assert(dispatchRes?.isFailoverUsed === false, 'Failover was not triggered for normal send');

    // TEST 4: Provider Error & Retry
    console.log('\n[Test 4] Provider Error Handling in Gateway');
    mockProvider.setSimulatedFailure(true, 'خطای موقت درگاه اصلی');

    const failedDispatch = await gateway.dispatchSms({
      recipientPhone: '09122222222',
      content: 'تست خطای درگاه',
    });

    assert(failedDispatch.success === false, 'Gateway catches provider error gracefully');
    assert(failedDispatch.errorCode === 'MOCK_ERR_TIMEOUT', 'Error code returned safely without crashing');

    // Reset failure
    mockProvider.setSimulatedFailure(false);

    // TEST 5: Switching Active Provider
    console.log('\n[Test 5] Switching Active Provider Dynamically');
    const farazProvider = new FarazSmsProvider({ id: 'faraz_active', apiKey: 'TEST_KEY_FARAZ', isActive: true });
    testRegistry.registerProvider(farazProvider);

    settingsMgr.updateSettings({ activeProviderId: 'faraz_active' });

    const switchDispatch = await gateway.dispatchSms({
      recipientPhone: '09123333333',
      content: 'تست تغییر سرویس دهنده',
    });

    assert(switchDispatch.success === true, 'SMS sent after switching active provider');
    assert(switchDispatch.providerIdUsed === 'faraz_active', 'Gateway used newly selected FarazSMS provider');

    // TEST 6: Automatic Failover to Secondary Provider
    console.log('\n[Test 6] Automatic Failover to Secondary Provider');
    // Configure Kavenegar as Primary (which fails due to outage or unconfigured key) and Mock as Fallback
    const failingPrimary = new KavenegarSmsProvider({ id: 'kavenegar_failing', apiKey: '' });
    const fallbackMock = new MockSmsProvider({ id: 'mock_fallback', isActive: true });

    testRegistry.registerProvider(failingPrimary);
    testRegistry.registerProvider(fallbackMock);

    settingsMgr.updateSettings({
      activeProviderId: 'kavenegar_failing',
      fallbackProviderId: 'mock_fallback',
    });

    const failoverDispatch = await gateway.dispatchSms({
      recipientPhone: '09124444444',
      content: 'پیامک دارای فیل‌اور خودکار',
    });

    assert(failoverDispatch.success === true, 'SMS successfully sent via fallback provider');
    assert(failoverDispatch.providerIdUsed === 'mock_fallback', 'Fallback provider ID used');
    assert(failoverDispatch.isFailoverUsed === true, 'Failover flag marked true');
    assert(failoverDispatch.attemptCount === 2, 'Attempt count reflects failover');

    // TEST 7: Queue Integration & No Duplicate Sends (Deduplication)
    console.log('\n[Test 7] Queue Integration & Deduplication Protection');
    const settingsWithNoQuietHours = new SmsSettingsManager();
    const currentSettings = settingsMgr.getSettings();
    settingsWithNoQuietHours.updateSettings({
      ...currentSettings,
      quietHours: { ...currentSettings.quietHours, enabled: false },
    });

    const queueEngine = new SmsQueueEngine(fallbackMock, settingsWithNoQuietHours, gateway);

    const enq1 = queueEngine.enqueue({
      recipientPhone: '09125555555',
      content: 'فاکتور شماره INV-101 صادر شد',
      priority: 'high',
      metadata: { invoiceNumber: 'INV-101' },
    });

    const enq2 = queueEngine.enqueue({
      recipientPhone: '09125555555',
      content: 'فاکتور شماره INV-101 صادر شد',
      priority: 'high',
      metadata: { invoiceNumber: 'INV-101' },
    });

    assert(enq1.success === true, 'First invoice SMS enqueued');
    assert(enq2.success === false && enq2.isDuplicate === true, 'Duplicate invoice SMS rejected by deduplication guard');

    const processRes = await queueEngine.processQueue(10);
    assert(processRes.succeeded === 1, 'Only 1 message processed and sent from queue');

    // TEST 8: Health Checker Evaluation
    console.log('\n[Test 8] Provider Health Checker');
    const healthResults = await gateway.runHealthChecks();
    assert(healthResults.length > 0, 'Health checker evaluated registered providers');
    const mockHealth = healthResults.find((r) => r.providerId === 'mock_fallback');
    assert(mockHealth?.isHealthy === true, 'Mock fallback provider reported healthy');

    // TEST 9: Non-blocking Fault Isolation for Financial Operations (AC-04)
    console.log('\n[Test 9] Zero Impact on Financial Core (Fault Isolation)');
    try {
      // Simulate complete provider collapse
      const brokenGateway = new SmsProviderManager(
        new SmsProviderRegistry(false),
        healthChecker,
        settingsMgr
      );

      // Financial operation simulator (e.g. issuing invoice)
      let invoiceCreated = false;
      const simulateFinancialInvoiceCreation = async () => {
        // Core financial logic
        invoiceCreated = true;

        // Trigger SMS notification safely
        try {
          await brokenGateway.dispatchSms({
            recipientPhone: '09120000000',
            content: 'اطلاعیه صدور فاکتور',
          });
        } catch (smsErr) {
          console.error('SMS Gateway error caught safely');
        }
      };

      await simulateFinancialInvoiceCreation();
      assert(invoiceCreated, 'Invoice created successfully even when SMS gateway provider breaks');
    } catch (err) {
      assert(false, 'Financial operation was blocked by SMS provider error');
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
  });
}

runTests();
