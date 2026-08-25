/**
 * Safe Calculator Utility
 * Performs strict binary arithmetic without using eval, Function, or code execution.
 */

/**
 * Normalizes numeric inputs:
 * - Trims whitespace
 * - Converts Persian (۰-۹) and Arabic (٠-٩) digits to Latin digits
 * - Removes English (,), Persian (٬) / (،) thousand separators
 * - Validates integer or decimal format
 * - Rejects NaN, Infinity, text, identifiers, parentheses, etc.
 */
export function normalizeNumberInput(input: string | number): number | null {
  if (typeof input === 'number') {
    if (isNaN(input) || !isFinite(input)) return null;
    return input;
  }

  if (typeof input !== 'string') return null;

  let str = input.trim();
  if (!str) return null;

  // Convert Persian digits (۰-۹) to ASCII (0-9)
  str = str.replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1776 + 48));
  // Convert Arabic digits (٠-٩) to ASCII (0-9)
  str = str.replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1632 + 48));

  // Remove thousand separators (English comma, Persian separators ٬ and ،)
  str = str.replace(/[,٬،]/g, '');

  // Validate strict number format: optional leading sign, digits, optional decimal point with digits
  if (!/^[+-]?\d+(\.\d+)?$/.test(str)) {
    return null;
  }

  const num = Number(str);
  if (isNaN(num) || !isFinite(num)) {
    return null;
  }

  return num;
}

/**
 * Calculates a binary math operation for allowed operators (+, -, *, /, ×, ÷)
 * Uses strict switch dispatch without code evaluation.
 */
export function calculateBinaryOperation(
  operand1: string | number,
  operator: string,
  operand2: string | number
): number | null {
  const num1 = normalizeNumberInput(operand1);
  const num2 = normalizeNumberInput(operand2);

  if (num1 === null || num2 === null) {
    return null;
  }

  if (typeof operator !== 'string') return null;
  const cleanOp = operator.trim();

  let result: number;
  switch (cleanOp) {
    case '+':
      result = num1 + num2;
      break;
    case '-':
      result = num1 - num2;
      break;
    case '*':
    case '×':
      result = num1 * num2;
      break;
    case '/':
    case '÷':
      if (num2 === 0) {
        return null; // Division by zero returns error
      }
      result = num1 / num2;
      break;
    default:
      return null; // Unknown operator
  }

  if (isNaN(result) || !isFinite(result)) {
    return null;
  }

  return result;
}

/**
 * Evaluates a binary calculator expression e.g. "10 + 5", "1,000 × 20", "۱۰ ÷ ۲"
 * Returns { result: string, isError: boolean }
 */
export function safeEvaluateExpression(expression: string): { result: string; isError: boolean } {
  if (!expression || typeof expression !== 'string') {
    return { result: 'خطا', isError: true };
  }

  const str = expression.trim();
  if (!str) {
    return { result: 'خطا', isError: true };
  }

  // Parse expression into [operand1, operator, operand2]
  // Search for binary operator (+, -, *, /, ×, ÷) that is not a leading sign on operand1
  let searchStr = str;
  let offset = 0;
  if (str.startsWith('-') || str.startsWith('+')) {
    searchStr = str.slice(1);
    offset = 1;
  }

  const match = searchStr.match(/^(.*?)\s*([+\-*\/×÷])\s*(.*)$/);
  if (!match) {
    return { result: 'خطا', isError: true };
  }

  const rawOp1 = str.slice(0, offset + match[1].length).trim();
  const operator = match[2];
  const rawOp2 = match[3].trim();

  if (!rawOp1 || !rawOp2) {
    return { result: 'خطا', isError: true };
  }

  const res = calculateBinaryOperation(rawOp1, operator, rawOp2);
  if (res === null) {
    return { result: 'خطا', isError: true };
  }

  return { result: String(res), isError: false };
}
