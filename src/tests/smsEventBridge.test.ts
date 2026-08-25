/**
 * Test Suite for Step 4: SMS Event Bridge Layer
 * Verifies EventBus, EventDispatcher, MockEventSource, and Fault Isolation.
 */

import { SmsEventBus, SmsEventBusClass } from '../modules/sms/eventBus';
import { SmsEventDispatcherClass } from '../modules/sms/eventDispatcher';
import { SmsQueueEngine } from '../modules/sms/queueEngine';
import { SmsTemplateEngine } from '../modules/sms/templateEngine';
import { SmsSettingsManager } from '../modules/sms/smsSettings';
import { SmsMockEventSource } from '../modules/sms/mockEventSource';
import { ISmsProvider } from '../modules/sms/providers/provider.interface';

import { SmsPriority, SmsProviderConfig, SmsStatus } from '../modules/sms/types';

// Mock Provider to check direct send calls
class DummyTestProvider implements ISmsProvider {
  id = 'dummy';
  name = 'Dummy Test Provider';
  type = 'mock' as const;
  isActive = true;
  isDefault = true;
  supportPattern = false;
  rateLimitPerMinute = 60;

  public sendSmsCallsCount = 0;

  getProviderInfo(): SmsProviderConfig {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      isActive: this.isActive,
      isDefault: this.isDefault,
      supportPattern: this.supportPattern,
      rateLimitPerMinute: this.rateLimitPerMinute,
    };
  }

  async sendSms(phone: string, message: string) {
    this.sendSmsCallsCount++;
    return { success: true, messageId: 'msg_dummy_123' };
  }

  async sendPatternSms(phone: string, patternId: string, tokens: Record<string, string>) {
    this.sendSmsCallsCount++;
    return { success: true, messageId: 'msg_dummy_pattern_123' };
  }

  async getCreditBalance(): Promise<number> {
    return 10000;
  }

  async checkDeliveryStatus(messageIdFromProvider: string): Promise<{
    status: SmsStatus;
    deliveredAt?: string;
    error?: string;
  }> {
    return { status: 'sent' };
  }
}

function runTests() {
  console.log('----------------------------------------------------');
  console.log('🧪 Running Test Suite: SMS Event Bridge Layer (Step 4)');
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

  // TEST 1: EventBus Subscription & Unsubscription
  console.log('\n[Test 1] EventBus Pub/Sub Basics');
  const bus = new SmsEventBusClass();
  let receivedCount = 0;
  let receivedData: any = null;

  const unsub = bus.subscribe('TEST_EVENT', (payload) => {
    receivedCount++;
    receivedData = payload;
  });

  bus.publish('TEST_EVENT', { invoiceId: 'INV-1' });
  assert(receivedCount === 1 && receivedData?.invoiceId === 'INV-1', 'Event received by subscriber');

  unsub();
  bus.publish('TEST_EVENT', { invoiceId: 'INV-2' });
  assert(receivedCount === 1, 'Unsubscribed handler does not receive further events');

  // TEST 2: Fault Isolation (AC-02)
  console.log('\n[Test 2] Fault Isolation - Listener Errors Do Not Crash Publisher');
  const faultyBus = new SmsEventBusClass();
  let secondListenerExecuted: boolean = false;

  faultyBus.subscribe('FAULTY_EVENT', () => {
    throw new Error('Crashing listener error!');
  });

  faultyBus.subscribe('FAULTY_EVENT', () => {
    secondListenerExecuted = true;
  });

  try {
    faultyBus.publish('FAULTY_EVENT', { data: 'test' });
    assert(secondListenerExecuted, 'Subsequent listeners execute even if previous throws');
    assert(true, 'Publishing faulty event does not throw error to publisher');
  } catch (err) {
    assert(false, 'Faulty listener caused publish() to throw exception');
  }

  // TEST 3: Event Dispatcher & Queue Enqueue without Direct Provider Send (AC-03)
  console.log('\n[Test 3] Event Dispatcher Enqueues Messages into SMS Queue without Direct Send');
  const provider = new DummyTestProvider();
  const settingsMgr = new SmsSettingsManager();
  const tplEngine = new SmsTemplateEngine();
  const queueEngine = new SmsQueueEngine(provider, settingsMgr);
  const testBus = new SmsEventBusClass();

  const dispatcher = new SmsEventDispatcherClass(testBus, queueEngine, tplEngine, settingsMgr);
  dispatcher.registerListeners();

  const mockSource = new SmsMockEventSource(testBus);

  // Simulate INVOICE_CREATED
  mockSource.simulateInvoiceCreated({
    invoiceNumber: 'INV-999',
    customerName: 'تست کننده',
    customerPhone: '09129999999',
    totalAmount: 10000000,
    isCash: true,
  });

  const messagesInQueue = queueEngine.getAllMessages();
  const invMessage = messagesInQueue.find((m) => m.recipientPhone === '09129999999');

  assert(invMessage !== undefined, 'Invoice created event generated message in queue');
  assert(invMessage?.status === 'pending', 'Enqueued message status is pending (not sent yet)');
  assert(invMessage?.content.includes('INV-999'), 'Message content interpolated invoice number');
  assert(provider.sendSmsCallsCount === 0, 'No direct sendSms call was executed on provider');

  // TEST 4: Disabled SMS Settings Ignore Events Gracefully (AC-01)
  console.log('\n[Test 4] Disabled SMS Module Ignores Events Gracefully');
  settingsMgr.updateSettings({ enabled: false });

  const queueCountBefore = queueEngine.getAllMessages().length;

  mockSource.simulateCheckBounced({
    checkNumber: 'CHK-777',
    customerPhone: '09128888888',
  });

  const queueCountAfter = queueEngine.getAllMessages().length;
  assert(queueCountBefore === queueCountAfter, 'Disabled SMS settings prevents queue insertion');

  // TEST 5: Re-enable and Simulate Check Bounced & OTP
  console.log('\n[Test 5] Critical Priority Events (Check Bounced & OTP)');
  settingsMgr.updateSettings({ enabled: true });

  mockSource.simulateCheckBounced({
    checkNumber: 'CHK-888',
    customerPhone: '09127777777',
    amount: 50000000,
  });

  const bouncedMessage = queueEngine.getAllMessages().find((m) => m.recipientPhone === '09127777777');
  assert(bouncedMessage?.priority === 'critical', 'Check bounced event has critical priority');

  mockSource.simulateOtpRequested({
    recipientPhone: '09126666666',
    otpCode: '123456',
  });

  const otpMessage = queueEngine.getAllMessages().find((m) => m.recipientPhone === '09126666666');
  assert(otpMessage?.content.includes('123456'), 'OTP code interpolated correctly in OTP message');

  // TEST 6: Dispatcher Stats
  console.log('\n[Test 6] Dispatcher Stats Monitoring');
  const stats = dispatcher.getStats();
  assert(stats.eventsProcessedCount >= 3, 'Events processed count tracked');
  assert(stats.queueItemsCreatedCount >= 3, 'Queue items created count tracked');
  assert(stats.lastReceivedEventName === 'OTP_REQUESTED', 'Last received event name updated');

  // TEST 7: Nesyeh Credit Events & Bridge (AC-Nesyeh)
  console.log('\n[Test 7] Nesyeh Credit Events Bridge');
  
  // Emit Nesyeh Order Submitted
  testBus.publish('ON_NESYEH_ORDER_SUBMITTED', {
    orderNumber: 'NPO-1001',
    partnerName: 'فروشگاه پارس',
    totalAmount: 45000000,
    customerPhone: '09121112222',
  });

  const nesyehOrderMsg = queueEngine.getAllMessages().find((m) => m.recipientPhone === '09121112222');
  assert(nesyehOrderMsg !== undefined, 'ON_NESYEH_ORDER_SUBMITTED generated SMS queue item');
  assert(nesyehOrderMsg?.content.includes('NPO-1001'), 'Nesyeh order number correctly interpolated');

  // Emit Nesyeh Order Status Changed
  testBus.publish('ON_NESYEH_ORDER_STATUS_CHANGED', {
    orderNumber: 'NPO-1001',
    partnerName: 'فروشگاه پارس',
    newStatus: 'تایید شده',
    customerPhone: '09123334444',
  });

  const statusMsg = queueEngine.getAllMessages().find((m) => m.recipientPhone === '09123334444');
  assert(statusMsg !== undefined, 'ON_NESYEH_ORDER_STATUS_CHANGED generated SMS queue item');
  assert(statusMsg?.content.includes('تایید شده'), 'Nesyeh new status interpolated');

  // Emit Nesyeh Payment Verified
  testBus.publish('ON_NESYEH_PAYMENT_VERIFIED', {
    declarationId: 'DEC-501',
    partnerName: 'فروشگاه پارس',
    paymentType: 'CASH',
    amount: 20000000,
    customerPhone: '09125556666',
  });

  const payMsg = queueEngine.getAllMessages().find((m) => m.recipientPhone === '09125556666');
  assert(payMsg !== undefined, 'ON_NESYEH_PAYMENT_VERIFIED generated SMS queue item');

  // Emit Credit Limit Approaching
  testBus.publish('ON_CREDIT_LIMIT_APPROACHING', {
    partnerName: 'فروشگاه پارس',
    currentDebt: 85000000,
    creditLimit: 100000000,
    debtRatioPercent: 85,
    customerPhone: '09127778888',
  });

  const creditMsg = queueEngine.getAllMessages().find((m) => m.recipientPhone === '09127778888');
  assert(creditMsg !== undefined, 'ON_CREDIT_LIMIT_APPROACHING generated SMS queue item');
  assert(creditMsg?.priority === 'critical', 'Credit limit warning has critical priority');

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
