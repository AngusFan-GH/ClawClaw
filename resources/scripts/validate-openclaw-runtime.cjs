#!/usr/bin/env node

const { existsSync } = require('fs');
const { join, resolve } = require('path');
const { createRequire } = require('module');

async function main() {
  const openclawDirArg = process.argv[2];
  const openclawDir = openclawDirArg ? resolve(openclawDirArg) : undefined;
  if (!openclawDir) {
    throw new Error('Missing OpenClaw directory argument.');
  }

  const pkgJsonPath = join(openclawDir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    throw new Error(`OpenClaw package is missing: ${pkgJsonPath}`);
  }

  const openclawRequire = createRequire(pkgJsonPath);

  const hostedGitInfo = openclawRequire('hosted-git-info');
  if (typeof hostedGitInfo?.fromUrl !== 'function') {
    throw new Error('hosted-git-info runtime check failed.');
  }

  const minimatchModule = openclawRequire('minimatch');
  const minimatch =
    minimatchModule?.minimatch ||
    minimatchModule?.default?.minimatch ||
    minimatchModule?.default ||
    minimatchModule;
  if (typeof minimatch !== 'function') {
    throw new Error('minimatch runtime check failed.');
  }

  const globModule = openclawRequire('glob');
  const glob = globModule?.glob || globModule?.default?.glob || globModule?.default || globModule;
  if (typeof glob !== 'function') {
    throw new Error('glob runtime check failed.');
  }

  process.stdout.write('ok\n');
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
