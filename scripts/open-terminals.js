const { exec } = require("child_process");
const path = require("path");

console.log("Opening development terminals...");

// Function to open terminal in specific directory
function openTerminal(directory, title) {
  const fullPath = path.resolve(directory);

  // For VS Code integrated terminal, we'll use the terminal API
  console.log(`Opening terminal in: ${fullPath}`);
  console.log(`Title: ${title}`);

  // This will be executed in the VS Code terminal
  return `cd "${fullPath}" && echo "=== ${title} Terminal ===" && pwd`;
}

// Commands to run in separate terminals
const commands = [
  openTerminal("portal-production", "Portal Production"),
  openTerminal("api-server-production", "API Server"),
  openTerminal(".", "Root"),
];

console.log("\n=== Terminal Commands ===");
commands.forEach((cmd, index) => {
  console.log(`\nTerminal ${index + 1}:`);
  console.log(cmd);
});

console.log("\n=== Manual Instructions ===");
console.log("1. Press Ctrl+Shift+` to open a new terminal");
console.log("2. Press Ctrl+Shift+5 to split the terminal");
console.log("3. Run the commands above in each terminal");
console.log("\nOr use the shell script: ./open-terminals.sh");
