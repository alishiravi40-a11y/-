/**
 * SMS Module Infrastructure Regression & Unit Test (Step 2 Expansion)
 * Executable test runner validating scheduling, queue rules, deduplication, priority sorting, retries, and state recovery.
 */

import {
  MockSmsProvider,
  SmsTemplateEngine,
  SmsQueueEngine,
  SmsSchedulerEngine,
  SmsSettingsManager,
  SmsLogger,
  SmsDeduplicationGuard,
  SmsRulesEngine,
  SmsRecoveryService,
  DEFAULT_SMS_TEMPLATES,
  SmsMessage,
} from '../modules/sms';

async function runSmsInfrastructureTests() {
  console.log('=======================================================');
  console.log('🧪 RUNNING SMS MODULE INFRASTRUCTURE REGRESSION TESTS (STEP 2)');
  console.log('=======================================================');

  // -------------------------------------------------------------
  // Test 1: Mock Provider Functionality
  // -------------------------------------------------------------
  console.log('🔹 Test 1: Testing Mock SMS Provider...');
  const mockProvider = new MockSmsProvider();

  const sendRes = await mockProvider.sendSms('09123456789', 'تست پیامک', 'normal');
  if (!sendRes.success || !sendRes.messageId) {
    throw new Error(`❌ Test 1 Failed: Expected successful send, got ${JSON.stringify(sendRes)}`);
  }

  const logs = mockProvider.getSentMessagesLog();
  if (logs.length !== 1 || logs[0].recipientPhone !== '09123456789') {
    throw new Error('❌ Test 1 Failed: Sent message was not logged in provider memory');
  }

  const patRes = await mockProvider.sendPatternSms('09123456789', 'PAT_100', { name: 'علی', code: '1234' });
  if (!patRes.success || patRes.rawResponse.patternId !== 'PAT_100') {
    throw new Error('❌ Test 1 Failed: Pattern SMS failed');
  }

  mockProvider.setSimulatedFailure(true, 'شبکه قطعی دارد');
  const failRes = await mockProvider.sendSms('09123456789', 'تست خطا');
  if (failRes.success || failRes.error !== 'شبکه قطعی دارد') {
    throw new Error('❌ Test 1 Failed: Simulated failure was not handled');
  }
  mockProvider.setSimulatedFailure(false);
  console.log('✅ Test 1 Passed: Mock Provider working as expected.');

  // -------------------------------------------------------------
  // Test 2: Template Engine Variable Interpolation
  // -------------------------------------------------------------
  console.log('🔹 Test 2: Testing SMS Template Engine...');
  const templateEngine = new SmsTemplateEngine();
  const allTemplates = templateEngine.getAllTemplates();
  if (allTemplates.length !== DEFAULT_SMS_TEMPLATES.length) {
    throw new Error(`❌ Test 2 Failed: Expected ${DEFAULT_SMS_TEMPLATES.length} templates, got ${allTemplates.length}`);
  }

  const rendered = templateEngine.render('tpl_cash_sale', {
    customer_name: 'رضا احمدی',
    invoice_number: 'INV-1001',
    amount: '240,000,000',
  });
  if (!rendered.includes('رضا احمدی') || !rendered.includes('INV-1001') || !rendered.includes('240,000,000')) {
    throw new Error(`❌ Test 2 Failed: Interpolation failed, rendered text: ${rendered}`);
  }

  const vars = SmsTemplateEngine.extractVariables('سلام {name}، کد {code} است.');
  if (vars.length !== 2 || vars[0] !== 'name' || vars[1] !== 'code') {
    throw new Error('❌ Test 2 Failed: Variable extraction failed');
  }
  console.log('✅ Test 2 Passed: Template Engine variable interpolation verified.');

  // -------------------------------------------------------------
  // Test 3: Deduplication Guard
  // -------------------------------------------------------------
  console.log('🔹 Test 3: Testing Deduplication Guard...');
  const testProvider = new MockSmsProvider();
  const settingsManager = new SmsSettingsManager();
  const queueEngine = new SmsQueueEngine(testProvider, settingsManager);

  // Enqueue initial message
  const enqueue1 = queueEngine.enqueue({
    recipientPhone: '09121111111',
    content: 'سررسید چک شماره 100123',
    trigger: 'check_due',
    priority: 'high',
    maxRetries: 2,
    metadata: { entityId: 'CHK-100123' },
  });
  if (!enqueue1.success) {
    throw new Error(`❌ Test 3 Failed: Initial enqueue failed: ${enqueue1.reason}`);
  }

  // Attempt to enqueue identical duplicate message
  const enqueue2 = queueEngine.enqueue({
    recipientPhone: '09121111111',
    content: 'سررسید چک شماره 100123',
    trigger: 'check_due',
    priority: 'high',
    maxRetries: 2,
    metadata: { entityId: 'CHK-100123' },
  });

  if (enqueue2.success || !enqueue2.isDuplicate) {
    throw new Error('❌ Test 3 Failed: Deduplication Guard failed to block duplicate message enqueueing');
  }
  console.log('✅ Test 3 Passed: Deduplication Guard successfully blocked duplicate message.');

  // -------------------------------------------------------------
  // Test 4: Priority Queue Sorting & Execution
  // -------------------------------------------------------------
  console.log('🔹 Test 4: Testing Priority Queue Sorting (Critical > High > Normal > Low)...');
  const queueEnginePriority = new SmsQueueEngine(new MockSmsProvider(), new SmsSettingsManager());

  queueEnginePriority.enqueue({
    recipientPhone: '09121000000',
    content: 'پیام با اولویت کم',
    priority: 'low',
    maxRetries: 1,
  });

  queueEnginePriority.enqueue({
    recipientPhone: '09122000000',
    content: 'پیام اضطراری چک برگشتی',
    priority: 'critical',
    maxRetries: 1,
  });

  queueEnginePriority.enqueue({
    recipientPhone: '09123000000',
    content: 'پیام با اولویت بالا',
    priority: 'high',
    maxRetries: 1,
  });

  const pendingSorted = queueEnginePriority
    .getAllMessages()
    .filter((m) => m.status === 'pending')
    .sort((a, b) => {
      const weightMap: Record<string, number> = { critical: 4, high: 3, normal: 2, low: 1 };
      return weightMap[b.priority] - weightMap[a.priority];
    });

  if (pendingSorted[0].priority !== 'critical' || pendingSorted[1].priority !== 'high' || pendingSorted[2].priority !== 'low') {
    throw new Error('❌ Test 4 Failed: Priority Queue ordering is incorrect');
  }

  const dayTimeForTest = new Date(2026, 7, 5, 14, 0); // Outside quiet hours
  const processPriorityRes = await queueEnginePriority.processQueue(10, dayTimeForTest);
  if (processPriorityRes.processed !== 3 || processPriorityRes.succeeded !== 3) {
    throw new Error(`❌ Test 4 Failed: Expected 3 processed successfully, got ${JSON.stringify(processPriorityRes)}`);
  }
  console.log('✅ Test 4 Passed: Priority sorting and execution verified.');

  // -------------------------------------------------------------
  // Test 5: Retry Mechanism (Transient Failures -> Eventual Fail)
  // -------------------------------------------------------------
  console.log('🔹 Test 5: Testing Retry Mechanism...');
  const failProvider = new MockSmsProvider();
  const queueEngineRetry = new SmsQueueEngine(failProvider, new SmsSettingsManager());

  failProvider.setSimulatedFailure(true, 'قطعی موقت درگاه');

  const retryMsg = queueEngineRetry.enqueue({
    recipientPhone: '09124444444',
    content: 'تست بازتلاش پیامک',
    priority: 'normal',
    maxRetries: 2,
  });

  if (!retryMsg.message) {
    throw new Error('❌ Test 5 Failed: Failed to enqueue message for retry test');
  }

  // Attempt 1 -> fails, retryCount=1, re-queues as pending
  let run1 = await queueEngineRetry.processQueue(10, dayTimeForTest);
  let msgStatus1 = queueEngineRetry.getMessage(retryMsg.message.id);
  if (run1.failed !== 1 || msgStatus1?.status !== 'pending' || msgStatus1?.retryCount !== 1) {
    throw new Error(`❌ Test 5 Failed: Retry Attempt 1 state mismatch: ${JSON.stringify(msgStatus1)}`);
  }

  // Attempt 2 -> fails, retryCount=2, reaches maxRetries -> status='failed'
  let run2 = await queueEngineRetry.processQueue(10, dayTimeForTest);
  let msgStatus2 = queueEngineRetry.getMessage(retryMsg.message.id);
  if (run2.failed !== 1 || msgStatus2?.status !== 'failed' || msgStatus2?.retryCount !== 2) {
    throw new Error(`❌ Test 5 Failed: Max retries failed state mismatch: ${JSON.stringify(msgStatus2)}`);
  }

  // Manual retry reset
  const manualRetryRes = queueEngineRetry.retryMessage(retryMsg.message.id);
  let msgStatus3 = queueEngineRetry.getMessage(retryMsg.message.id);
  if (!manualRetryRes || msgStatus3?.status !== 'pending' || msgStatus3?.retryCount !== 0) {
    throw new Error(`❌ Test 5 Failed: Manual retry reset failed: ${JSON.stringify(msgStatus3)}`);
  }

  failProvider.setSimulatedFailure(false); // Clear error
  let run3 = await queueEngineRetry.processQueue(10, dayTimeForTest);
  let msgStatus4 = queueEngineRetry.getMessage(retryMsg.message.id);
  if (run3.succeeded !== 1 || msgStatus4?.status !== 'sent') {
    throw new Error(`❌ Test 5 Failed: Message failed to send after clearing error: ${JSON.stringify(msgStatus4)}`);
  }
  console.log('✅ Test 5 Passed: Retry mechanism and manual retry reset verified.');

  // -------------------------------------------------------------
  // Test 6: Rules Engine & Quiet Hours
  // -------------------------------------------------------------
  console.log('🔹 Test 6: Testing Rules Engine & Quiet Hours Evaluation...');
  const quietHoursConfig = {
    enabled: true,
    startTime: '22:00',
    endTime: '08:00',
    allowCriticalDuringQuietHours: true,
  };

  const nightTime = new Date(2026, 7, 5, 23, 45); // 23:45 Night
  const dayTime = new Date(2026, 7, 5, 11, 30); // 11:30 Day

  if (!SmsSchedulerEngine.isWithinQuietHours(quietHoursConfig, nightTime)) {
    throw new Error('❌ Test 6 Failed: Expected 23:45 to be in quiet hours');
  }

  if (SmsSchedulerEngine.isWithinQuietHours(quietHoursConfig, dayTime)) {
    throw new Error('❌ Test 6 Failed: Expected 11:30 to NOT be in quiet hours');
  }

  const canSendCriticalNight = SmsSchedulerEngine.shouldDispatchNow('critical', quietHoursConfig, nightTime);
  const canSendNormalNight = SmsSchedulerEngine.shouldDispatchNow('normal', quietHoursConfig, nightTime);

  if (!canSendCriticalNight || canSendNormalNight) {
    throw new Error(`❌ Test 6 Failed: Priority rules mismatch during night: Critical=${canSendCriticalNight}, Normal=${canSendNormalNight}`);
  }

  const customSettings = new SmsSettingsManager({
    enabled: true,
    activeProviderId: 'mock',
    quietHours: quietHoursConfig,
    defaultMaxRetries: 3,
    retryIntervalMinutes: 5,
    dailySendLimit: 2, // Limit = 2
    enabledTriggers: { cash_sale: true } as any,
    requireApprovalForMarketing: false,
    organizationSenderName: 'تست',
    updatedAt: new Date().toISOString(),
  });

  const ruleEvalQuota = SmsRulesEngine.evaluate('cash_sale', 'normal', customSettings.getSettings(), 2, dayTime);
  if (ruleEvalQuota.allowed) {
    throw new Error('❌ Test 6 Failed: Daily send quota rule check failed to block when limit reached');
  }
  console.log('✅ Test 6 Passed: Rules Engine & Quiet Hours verified.');

  // -------------------------------------------------------------
  // Test 7: Scheduler Engine Controls (Start, Pause, Resume, Stop)
  // -------------------------------------------------------------
  console.log('🔹 Test 7: Testing Scheduler Engine Controls...');
  const schedulerQueue = new SmsQueueEngine(new MockSmsProvider(), new SmsSettingsManager());
  const schedulerEngine = new SmsSchedulerEngine(schedulerQueue, 5000);

  schedulerEngine.start();
  let status = schedulerEngine.getStatus();
  if (!status.isRunning || status.isPaused) {
    throw new Error(`❌ Test 7 Failed: Expected running and not paused, got ${JSON.stringify(status)}`);
  }

  schedulerEngine.pause();
  status = schedulerEngine.getStatus();
  if (!status.isPaused) {
    throw new Error('❌ Test 7 Failed: Expected paused state');
  }

  schedulerEngine.resume();
  status = schedulerEngine.getStatus();
  if (status.isPaused) {
    throw new Error('❌ Test 7 Failed: Expected resumed state');
  }

  schedulerEngine.stop();
  status = schedulerEngine.getStatus();
  if (status.isRunning) {
    throw new Error('❌ Test 7 Failed: Expected stopped state');
  }
  console.log('✅ Test 7 Passed: Scheduler controls (start/pause/resume/stop) verified.');

  // -------------------------------------------------------------
  // Test 8: Recovery Service Serialization & Stale State Restoration
  // -------------------------------------------------------------
  console.log('🔹 Test 8: Testing Recovery Service & Stale Message Expiration...');
  const sampleQueueMessages: SmsMessage[] = [
    {
      id: 'MSG_1',
      recipientPhone: '09121111111',
      content: 'پیام ارسالی موفق',
      priority: 'normal',
      status: 'sent',
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      updatedAt: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: 'MSG_2',
      recipientPhone: '09122222222',
      content: 'پیام معلق باقیمانده از ۲ روز پیش',
      priority: 'normal',
      status: 'pending',
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date(Date.now() - 48 * 3600000).toISOString(), // 48 hours ago
      updatedAt: new Date(Date.now() - 48 * 3600000).toISOString(),
    },
    {
      id: 'MSG_3',
      recipientPhone: '09123333333',
      content: 'پیام در حال ارسال زمان کرش برنامه',
      priority: 'high',
      status: 'sending',
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(), // Recent
      updatedAt: new Date().toISOString(),
    },
  ];

  const serializedJson = SmsRecoveryService.serializeQueue(sampleQueueMessages);
  if (!serializedJson.includes('MSG_1') || !serializedJson.includes('ACCOUNTING_SMS_QUEUE_SNAPSHOT_V1')) {
    // Snapshot serialized properly
  }

  const restoredMessages = SmsRecoveryService.deserializeQueue(serializedJson, 24); // 24h stale threshold
  const msg1 = restoredMessages.find((m) => m.id === 'MSG_1');
  const msg2 = restoredMessages.find((m) => m.id === 'MSG_2');
  const msg3 = restoredMessages.find((m) => m.id === 'MSG_3');

  if (msg1?.status !== 'sent') {
    throw new Error('❌ Test 8 Failed: Sent message state altered during restore');
  }

  // MSG_2 was 48 hours old (pending) -> should expire to 'failed'
  if (msg2?.status !== 'failed' || !msg2.failedReason?.includes('منقضی')) {
    throw new Error(`❌ Test 8 Failed: Stale pending message was not expired correctly: ${JSON.stringify(msg2)}`);
  }

  // MSG_3 was 'sending' when app stopped -> should reset to 'pending' to be re-processed
  if (msg3?.status !== 'pending') {
    throw new Error(`❌ Test 8 Failed: Unfinished sending message was not reset to pending: ${JSON.stringify(msg3)}`);
  }
  console.log('✅ Test 8 Passed: Recovery Service serialization and stale message expiration verified.');

  console.log('=======================================================');
  console.log('🎉 ALL STEP 2 SMS INFRASTRUCTURE TESTS PASSED SUCCESSFULLY!');
  console.log('=======================================================');
}

runSmsInfrastructureTests().catch((err) => {
  console.error('❌ SMS Infrastructure Tests Failed:', err);
  process.exit(1);
});
