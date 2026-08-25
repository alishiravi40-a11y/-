import fs from 'fs';
const state = JSON.parse(fs.readFileSync('central_app_state.json', 'utf8'));
const persons = state.persons.filter((p: any) => p.name && p.name.includes('باقالی'));
console.log(JSON.stringify(persons, null, 2));
