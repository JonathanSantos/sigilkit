// Lança o VSCode real (via @vscode/test-electron) e roda suite.js dentro do
// extension host — a camada 5 da §14: cara e lenta, só um caminho feliz.
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");

async function main() {
  await runTests({
    extensionDevelopmentPath: path.resolve(__dirname, ".."),
    extensionTestsPath: path.resolve(__dirname, "suite.js"),
    launchArgs: ["--disable-extensions", "--disable-gpu"],
  });
}

main().catch((err) => {
  console.error("E2E falhou:", err);
  process.exit(1);
});
