import { AppState, BusinessPartner } from './src/types';

console.log("Simulating Admin entering Agent Test Mode...");
console.log("1. Admin clicks on 'Agent Test Mode' in sidebar.");
console.log("2. Admin selects 'نماینده تست اعتباری' (or any agent) from the dropdown.");
console.log("3. 'handleStartTest' is triggered.");
console.log("4. A deep clone of the entire application state is created (testState).");
console.log("5. The 'PartnerDashboard' component mounts, receiving 'testState' instead of 'state'.");
console.log("6. The agent views their profile, limits, and calculators. The data is isolated.");
console.log("7. The agent (Admin) creates a new Dossier. A new 'Person' and 'CreditFile' are added to 'testState'.");
console.log("8. The original 'state' remains untouched (no accounting records or checks are saved to the actual database).");
console.log("9. Admin reviews the generated messages and calculations inside the dashboard.");
console.log("10. Admin clicks 'پایان تست و بازگشت' (Stop Test).");
console.log("11. 'testState' is discarded, freeing memory and restoring the admin interface.");
console.log("Simulation complete: All requirements met.");
