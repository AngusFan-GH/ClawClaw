import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT_PLUGIN_SDK_SPEC = 'openclaw/plugin-sdk';

const MOVED_ROOT_PLUGIN_SDK_EXPORTS: Record<string, string> = {
  resolvePreferredOpenClawTmpDir: 'openclaw/plugin-sdk/temp-path',
};

const JS_LIKE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs']);

type RootImportSpecifier = {
  imported: string;
  local: string;
  raw: string;
};

function collectSourceFiles(rootDir: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const dotIndex = entry.name.lastIndexOf('.');
      const ext = dotIndex >= 0 ? entry.name.slice(dotIndex) : '';
      if (entry.name.endsWith('.d.ts') || !JS_LIKE_EXTENSIONS.has(ext)) continue;
      files.push(fullPath);
    }
  };

  visit(rootDir);
  return files;
}

function parseRootImportSpecifiers(rawSpecifiers: string): RootImportSpecifier[] {
  return rawSpecifiers
    .split(',')
    .map((specifier) => specifier.trim())
    .filter(Boolean)
    .map((specifier) => {
      const [imported, local] = specifier.split(/\s+as\s+/).map((part) => part.trim());
      return {
        imported,
        local: local || imported,
        raw: specifier,
      };
    });
}

function rewriteRootPluginSdkImports(content: string): { nextContent: string; changed: boolean } {
  let changed = false;
  const importPattern = /^(\s*)import\s+\{([^}]+)\}\s+from\s+["']openclaw\/plugin-sdk["'];?\s*$/gm;

  const nextContent = content.replace(importPattern, (_match, indent: string, rawSpecifiers: string) => {
    const specifiers = parseRootImportSpecifiers(rawSpecifiers);
    const remaining: string[] = [];
    const movedBySubpath = new Map<string, string[]>();

    for (const specifier of specifiers) {
      const subpath = MOVED_ROOT_PLUGIN_SDK_EXPORTS[specifier.imported];
      if (!subpath) {
        remaining.push(specifier.raw);
        continue;
      }
      const movedSpecifiers = movedBySubpath.get(subpath) ?? [];
      movedSpecifiers.push(
        specifier.imported === specifier.local
          ? specifier.imported
          : `${specifier.imported} as ${specifier.local}`,
      );
      movedBySubpath.set(subpath, movedSpecifiers);
    }

    if (movedBySubpath.size === 0) {
      return _match;
    }

    changed = true;
    const lines: string[] = [];
    if (remaining.length > 0) {
      lines.push(`${indent}import { ${remaining.join(', ')} } from "${ROOT_PLUGIN_SDK_SPEC}";`);
    }
    for (const [subpath, movedSpecifiers] of movedBySubpath.entries()) {
      lines.push(`${indent}import { ${movedSpecifiers.join(', ')} } from "${subpath}";`);
    }
    return lines.join('\n');
  });

  return { nextContent, changed };
}

function fileContainsIncompatibleRootImports(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf8');
  const importPattern = /import\s+\{([^}]+)\}\s+from\s+["']openclaw\/plugin-sdk["']/g;
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(content)) !== null) {
    const specifiers = parseRootImportSpecifiers(match[1]);
    if (specifiers.some((specifier) => specifier.imported in MOVED_ROOT_PLUGIN_SDK_EXPORTS)) {
      return true;
    }
  }
  return false;
}

export function hasIncompatibleManagedPluginSdkImports(rootDir: string): boolean {
  try {
    for (const filePath of collectSourceFiles(rootDir)) {
      if (fileContainsIncompatibleRootImports(filePath)) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export function repairManagedPluginSdkImports(rootDir: string): { repaired: boolean; changedFiles: string[] } {
  const changedFiles: string[] = [];
  for (const filePath of collectSourceFiles(rootDir)) {
    const source = readFileSync(filePath, 'utf8');
    const { nextContent, changed } = rewriteRootPluginSdkImports(source);
    if (!changed || nextContent === source) continue;
    writeFileSync(filePath, nextContent, 'utf8');
    changedFiles.push(filePath);
  }
  return {
    repaired: changedFiles.length > 0,
    changedFiles,
  };
}

export function isManagedPluginSdkCompatFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile() && !filePath.endsWith('.d.ts');
  } catch {
    return false;
  }
}
