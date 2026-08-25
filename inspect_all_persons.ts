import fs from 'fs';
const state = JSON.parse(fs.readFileSync('central_app_state.json', 'utf8'));
state.persons.forEach((p: any) => {
  console.log(p.id, p.name, p.code);
});
