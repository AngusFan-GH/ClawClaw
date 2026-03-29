#!/usr/bin/env node

const { existsSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const openclawDir = process.argv[2];
  if (!openclawDir) {
    throw new Error('Missing OpenClaw directory argument.');
  }

  const pkgJsonPath = join(openclawDir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    throw new Error(`OpenClaw package is missing: ${pkgJsonPath}`);
  }

  const hostedGitInfoPath = join(openclawDir, 'node_modules', 'hosted-git-info', 'lib', 'index.js');
  const minimatchEsmPath = join(openclawDir, 'node_modules', 'minimatch', 'dist', 'esm', 'index.js');
  const globEsmPath = join(openclawDir, 'node_modules', 'glob', 'dist', 'esm', 'index.js');

  const hostedGitInfo = require(hostedGitInfoPath);
  if (typeof hostedGitInfo?.fromUrl !== 'function') {
    throw new Error('hosted-git-info runtime check failed.');
  }

  const minimatchModule = await import(pathToFileURL(minimatchEsmPath).href);
  if (typeof minimatchModule?.minimatch !== 'function') {
    throw new Error('minimatch ESM runtime check failed.');
  }

  const globModule = await import(pathToFileURL(globEsmPath).href);
  if (typeof globModule?.glob !== 'function') {
    throw new Error('glob ESM runtime check failed.');
  }

  process.stdout.write('ok\n');
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
