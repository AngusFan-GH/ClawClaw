import { build } from 'esbuild';
await build({ entryPoints: ['backend/entry.ts'], outfile: 'dist-backend/entry.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: true,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; import { fileURLToPath as __fileURLToPath } from 'node:url'; import { dirname as __dirnameOf } from 'node:path'; const require = __createRequire(import.meta.url); const __dirname = __dirnameOf(__fileURLToPath(import.meta.url));" },
});
