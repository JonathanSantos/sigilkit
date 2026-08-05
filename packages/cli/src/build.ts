import {
  computeProject,
  readStoredHash,
  reportFailure,
  summaryOf,
  writeChanged,
  writeStoredHash,
} from "./pipeline";

export function runBuild(projectDir: string): number {
  const result = computeProject(projectDir);
  if (!result.ok) {
    reportFailure(result);
    return 1;
  }

  const cached = readStoredHash(projectDir) === result.hash;
  const written = writeChanged(result.files);
  writeStoredHash(projectDir, result.hash);

  if (written.length === 0) {
    console.log(`sigil: tudo em dia — ${summaryOf(result.ir)}${cached ? " (IR inalterado)" : ""}`);
  } else {
    console.log(`sigil: ${summaryOf(result.ir)} → ${written.join(", ")}`);
  }
  return 0;
}
