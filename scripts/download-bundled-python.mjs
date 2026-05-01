#!/usr/bin/env zx

import 'zx/globals';

const ROOT_DIR = path.resolve(__dirname, '..');
const PYTHON_VERSION = '3.12.13';
const PYTHON_BUILD_RELEASE = '20260408';
const BASE_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_BUILD_RELEASE}`;
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'python');
const MAX_DOWNLOAD_ATTEMPTS = 3;

const TARGETS = {
  'win32-x64': {
    triple: 'x86_64-pc-windows-msvc',
  },
  'win32-arm64': {
    triple: 'aarch64-pc-windows-msvc',
  },
};

const PLATFORM_GROUPS = {
  win: ['win32-x64', 'win32-arm64'],
};

function getTargetFilename(target) {
  return `cpython-${PYTHON_VERSION}+${PYTHON_BUILD_RELEASE}-${target.triple}-install_only_stripped.tar.gz`;
}

async function setupTarget(id) {
  const target = TARGETS[id];
  if (!target) {
    echo(chalk.yellow`⚠️ Target ${id} is not supported by this script.`);
    return;
  }

  const filename = getTargetFilename(target);
  const targetDir = path.join(OUTPUT_BASE, id);
  const tempDir = path.join(ROOT_DIR, 'temp_python_extract');
  const archivePath = path.join(ROOT_DIR, filename);
  const downloadUrl = `${BASE_URL}/${encodeURIComponent(filename)}`;
  const pythonExe = path.join(targetDir, 'python.exe');

  echo(chalk.blue`\n📦 Setting up Python ${PYTHON_VERSION} for ${id}...`);

  if (!argv.force && await fs.pathExists(pythonExe)) {
    echo(chalk.green`✅ Already present: ${pythonExe}`);
    return;
  }

  await fs.remove(tempDir);
  await fs.remove(targetDir);
  await fs.ensureDir(targetDir);
  await fs.ensureDir(tempDir);

  try {
    echo`⬇️ Downloading: ${downloadUrl}`;
    await downloadWithRetry(downloadUrl, archivePath);

    echo`📂 Extracting...`;
    await $`tar -xzf ${archivePath} -C ${tempDir}`;

    const extractedPythonDir = path.join(tempDir, 'python');
    const sourceDir = await fs.pathExists(extractedPythonDir)
      ? extractedPythonDir
      : await findPythonRoot(tempDir);

    await fs.copy(sourceDir, targetDir, { overwrite: true });

    if (!await fs.pathExists(pythonExe)) {
      throw new Error(`Bundled Python executable missing after extract: ${pythonExe}`);
    }

    echo(chalk.green`✅ Success: ${pythonExe}`);
  } finally {
    await fs.remove(archivePath);
    await fs.remove(tempDir);
  }
}

async function findPythonRoot(tempDir) {
  const files = await glob('**/python.exe', { cwd: tempDir, absolute: true });
  if (files.length === 0) {
    throw new Error(`Could not find python.exe in extracted archive: ${tempDir}`);
  }
  return path.dirname(files[0]);
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

{
  const downloadAll = argv.all;
  const platform = argv.platform;

  if (downloadAll) {
    echo(chalk.cyan`🌐 Downloading bundled Python runtimes for ALL supported platforms...`);
    for (const id of Object.keys(TARGETS)) {
      await setupTarget(id);
    }
  } else if (platform) {
    const targets = PLATFORM_GROUPS[platform];
    if (!targets) {
      echo(chalk.red`❌ Unknown platform: ${platform}`);
      echo(`Available platforms: ${Object.keys(PLATFORM_GROUPS).join(', ')}`);
      process.exit(1);
    }

    echo(chalk.cyan`🎯 Downloading bundled Python runtimes for platform: ${platform}`);
    echo(`   Architectures: ${targets.join(', ')}`);
    for (const id of targets) {
      await setupTarget(id);
    }
  } else {
    const currentId = `${os.platform()}-${os.arch()}`;
    echo(chalk.cyan`💻 Detected system: ${currentId}`);

    if (TARGETS[currentId]) {
      await setupTarget(currentId);
    } else {
      echo(chalk.red`❌ Current system ${currentId} is not in the supported download list.`);
      echo(`Supported targets: ${Object.keys(TARGETS).join(', ')}`);
      echo(`\nTip: Use --platform=<platform> to download for a specific platform`);
      echo(`     Use --all to download for all platforms`);
      process.exit(1);
    }
  }

  echo(chalk.green`\n🎉 Done!`);
}
