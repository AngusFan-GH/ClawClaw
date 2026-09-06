import fs from 'node:fs';
import path from 'node:path';

// Assembles the runtime tree embedded in the Tauri bundle:
//   runtime/dist-backend        ClawCore backend bundle (Node)
//   runtime/resources/{skills,icons}
//   runtime/bin/node            the build machine's Node interpreter
// There is no Python/uv runtime: ClawCore is a Node-only application.
const root = process.cwd();
const output = path.resolve(root, 'src-tauri/runtime');
if (output !== path.join(root, 'src-tauri', 'runtime')) throw new Error('Invalid runtime output path');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

function copy(from, to) {
  if (!fs.existsSync(from)) throw new Error(`Required runtime resource is missing: ${from}`);
  fs.cpSync(from, path.join(output, to), { recursive: true, dereference: true, force: true });
}

copy('dist-backend', 'dist-backend');
for (const name of ['skills', 'icons']) {
  if (fs.existsSync(`resources/${name}`)) copy(`resources/${name}`, `resources/${name}`);
}

fs.mkdirSync(path.join(output, 'bin'), { recursive: true });
fs.copyFileSync(process.execPath, path.join(output, 'bin', process.platform === 'win32' ? 'node.exe' : 'node'));
if (process.platform !== 'win32') fs.chmodSync(path.join(output, 'bin/node'), 0o755);

fs.writeFileSync(
  path.join(output, 'package.json'),
  JSON.stringify({ name: 'clawclaw-runtime', private: true, type: 'module' }, null, 2),
);
console.log(`Tauri runtime ready: ${output}`);
