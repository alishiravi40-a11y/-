import { User, Person, AppState } from '../types';

export const resolveUserPersonLink = (user: User, persons: Person[]): Person | undefined => {
  // 1. Try resolving by personId first
  if (user.personId) {
    const personById = persons.find(p => p.id === user.personId);
    if (personById) return personById;
  }

  // 2. Fallback: Name matching
  return persons.find(p => p.name === user.name);
};
