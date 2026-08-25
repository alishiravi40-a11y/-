import { Person } from '../types';

export function generateUniquePersonCode(persons: Person[]): string {
  let nextNum = persons.length + 1;
  let generatedCode = `P${1000 + nextNum}`;
  while (persons.some(p => p.code === generatedCode)) {
    nextNum++;
    generatedCode = `P${1000 + nextNum}`;
  }
  return generatedCode;
}
