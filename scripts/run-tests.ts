import fs from 'fs';
import path from 'path';
import { spawnSync, spawn } from 'child_process';
import os from 'os';
import crypto from 'crypto';
import net from 'net';

const TESTS_DIR = path.resolve('src/tests');
const TEST_FILE_REGEX = /\.(test|spec)\.[jt]sx?$/;

function findTestFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) {
    return results;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTestFiles(fullPath));
    } else if (entry.isFile()) {
      if (TEST_FILE_REGEX.test(entry.name)) {
        const relativePath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
        results.push(relativePath);
      }
    }
  }
  return results;
}

async function main() {
  console.log('=== Comprehensive & Honest Test Runner ===');
  console.log(`Searching for test files in: ${TESTS_DIR}`);

  const discoveredFiles = findTestFiles(TESTS_DIR);
  discoveredFiles.sort();

  console.log(`Discovered ${discoveredFiles.length} test files.\n`);

  if (discoveredFiles.length === 0) {
    console.error('❌ FATAL: No test files discovered!');
    process.exit(1);
  }

  const uniqueSet = new Set(discoveredFiles);
  if (uniqueSet.size !== discoveredFiles.length) {
    console.error('❌ FATAL: Duplicate test files detected in discovery!');
    process.exit(1);
  }

  // Calculate hash of central_app_state.json before running tests
  const centralStatePath = path.join(process.cwd(), 'central_app_state.json');
  function getFileHash(filePath: string): string {
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }
  const hashBefore = getFileHash(centralStatePath);
  console.log(`[Test Runner] central_app_state.json initial hash: ${hashBefore}`);

  // Create temporary copy of central_app_state.json in system temp folder
  const tempStoreFile = path.join(os.tmpdir(), `central_app_state_test_${Date.now()}_${Math.random().toString(36).substring(2, 11)}.json`);
  fs.copyFileSync(centralStatePath, tempStoreFile);
  console.log(`[Test Runner] Created temporary store copy at: ${tempStoreFile}`);

  // Set environment variables for isolated test context
  const TEST_PORT = 3199;

  // Active check that the port is free before we proceed
  function checkPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => {
        resolve(false);
      });
      server.once('listening', () => {
        server.close(() => {
          resolve(true);
        });
      });
      server.listen(port, '127.0.0.1');
    });
  }

  const isPortAvailable = await checkPortFree(TEST_PORT);
  if (!isPortAvailable) {
    console.error(`❌ FATAL: Test port ${TEST_PORT} is already occupied! A pre-existing server or concurrent process is active.`);
    try {
      if (fs.existsSync(tempStoreFile)) fs.unlinkSync(tempStoreFile);
    } catch (_) {}
    process.exit(1);
  }

  // Generate unique handshake token to prove the server is the one we started
  const handshakeToken = `test_handshake_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  process.env.NODE_ENV = 'test';
  process.env.PORT = String(TEST_PORT);
  process.env.TEST_STORE_FILE = tempStoreFile;

  // Start temporary test server in a background process to avoid blocking the single-threaded Node event loop
  console.log(`[Test Runner] Spawning background test server on dedicated port ${TEST_PORT}...`);
  let serverProcess: any;
  try {
    const tsxBin = path.resolve('node_modules/.bin/tsx');
    const tsxExecutable = process.platform === 'win32' ? `${tsxBin}.cmd` : tsxBin;

    serverProcess = spawn(tsxExecutable, ['server.ts'], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_SERVER: 'true',
        PORT: String(TEST_PORT),
        TEST_STORE_FILE: tempStoreFile,
        TEST_HANDSHAKE_TOKEN: handshakeToken
      },
      stdio: 'pipe'
    });

    let exited = false;
    let exitCode: number | null = null;
    serverProcess.on('exit', (code: number | null) => {
      exited = true;
      exitCode = code;
    });

    // Wait for the background server to start up and reply to health checks with matching handshake token
    let isReady = false;
    const startTime = Date.now();
    while (Date.now() - startTime < 15000) { // 15 seconds timeout
      if (exited) {
        throw new Error(`Test server process exited early with code ${exitCode}. Please verify port ${TEST_PORT} is free!`);
      }
      try {
        const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/health`);
        if (res.ok) {
          const body = await res.json();
          if (body.status === 'ok' && body.testHandshakeToken === handshakeToken) {
            isReady = true;
            break;
          }
        }
      } catch (e) {
        // Ignored, server not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (!isReady) {
      throw new Error(`Test server failed to respond on http://127.0.0.1:${TEST_PORT}/api/health with the correct handshake token within 15 seconds`);
    }
    console.log(`[Test Runner] Temporary test server verified, authenticated, and responsive on port ${TEST_PORT}.`);
  } catch (serverErr) {
    console.error('[Test Runner] FATAL: Failed to start test server:', serverErr);
    if (typeof serverOutput !== 'undefined' && serverOutput) {
      console.error('\n=== TEST SERVER OUTPUT ===\n' + serverOutput + '\n==========================\n');
    }
    if (serverProcess) {
      try { serverProcess.kill(); } catch (_) {}
    }
    try {
      if (fs.existsSync(tempStoreFile)) {
        fs.unlinkSync(tempStoreFile);
      }
    } catch (_) {}
    process.exit(1);
  }

  const cleanupAndExit = (code: number) => {
    if (serverProcess) {
      try {
        console.log('[Test Runner] Terminating background test server process...');
        serverProcess.kill();
      } catch (e) {
        console.error('[Test Runner] Error killing background test server process:', e);
      }
    }

    try {
      if (fs.existsSync(tempStoreFile)) {
        console.log(`[Test Runner] Deleting temporary store file: ${tempStoreFile}`);
        fs.unlinkSync(tempStoreFile);
      }
    } catch (e) {
      console.error('[Test Runner] Error deleting temporary store file:', e);
    }

    const hashAfter = getFileHash(centralStatePath);
    console.log(`[Test Runner] central_app_state.json hash before: ${hashBefore}`);
    console.log(`[Test Runner] central_app_state.json hash after: ${hashAfter}`);
    if (hashBefore !== hashAfter) {
      console.error('❌ FATAL INTEGRITY FAILURE: central_app_state.json was modified during testing!');
      process.exit(1);
    } else {
      console.log('✅ INTEGRITY OK: central_app_state.json remains completely untouched.');
    }

    process.exit(code);
  };

  const executedSet = new Set<string>();
  const passedTests: string[] = [];
  const failedTests: string[] = [];

  const tsxBin = path.resolve('node_modules/.bin/tsx');
  const tsxExecutable = process.platform === 'win32' ? `${tsxBin}.cmd` : tsxBin;

  for (let i = 0; i < discoveredFiles.length; i++) {
    const testFile = discoveredFiles[i];

    if (executedSet.has(testFile)) {
      console.error(`❌ FATAL: Duplicate execution attempted for: ${testFile}`);
      failedTests.push(testFile);
      cleanupAndExit(1);
    }

    console.log(`\n[${i + 1}/${discoveredFiles.length}] Running: ${testFile}`);
    console.log('-'.repeat(60));

    executedSet.add(testFile);

    let result;
    try {
      result = spawnSync(tsxExecutable, [testFile], {
        encoding: 'utf-8',
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'test' },
        timeout: 180000,
      });
    } catch (err) {
      console.error(`❌ Process creation error for ${testFile}:`, err);
      failedTests.push(testFile);
      continue;
    }

    if (result.error) {
      console.error(`❌ Error spawning test process for ${testFile}:`, result.error);
      failedTests.push(testFile);
    } else if (result.signal) {
      console.error(`❌ Test process for ${testFile} killed by signal: ${result.signal}`);
      failedTests.push(testFile);
    } else if (result.status !== 0) {
      console.error(`❌ Test failed with exit code ${result.status}: ${testFile}`);
      failedTests.push(testFile);
    } else {
      console.log(`✅ TEST PASSED: ${testFile}`);
      passedTests.push(testFile);
    }
  }

  const unexecutedTests: string[] = [];
  for (const file of discoveredFiles) {
    if (!executedSet.has(file)) {
      unexecutedTests.push(file);
    }
  }

  const discoveredCount = discoveredFiles.length;
  const executedCount = executedSet.size;
  const passedCount = passedTests.length;
  const failedCount = failedTests.length;
  const unexecutedCount = unexecutedTests.length;

  console.log('\n' + '='.repeat(60));
  console.log('                   TEST RUNNER SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Discovered : ${discoveredCount}`);
  console.log(`Total Executed   : ${executedCount}`);
  console.log(`Total Passed     : ${passedCount}`);
  console.log(`Total Failed     : ${failedCount}`);
  console.log(`Total Unexecuted : ${unexecutedCount}`);
  console.log('='.repeat(60));

  if (failedTests.length > 0) {
    console.log('\n❌ FAILED TESTS:');
    failedTests.forEach((t) => console.log(`  - ${t}`));
  }

  if (unexecutedTests.length > 0) {
    console.log('\n⚠️ UNEXECUTED TESTS:');
    unexecutedTests.forEach((t) => console.log(`  - ${t}`));
  }

  if (discoveredCount !== executedCount) {
    console.error(`❌ INTEGRITY ERROR: Discovered count (${discoveredCount}) !== Executed count (${executedCount})`);
    cleanupAndExit(1);
  }

  if (unexecutedCount > 0) {
    console.error(`❌ INTEGRITY ERROR: ${unexecutedCount} tests were not executed.`);
    cleanupAndExit(1);
  }

  if (failedCount > 0) {
    console.error(`\n❌ TEST RUNNER FAILED: ${failedCount} test(s) failed.`);
    cleanupAndExit(1);
  }

  if (passedCount === discoveredCount && discoveredCount > 0) {
    console.log(`\n🎉 SUCCESS: All ${discoveredCount} test files passed successfully!`);
    cleanupAndExit(0);
  } else {
    console.error('\n❌ TEST RUNNER FAILED: Condition for 100% success not met.');
    cleanupAndExit(1);
  }
}

main().catch(err => {
  console.error('Unhandled runner error:', err);
  process.exit(1);
});
