#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const cwd = process.cwd();
const releaseDir = resolve(cwd, 'release');
const packageJson = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
const version = packageJson.version;
const versionDir = resolve(releaseDir, `v${version}`);
const windowsReleaseDir = resolve(versionDir, 'windows');
const macReleaseDir = resolve(versionDir, 'mac');

const config = {
  host: process.env.UPDATE_HOST || '101.200.13.235',
  user: process.env.UPDATE_USER || 'root',
  port: process.env.UPDATE_PORT || '22',
  remoteDir: process.env.UPDATE_PORTABLE_REMOTE_DIR || '/var/www/xzinfra/updates-portable/stable',
  baseUrl: process.env.UPDATE_PORTABLE_BASE_URL || 'https://clawclaw.xzinfra.com/updates-portable/stable',
  password: process.env.UPDATE_PASSWORD || '',
  minimumAppVersion: process.env.PORTABLE_MINIMUM_APP_VERSION || version,
  layoutVersion: Number.parseInt(process.env.PORTABLE_LAYOUT_VERSION || '2', 10),
  releaseDate: process.env.PORTABLE_RELEASE_DATE || new Date().toISOString(),
  notes: process.env.PORTABLE_RELEASE_NOTES || '',
};

const PORTABLE_TARGETS = [
  {
    target: 'win32-x64',
    artifactPath: resolve(windowsReleaseDir, 'win-unpacked.zip'),
  },
  {
    target: 'win32-arm64',
    artifactPath: resolve(windowsReleaseDir, 'win-arm64-unpacked.zip'),
  },
  {
    target: 'darwin-x64',
    artifactPath: resolve(macReleaseDir, `ClawClaw-v${version}-mac-x64-portable.zip`),
  },
  {
    target: 'darwin-arm64',
    artifactPath: resolve(macReleaseDir, `ClawClaw-v${version}-mac-arm64-portable.zip`),
  },
];

function run(command, args) {
  console.log(`[upload-portable-update] ${command} ${args.join(' ')}`);
  execFileSync(command, args, {
    stdio: 'inherit',
    cwd,
    env: process.env,
  });
}

function tclList(values) {
  return values
    .map((value) =>
      `"${String(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')}"`
    )
    .join(' ');
}

function runWithPassword(command, args) {
  const commandList = tclList([command, ...args]);
  const password = String(config.password).replace(/\\/g, '\\\\').replace(/\}/g, '\\}');
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

  console.log(`[upload-portable-update] ${command} ${args.join(' ')}`);
  execFileSync('expect', ['-c', script], {
    stdio: 'inherit',
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

function toBase64Sha512(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha512').update(content).digest('base64');
}

function collectPortableTargets() {
  const found = [];
  for (const entry of PORTABLE_TARGETS) {
    if (!existsSync(entry.artifactPath)) {
      console.warn(`[upload-portable-update] Skipping missing portable artifact for ${entry.target}: ${entry.artifactPath}`);
      continue;
    }
    found.push({
      ...entry,
      size: statSync(entry.artifactPath).size,
      sha512: toBase64Sha512(entry.artifactPath),
    });
  }

  if (found.length === 0) {
    throw new Error('No portable artifacts found to upload.');
  }

  return found;
}

function buildManifest(entry) {
  return {
    version,
    releaseDate: config.releaseDate,
    layoutVersion: config.layoutVersion,
    minimumAppVersion: config.minimumAppVersion,
    artifact: {
      url: `${config.baseUrl}/${basename(entry.artifactPath)}`,
      sha512: entry.sha512,
      size: entry.size,
    },
    ...(config.notes ? { notes: config.notes } : {}),
  };
}

function main() {
  const portableTargets = collectPortableTargets();
  const tempDir = mkdtempSync(join(tmpdir(), 'clawclaw-portable-update-'));

  try {
    const uploadFiles = [];
    for (const entry of portableTargets) {
      const manifestPath = resolve(tempDir, `${entry.target}.json`);
      writeFileSync(manifestPath, `${JSON.stringify(buildManifest(entry), null, 2)}\n`, 'utf8');
      uploadFiles.push(entry.artifactPath, manifestPath);
    }

    const target = `${config.user}@${config.host}:${config.remoteDir}/`;

    console.log('[upload-portable-update] files to upload:');
    for (const file of uploadFiles) {
      console.log(`  - ${file}`);
    }

    runRemote('ssh', [
      '-p',
      String(config.port),
      `${config.user}@${config.host}`,
      `mkdir -p '${config.remoteDir}'`,
    ]);

    runRemote('scp', [
      '-P',
      String(config.port),
      ...uploadFiles,
      target,
    ]);

    console.log(`[upload-portable-update] upload complete -> ${target}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
