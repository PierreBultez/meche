#!/usr/bin/env node
// The version of the application, written in five places that must agree (docs/09, § 4).
//
//   node scripts/version.mjs          # checks that they agree (run by the CI)
//   node scripts/version.mjs 0.4.1    # sets the new version everywhere
//
// tauri.conf.json gives the version shown in Réglages, the name of the packages and the Android
// versionCode; Cargo.toml the one sent to the server in the User-Agent header.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "app");
const TAURI = join(APP, "src-tauri");
const SEMVER = /^\d+\.\d+\.\d+$/;

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

// The `version` line of the [package] table: the first one of the file, before any dependency.
const CARGO_VERSION = /^(version\s*=\s*")([^"]+)(")/m;
// The entry of the app itself in Cargo.lock.
const LOCK_VERSION = /\[\[package\]\]\nname = "meche"\nversion = "([^"]+)"/;

function versions() {
  const lock = readJson(join(APP, "package-lock.json"));
  return {
    "app/package.json": readJson(join(APP, "package.json")).version,
    "app/package-lock.json": lock.version,
    "app/package-lock.json (packages)": lock.packages?.[""]?.version,
    "app/src-tauri/tauri.conf.json": readJson(join(TAURI, "tauri.conf.json")).version,
    "app/src-tauri/Cargo.toml": readFileSync(join(TAURI, "Cargo.toml"), "utf8").match(CARGO_VERSION)?.[2],
    "app/src-tauri/Cargo.lock": readFileSync(join(TAURI, "Cargo.lock"), "utf8").match(LOCK_VERSION)?.[1],
  };
}

function check() {
  const found = versions();
  const distinct = new Set(Object.values(found));
  const [only] = distinct;
  if (distinct.size === 1 && SEMVER.test(only ?? "")) {
    console.log(`Version ${only} everywhere.`);
    return;
  }
  console.error("The version differs from one file to another (docs/09, § 4):");
  for (const [file, version] of Object.entries(found)) console.error(`  ${file}: ${version ?? "missing"}`);
  console.error("Set it with: node scripts/version.mjs <x.y.z>");
  process.exit(1);
}

function set(version) {
  if (!SEMVER.test(version)) {
    console.error(`Not a version of the form x.y.z: ${version}`);
    process.exit(1);
  }
  // npm writes package.json and both fields of package-lock.json, without installing anything.
  execFileSync("npm", ["version", version, "--no-git-tag-version", "--allow-same-version"], { cwd: APP, stdio: "inherit" });

  const confPath = join(TAURI, "tauri.conf.json");
  const conf = readFileSync(confPath, "utf8");
  writeFileSync(confPath, conf.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));

  const cargoPath = join(TAURI, "Cargo.toml");
  writeFileSync(cargoPath, readFileSync(cargoPath, "utf8").replace(CARGO_VERSION, `$1${version}$3`));
  // Cargo writes the new version of the app in Cargo.lock, and changes no dependency.
  execFileSync("cargo", ["update", "--workspace", "--offline"], { cwd: TAURI, stdio: "inherit" });

  check();
}

const [requested] = process.argv.slice(2);
if (requested) set(requested);
else check();
