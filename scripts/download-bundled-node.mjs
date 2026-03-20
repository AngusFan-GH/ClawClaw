#!/usr/bin/env zx

import 'zx/globals';

const ROOT_DIR = path.resolve(__dirname, '..');
const NODE_VERSION = process.env.BUNDLED_NODE_VERSION || process.versions.node;
const BASE_URL = `https://nodejs.org/dist/v${NODE_VERSION}`;
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');
const MAX_DOWNLOAD_ATTEMPTS = 3;

const TARGETS = {
  'win32-x64': {
    filename: `node-v${NODE_VERSION}-win-x64.zip`,
    binName: 'node.exe',
  },
  'win32-arm64': {
    filename: `node-v${NODE_VERSION}-win-arm64.zip`,
    binName: 'node.exe',
  },
};

async function setupTarget(id) {
  const target = TARGETS[id];
  if (!target) {
    echo(chalk.yellow`⚠️ Target ${id} is not supported by this script.`);
    return;
  }

  const targetDir = path.join(OUTPUT_BASE, id);
  const tempDir = path.join(ROOT_DIR, 'temp_node_extract');
  const archivePath = path.join(ROOT_DIR, target.filename);
  const downloadUrl = `${BASE_URL}/${target.filename}`;

  echo(chalk.blue`\n📦 Setting up bundled Node.js for ${id}...`);

  await fs.remove(tempDir);
  await fs.ensureDir(targetDir);
  await fs.ensureDir(tempDir);

  try {
    echo`⬇️ Downloading: ${downloadUrl}`;
    await downloadWithRetry(downloadUrl, archivePath);

    echo`📂 Extracting...`;
    if (os.platform() === 'win32') {
      const { execFileSync } = await import('child_process');
      const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${archivePath.replace(/'/g, "''")}', '${tempDir.replace(/'/g, "''")}')`;
      execFileSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'inherit' });
    } else {
      await $`unzip -q -o ${archivePath} -d ${tempDir}`;
    }

    const files = await glob(`**/${target.binName}`, { cwd: tempDir, absolute: true });
    if (files.length === 0) {
      throw new Error(`Could not find ${target.binName} in extracted files.`);
    }

    const destBin = path.join(targetDir, target.binName);
    await fs.move(files[0], destBin, { overwrite: true });
    echo(chalk.green`✅ Success: ${destBin}`);
  } finally {
    await fs.remove(archivePath);
    await fs.remove(tempDir);
  }
}

async function downloadWithRetry(downloadUrl, outputPath) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      await $`curl --fail --location --silent --show-error ${downloadUrl} --output ${outputPath}`;
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_DOWNLOAD_ATTEMPTS) {
        echo(chalk.yellow(`⚠️ Download attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS} failed: ${message}`));
        echo(chalk.yellow('↻ Retrying download...'));
      }
    }
  }

  throw lastError ?? new Error(`Failed to download ${downloadUrl}`);
}

const downloadAll = argv.all;
const platform = argv.platform;

if (downloadAll) {
  for (const id of Object.keys(TARGETS)) {
    await setupTarget(id);
  }
} else if (platform) {
  if (platform !== 'win') {
    echo(chalk.red`❌ Unknown platform: ${platform}`);
    echo('Available platforms: win');
    process.exit(1);
  }

  await setupTarget('win32-x64');
  await setupTarget('win32-arm64');
} else {
  const currentId = `${os.platform()}-${os.arch()}`;
  if (!TARGETS[currentId]) {
    echo(chalk.red`❌ Current system ${currentId} is not supported by this script.`);
    echo('Supported targets: win32-x64, win32-arm64');
    process.exit(1);
  }

  await setupTarget(currentId);
}

echo(chalk.green`\n🎉 Done!`);
