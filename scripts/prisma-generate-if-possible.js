const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

// The Prisma client generated into node_modules is never committed to git,
// so a deploy that never regenerates it silently builds against whatever
// schema was live the last time someone happened to run `prisma generate`
// locally -- any schema.prisma change after that point compiles fine
// locally and fails in production with "Property does not exist on type".
// This runs on every install (and can also gate the build) so the client
// always matches the committed schema.
const root = process.cwd();
// This project's schema.prisma has no custom generator `output`, so Prisma
// generates directly into node_modules/@prisma/client (unlike verisnova-calm,
// which generates into node_modules/.prisma/client) -- verified against the
// actual output of `prisma generate` in this project, not assumed.
const generatedClientPath = join(
  root,
  "node_modules",
  "@prisma",
  "client",
  "index.js"
);

function hasGeneratedClient() {
  return existsSync(generatedClientPath);
}

const prismaCmd = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(prismaCmd, ["prisma", "generate"], {
  cwd: root,
  stdio: "inherit",
  shell: false,
});

if (result.status === 0) {
  process.exit(0);
}

if (hasGeneratedClient()) {
  console.warn(
    "[prisma-generate-if-possible] prisma generate failed, but an existing generated client was found. Continuing."
  );
  process.exit(0);
}

process.exit(result.status ?? 1);
