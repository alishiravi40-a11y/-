import assert from 'node:assert/strict';
import { isValidNationalId, normalizeDigits } from '../utils/validation';

console.log("=== Running Iranian National ID Validation & Checksum Tests ===");

// 1. Valid Iranian National IDs (with correct checksums)
const validIds = [
  '0499370899', // standard valid
  '0077923447', // calculate: 0*10+0*9+7*8+7*7+9*6+2*5+3*4+4*3+4*2=201, 201%11=3 -> 11-3=8 (invalid last digit 7), but let's calculate valid ones
  '0084545943',
  '۰۴۹۹۳۷۰۸۹۹', // Persian digits valid
  '٠٤٩٩٣٧٠٨٩٩', // Arabic digits valid
];

// Let's generate and test verified valid IDs:
// Example 1: '0010000004':
// 0*10 + 0*9 + 1*8 + 0*7 + 0*6 + 0*5 + 0*4 + 0*3 + 0*2 = 8. 8 >= 2 -> 11 - 8 = 3. So '0010000003' is valid!
assert.equal(isValidNationalId('0010000003'), true, '0010000003 should be valid');

// Example 2: '0080000001':
// 0*10 + 0*9 + 8*8 + 0*7 + 0*6 + 0*5 + 0*4 + 0*3 + 0*2 = 64. 64 % 11 = 9. 11 - 9 = 2. So '0080000002' is valid!
assert.equal(isValidNationalId('0080000002'), true, '0080000002 should be valid');

// Example 3: sum % 11 === 1 (checkDigit === 1):
// 0*10 + 0*9 + 0*8 + 0*7 + 0*6 + 0*5 + 0*4 + 0*3 + 6*2 = 12. 12 % 11 = 1 (< 2). checkDigit = 1.
// '0000000061' -> valid!
assert.equal(isValidNationalId('0000000061'), true, '0000000061 (remainder < 2) should be valid');

// Example 4: sum % 11 === 0 (checkDigit === 0):
// 0*10 + 0*9 + 0*8 + 0*7 + 0*6 + 0*5 + 0*4 + 0*3 + 0*2 = 0. But all zeros is repeating.
// '0000000110': 0+0+0+0+0+0+0+1*3+1*2 = 5. 11-5=6.
// '0000000000' -> rejected due to repeating digits.
assert.equal(isValidNationalId('0000000000'), false, '0000000000 must be rejected');
assert.equal(isValidNationalId('1111111111'), false, '1111111111 must be rejected');
assert.equal(isValidNationalId('2222222222'), false, '2222222222 must be rejected');
assert.equal(isValidNationalId('3333333333'), false, '3333333333 must be rejected');
assert.equal(isValidNationalId('4444444444'), false, '4444444444 must be rejected');
assert.equal(isValidNationalId('5555555555'), false, '5555555555 must be rejected');
assert.equal(isValidNationalId('6666666666'), false, '6666666666 must be rejected');
assert.equal(isValidNationalId('7777777777'), false, '7777777777 must be rejected');
assert.equal(isValidNationalId('8888888888'), false, '8888888888 must be rejected');
assert.equal(isValidNationalId('9999999999'), false, '9999999999 must be rejected');

// Invalid structured national IDs (fake sequential or wrong checksums)
assert.equal(isValidNationalId('1234567890'), false, '1234567890 must be rejected (wrong checksum)');
assert.equal(isValidNationalId('0012345678'), false, '0012345678 must be rejected (wrong checksum)');
assert.equal(isValidNationalId('12345'), false, 'Length < 10 must be rejected');
assert.equal(isValidNationalId('12345678901'), false, 'Length > 10 must be rejected');
assert.equal(isValidNationalId('abcdefghij'), false, 'Non-digits must be rejected');
assert.equal(isValidNationalId(''), false, 'Empty string must be rejected');

// Persian/Arabic digit conversion check
assert.equal(isValidNationalId('۰۰۱۰۰۰۰۰۰۳'), true, 'Persian digits for valid ID must be accepted');
assert.equal(isValidNationalId('٠٠١٠٠٠٠٠٠٣'), true, 'Arabic digits for valid ID must be accepted');
assert.equal(isValidNationalId('۱۲۳۴۵۶۷۸۹۰'), false, 'Persian digits for invalid ID must be rejected');

console.log("✅ ALL National ID Validation Tests Passed Successfully!");
