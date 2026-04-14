#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const cwd = process.cwd();
const releaseDir = resolve(cwd, "release");
const packageJson = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8"));
const windowsReleaseDir = resolve(releaseDir, `v${packageJson.version}`, "windows");
const latestYmlPath = resolve(windowsReleaseDir, "latest.yml");

const config = {
  host: process.env.UPDATE_HOST || "101.200.13.235",
  user: process.env.UPDATE_USER || "root",
  port: process.env.UPDATE_PORT || "22",
  remoteDir: process.env.UPDATE_REMOTE_DIR || "/var/www/xzinfra/updates/stable",
  password: process.env.UPDATE_PASSWORD || "",
};

function run(command, args) {
  console.log(`[upload-update] ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    stdio: "inherit",
    cwd,
    env: process.env,
  });
}

function tclList(values) {
  return values
    .map((value) =>
      `"${String(value)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\$/g, "\\$")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]")}"`
    )
    .join(" ");
}

function runWithPassword(command, args) {
  const commandList = tclList([command, ...args]);
  const password = String(config.password).replace(/\\/g, "\\\\").replace(/\}/g, "\\}");
  const script = `
set timeout -1
set password {${password}}
set cmd [list ${commandList}]
eval spawn $cmd
expect {
  "*assword:" {
    send "$password\\r"
    exp_continue
  }
  eof
}
catch wait result
set exit_code [lindex $result 3]
if {$exit_code != 0} {
  exit $exit_code
}
`;

  console.log(`[upload-update] ${command} ${args.join(" ")}`);
  execFileSync("expect", ["-c", script], {
    stdio: "inherit",
    cwd,
    env: process.env,
  });
}

function runRemote(command, args) {
  if (config.password) {
    runWithPassword(command, args);
    return;
  }
  run(command, args);
}

function parseLatestYml(filePath) {
  const content = readFileSync(filePath, "utf8");
  const urls = [];

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+url:\s+(.+)\s*$/) || line.match(/^\s*url:\s+(.+)\s*$/);
    if (!match) {
      continue;
    }

    const value = match[1].trim().replace(/^['"]|['"]$/g, "");
    if (value) {
      urls.push(value);
    }
  }

  return [...new Set(urls)];
}

function collectArtifacts() {
  if (!existsSync(latestYmlPath)) {
    throw new Error(`latest.yml not found: ${latestYmlPath}`);
  }

  const files = [latestYmlPath];

  for (const url of parseLatestYml(latestYmlPath)) {
    const artifactPath = resolve(windowsReleaseDir, url);
    if (!existsSync(artifactPath)) {
      throw new Error(`artifact referenced by latest.yml not found: ${artifactPath}`);
    }

    files.push(artifactPath);

    const blockmapPath = `${artifactPath}.blockmap`;
    if (existsSync(blockmapPath)) {
      files.push(blockmapPath);
    }
  }

  return [...new Set(files)];
}

function main() {
  const files = collectArtifacts();
  const target = `${config.user}@${config.host}:${config.remoteDir}/`;

  console.log("[upload-update] files to upload:");
  for (const file of files) {
    console.log(`  - ${file}`);
  }

  runRemote("ssh", [
    "-p",
    String(config.port),
    `${config.user}@${config.host}`,
    `mkdir -p '${config.remoteDir}'`,
  ]);

  runRemote("scp", [
    "-P",
    String(config.port),
    ...files,
    target,
  ]);

  console.log(`[upload-update] upload complete -> ${target}`);
}

main();
