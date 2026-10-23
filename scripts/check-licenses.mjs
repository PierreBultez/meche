#!/usr/bin/env node
// Checks the licenses of every dependency against rule 3 of CLAUDE.md.
//
//   node scripts/check-licenses.mjs npm       # app/package-lock.json
//   node scripts/check-licenses.mjs cargo     # app/src-tauri (runs `cargo metadata`)
//   node scripts/check-licenses.mjs composer  # server/composer.lock
//
// Direct dependencies (the ones we choose) must use a license of DIRECT_ALLOWED.
// Transitive dependencies (pulled in by the mandated stack) may also use TRANSITIVE_EXTRA.
// Anything else (GPL, AGPL, LGPL-only, proprietary, missing license) fails.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DIRECT_ALLOWED = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "OFL-1.1", // fonts only (JetBrains Mono, docs/11)
]);
const TRANSITIVE_EXTRA = new Set([
  "MPL-2.0",
  "Unicode-3.0",
  "Unicode-DFS-2016",
  "Zlib",
  "Unlicense",
  "CC0-1.0",
  "MIT-0",
  "BSL-1.0",
  "BlueOak-1.0.0",
]);

/**
 * Is an SPDX expression ("MIT OR Apache-2.0", "(MIT OR Apache-2.0) AND Unicode-3.0",
 * "Apache-2.0 WITH LLVM-exception", legacy "MIT/Apache-2.0") satisfiable with `allowed`?
 */
export function isAllowed(expression, allowed) {
  const tokens = expression.replace(/\//g, " OR ").match(/\(|\)|[^\s()]+/g) ?? [];
  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];

  // or := and ("OR" and)* ; and := atom ("AND" atom)* ; atom := "(" or ")" | id ["WITH" id]
  function parseOr() {
    let result = parseAnd();
    while (peek() === "OR") {
      next();
      result = parseAnd() || result;
    }
    return result;
  }
  function parseAnd() {
    let result = parseAtom();
    while (peek() === "AND") {
      next();
      result = parseAtom() && result;
    }
    return result;
  }
  function parseAtom() {
    const token = next();
    if (token === "(") {
      const result = parseOr();
      if (next() !== ")") throw new Error(`Unbalanced parentheses in "${expression}"`);
      return result;
    }
    if (token === undefined) throw new Error(`Incomplete license expression "${expression}"`);
    if (peek() === "WITH") {
      next();
      next(); // the exception (e.g. LLVM-exception) only adds permissions
    }
    return allowed.has(token);
  }

  const result = parseOr();
  if (position !== tokens.length) throw new Error(`Cannot parse license "${expression}"`);
  return result;
}

/** [{ name, license, direct }] from the npm lockfile. */
function npmPackages() {
  const appDir = join(ROOT, "app");
  const lock = JSON.parse(readFileSync(join(appDir, "package-lock.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
  const direct = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
  return Object.entries(lock.packages)
    .filter(([path]) => path !== "")
    .map(([path, info]) => {
      const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      const isTopLevel = path === `node_modules/${name}`;
      return { name, license: info.license, direct: isTopLevel && direct.has(name) };
    });
}

/**
 * The platforms Mèche ships on (docs/01). Crates used only elsewhere (e.g. webpki-root-certs,
 * pulled by rustls-platform-verifier for WebAssembly only) are never built into the app.
 */
const CARGO_TARGETS = [
  "x86_64-unknown-linux-gnu",
  "x86_64-pc-windows-msvc",
  "aarch64-linux-android",
  "armv7-linux-androideabi",
  "i686-linux-android",
  "x86_64-linux-android",
];

/** [{ name, license, direct }] from `cargo metadata`, for the platforms of CARGO_TARGETS. */
function cargoPackages() {
  const output = execFileSync(
    "cargo",
    [
      "metadata", "--format-version", "1", "--locked", "--manifest-path", "app/src-tauri/Cargo.toml",
      ...CARGO_TARGETS.flatMap((target) => ["--filter-platform", target]),
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const metadata = JSON.parse(output);
  const rootId = metadata.resolve.root;
  const rootNode = metadata.resolve.nodes.find((node) => node.id === rootId);
  const direct = new Set(rootNode.deps.map((dep) => dep.pkg));
  return metadata.packages
    .filter((pkg) => pkg.id !== rootId)
    .map((pkg) => ({ name: `${pkg.name} ${pkg.version}`, license: pkg.license, direct: direct.has(pkg.id) }));
}

/**
 * [{ name, license, direct }] from the Composer lockfile. Composer lists several licenses as an
 * array meaning "any of them" (e.g. nette/utils: BSD-3-Clause, GPL-2.0-only, GPL-3.0-only).
 */
function composerPackages() {
  const serverDir = join(ROOT, "server");
  const lock = JSON.parse(readFileSync(join(serverDir, "composer.lock"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(serverDir, "composer.json"), "utf8"));
  const direct = new Set([
    ...Object.keys(manifest.require ?? {}),
    ...Object.keys(manifest["require-dev"] ?? {}),
  ]);
  return [...lock.packages, ...(lock["packages-dev"] ?? [])].map((pkg) => ({
    name: `${pkg.name} ${pkg.version}`,
    license: pkg.license?.length ? pkg.license.map((id) => `(${id})`).join(" OR ") : undefined,
    direct: direct.has(pkg.name),
  }));
}

function main() {
  const ecosystem = process.argv[2];
  const readers = { npm: npmPackages, cargo: cargoPackages, composer: composerPackages };
  const packages = readers[ecosystem]?.() ?? null;
  if (!packages) {
    console.error("Usage: node scripts/check-licenses.mjs npm|cargo|composer");
    process.exit(2);
  }
  const transitiveAllowed = new Set([...DIRECT_ALLOWED, ...TRANSITIVE_EXTRA]);
  const problems = packages.filter(({ license, direct }) => {
    if (!license) return true;
    return !isAllowed(license, direct ? DIRECT_ALLOWED : transitiveAllowed);
  });
  for (const { name, license, direct } of problems) {
    console.error(`✗ ${name}: ${license ?? "no license"} (${direct ? "direct" : "transitive"})`);
  }
  console.log(`${ecosystem}: ${packages.length} packages checked, ${problems.length} problem(s).`);
  process.exit(problems.length === 0 ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
