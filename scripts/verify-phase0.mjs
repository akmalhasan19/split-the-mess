import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`
  );
}

const requiredFiles = [
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "postcss.config.mjs",
  "eslint.config.mjs",
  ".prettierrc.json",
  ".env.example",
  ".gitignore",
  "app/layout.tsx",
  "app/page.tsx",
  "app/globals.css",
  "app/api/health/route.ts",
  "app/api/supabase-check/route.ts",
  "app/api/storage-check/route.ts",
  "app/s/[token]/page.tsx",
  "lib/utils.ts",
  "lib/split-engine/index.ts",
  "lib/whatsapp/index.ts",
  "lib/supabase/client.ts",
  "lib/supabase/server.ts",
  "components/ui/button.tsx",
  "components/ui/card.tsx",
  "components/ui/input.tsx",
  "supabase/migrations/0000_phase0_placeholder.sql",
  "supabase/README.md",
];

for (const f of requiredFiles) {
  check(`file:${f}`, existsSync(`${root}/${f}`));
}

try {
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
  check("pkg:name", pkg.name === "split-the-mess", pkg.name);
  for (const dep of [
    "next",
    "react",
    "@supabase/supabase-js",
    "@supabase/ssr",
    "nanoid",
  ]) {
    check(
      `pkg:dep:${dep}`,
      Boolean(pkg.dependencies?.[dep]),
      pkg.dependencies?.[dep] ?? "missing"
    );
  }
  check("pkg:devDep:tailwindcss", Boolean(pkg.devDependencies?.tailwindcss));
  check("pkg:script:dev", pkg.scripts?.dev === "next dev");
  check("pkg:script:build", pkg.scripts?.build === "next build");
} catch (e) {
  check("pkg:parse", false, String(e));
}

async function run(cmd, args, timeout = 60000) {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout, cwd: root });
    return { ok: true, out: stdout.slice(0, 500) };
  } catch (e) {
    return { ok: false, out: (e.stdout ?? "") + (e.stderr ?? e.message ?? "") };
  }
}

// tsc
{
  const r = await run(process.execPath, [
    "node_modules/typescript/bin/tsc",
    "--noEmit",
  ]);
  check("verify:tsc", r.ok, r.ok ? "no errors" : r.out.slice(0, 400));
}
// prettier
{
  const r = await run(process.execPath, [
    "node_modules/prettier/bin/prettier.cjs",
    "--check",
    "app",
    "lib",
    "components",
    "supabase",
    "package.json",
  ]);
  check("verify:prettier", r.ok, r.ok ? "clean" : r.out.slice(0, 300));
}
// eslint (subset cepat agar tidak timeout di Windows)
{
  const r = await run(
    process.execPath,
    [
      "node_modules/eslint/bin/eslint.js",
      "app/api/health/route.ts",
      "lib/utils.ts",
    ],
    45000
  );
  check(
    "verify:eslint(sample)",
    r.ok,
    r.ok ? "no errors" : r.out.slice(0, 400)
  );
}
// build artifact
check(
  "verify:build-artifact",
  existsSync(`${root}/.next/BUILD_ID`),
  ".next/BUILD_ID ada = build sukses"
);

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed.`
);
if (failed.length) {
  console.log("Failed:", failed.map((f) => f.name).join(", "));
  process.exit(1);
}
