process.env.NODE_ENV = 'test';
import {
  normalizeNumberInput,
  calculateBinaryOperation,
  safeEvaluateExpression
} from '../utils/safeCalculator';

async function runTests() {
  console.log("=======================================================");
  console.log("🚀 Running Safe Calculator Unit & Security Tests");
  console.log("=======================================================\n");

  // 1. Integer addition
  {
    const res = calculateBinaryOperation("10", "+", "20");
    if (res !== 30) throw new Error(`Test 1 Failed: Expected 30, got ${res}`);
    console.log("✅ Test 1 Passed: Integer addition");
  }

  // 2. Integer subtraction
  {
    const res = calculateBinaryOperation("50", "-", "18");
    if (res !== 32) throw new Error(`Test 2 Failed: Expected 32, got ${res}`);
    console.log("✅ Test 2 Passed: Integer subtraction");
  }

  // 3. Multiplication with * and ×
  {
    const res1 = calculateBinaryOperation("6", "*", "7");
    const res2 = calculateBinaryOperation("6", "×", "7");
    if (res1 !== 42 || res2 !== 42) throw new Error(`Test 3 Failed: Expected 42, got ${res1}, ${res2}`);
    console.log("✅ Test 3 Passed: Multiplication with * and ×");
  }

  // 4. Division with / and ÷
  {
    const res1 = calculateBinaryOperation("100", "/", "4");
    const res2 = calculateBinaryOperation("100", "÷", "4");
    if (res1 !== 25 || res2 !== 25) throw new Error(`Test 4 Failed: Expected 25, got ${res1}, ${res2}`);
    console.log("✅ Test 4 Passed: Division with / and ÷");
  }

  // 5. Decimal numbers
  {
    const res = calculateBinaryOperation("10.5", "+", "2.25");
    if (res !== 12.75) throw new Error(`Test 5 Failed: Expected 12.75, got ${res}`);
    console.log("✅ Test 5 Passed: Decimal numbers");
  }

  // 6. Negative numbers
  {
    const res1 = calculateBinaryOperation("-10", "+", "5");
    const res2 = calculateBinaryOperation("20", "*", "-3");
    if (res1 !== -5 || res2 !== -60) throw new Error(`Test 6 Failed: Expected -5 and -60, got ${res1}, ${res2}`);
    console.log("✅ Test 6 Passed: Negative numbers");
  }

  // 7. Numbers with thousand separators
  {
    const res = calculateBinaryOperation("1,000,000", "+", "2,500,000");
    if (res !== 3500000) throw new Error(`Test 7 Failed: Expected 3500000, got ${res}`);
    console.log("✅ Test 7 Passed: Numbers with thousand separators");
  }

  // 8. Persian digits
  {
    const res = calculateBinaryOperation("۱۲۵۰", "+", "۷۵۰");
    if (res !== 2000) throw new Error(`Test 8 Failed: Expected 2000, got ${res}`);
    console.log("✅ Test 8 Passed: Persian digits");
  }

  // 9. Arabic digits
  {
    const res = calculateBinaryOperation("١٢٥٠", "+", "٧٥٠");
    if (res !== 2000) throw new Error(`Test 9 Failed: Expected 2000, got ${res}`);
    console.log("✅ Test 9 Passed: Arabic digits");
  }

  // 10. Division by zero
  {
    const res = calculateBinaryOperation("100", "÷", "0");
    if (res !== null) throw new Error(`Test 10 Failed: Division by zero should return null, got ${res}`);
    console.log("✅ Test 10 Passed: Division by zero returns error");
  }

  // 11. Empty input
  {
    const evalRes = safeEvaluateExpression("");
    if (!evalRes.isError || evalRes.result !== 'خطا') {
      throw new Error(`Test 11 Failed: Expected 'خطا', got ${JSON.stringify(evalRes)}`);
    }
    console.log("✅ Test 11 Passed: Empty input returns error");
  }

  // 12. Input with multiple operators
  {
    const evalRes = safeEvaluateExpression("10 + 5 + 2");
    if (!evalRes.isError || evalRes.result !== 'خطا') {
      throw new Error(`Test 12 Failed: Expected 'خطا' for multiple operators, got ${JSON.stringify(evalRes)}`);
    }
    console.log("✅ Test 12 Passed: Input with multiple operators rejected");
  }

  // 13. Input with parentheses
  {
    const evalRes = safeEvaluateExpression("(10 + 5)");
    if (!evalRes.isError || evalRes.result !== 'خطا') {
      throw new Error(`Test 13 Failed: Expected 'خطا' for parentheses, got ${JSON.stringify(evalRes)}`);
    }
    console.log("✅ Test 13 Passed: Input with parentheses rejected");
  }

  // 14. Input with letters
  {
    const evalRes = safeEvaluateExpression("10 + abc");
    if (!evalRes.isError || evalRes.result !== 'خطا') {
      throw new Error(`Test 14 Failed: Expected 'خطا' for letters, got ${JSON.stringify(evalRes)}`);
    }
    console.log("✅ Test 14 Passed: Input with letters rejected");
  }

  // 15. Input with alert or console
  {
    const evalRes1 = safeEvaluateExpression("alert(1)");
    const evalRes2 = safeEvaluateExpression("console.log('test')");
    if (!evalRes1.isError || !evalRes2.isError) {
      throw new Error(`Test 15 Failed: alert/console code was not rejected`);
    }
    console.log("✅ Test 15 Passed: Input with alert or console rejected");
  }

  // 16. Input with constructor or globalThis
  {
    const evalRes1 = safeEvaluateExpression("constructor");
    const evalRes2 = safeEvaluateExpression("globalThis");
    if (!evalRes1.isError || !evalRes2.isError) {
      throw new Error(`Test 16 Failed: constructor/globalThis was not rejected`);
    }
    console.log("✅ Test 16 Passed: Input with constructor or globalThis rejected");
  }

  // 17. Input with code snippet
  {
    const evalRes = safeEvaluateExpression("process.exit(0)");
    if (!evalRes.isError || evalRes.result !== 'خطا') {
      throw new Error(`Test 17 Failed: Code snippet was not rejected`);
    }
    console.log("✅ Test 17 Passed: Input with code snippet rejected");
  }

  // 18. Result NaN
  {
    const res = calculateBinaryOperation(NaN, "+", 5);
    if (res !== null) throw new Error(`Test 18 Failed: NaN input should return null, got ${res}`);
    console.log("✅ Test 18 Passed: NaN input rejected");
  }

  // 19. Result Infinity
  {
    const res = calculateBinaryOperation(Infinity, "+", 5);
    if (res !== null) throw new Error(`Test 19 Failed: Infinity input should return null, got ${res}`);
    console.log("✅ Test 19 Passed: Infinity input rejected");
  }

  // 20. Unknown operator
  {
    const res = calculateBinaryOperation("10", "%", "2");
    if (res !== null) throw new Error(`Test 20 Failed: Unknown operator should return null, got ${res}`);
    console.log("✅ Test 20 Passed: Unknown operator rejected");
  }

  // 21. Ensuring no injected code is executed
  {
    let codeExecuted = false;
    (globalThis as any).__test_injection_flag__ = () => { codeExecuted = true; };
    safeEvaluateExpression("1 + globalThis.__test_injection_flag__()");
    if (codeExecuted) {
      throw new Error("Test 21 Failed: Injected code was executed!");
    }
    delete (globalThis as any).__test_injection_flag__;
    console.log("✅ Test 21 Passed: Injected code execution prevented");
  }

  // 22. Verifying 'خطا' behavior in safeEvaluateExpression for invalid input
  {
    const evalRes = safeEvaluateExpression("10 / 0");
    if (!evalRes.isError || evalRes.result !== 'خطا') {
      throw new Error(`Test 22 Failed: Division by zero must yield 'خطا'`);
    }
    console.log("✅ Test 22 Passed: Verified 'خطا' result for invalid operation");
  }

  // 23. Verifying equation cleared simulation after result or error
  {
    const evalValid = safeEvaluateExpression("10 + 20");
    const evalInvalid = safeEvaluateExpression("10 / 0");
    if (evalValid.result !== '30' || evalInvalid.result !== 'خطا') {
      throw new Error("Test 23 Failed: Evaluator results mismatch");
    }
    console.log("✅ Test 23 Passed: Verified valid result format and error clearing contract");
  }

  console.log("\n=======================================================");
  console.log("🎉 ALL SAFE CALCULATOR UNIT & SECURITY TESTS PASSED!");
  console.log("=======================================================\n");
}

runTests().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("❌ Test Suite Error:", err);
  process.exit(1);
});
