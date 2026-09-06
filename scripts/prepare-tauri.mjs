import fs from 'node:fs';
import path from 'node:path';
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
for (const name of ['skills', 'icons']) if (fs.existsSync(`resources/${name}`)) copy(`resources/${name}`, `resources/${name}`);
fs.mkdirSync(path.join(output, 'bin'), { recursive: true });
fs.copyFileSync(process.execPath, path.join(output, 'bin', process.platform === 'win32' ? 'node.exe' : 'node'));
if (process.platform !== 'win32') fs.chmodSync(path.join(output, 'bin/node'), 0o755);
const platform = `${process.platform}-${process.arch}`;
const uvName = process.platform === 'win32' ? 'uv.exe' : 'uv';
const bundledUv = path.join('resources', 'bin', platform, uvName);
const systemUv = process.platform === 'win32'
  ? path.join(process.env.USERPROFILE || '', '.local', 'bin', uvName)
  : '';
copy(fs.existsSync(bundledUv) ? bundledUv : systemUv, `bin/${uvName}`);
if (process.platform === 'win32') {
  const bundledPython = `resources/python/${platform}`;
  const managedPython = path.join(process.env.APPDATA || '', 'uv', 'python', 'cpython-3.12-windows-x86_64-none');
  copy(fs.existsSync(bundledPython) ? bundledPython : managedPython, 'python');
}
fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({ name: 'clawclaw-runtime', private: true, type: 'module' }, null, 2));
console.log(`Tauri runtime ready: ${output}`);
