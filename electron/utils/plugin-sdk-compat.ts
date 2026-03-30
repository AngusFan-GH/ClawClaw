import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT_PLUGIN_SDK_SPEC = 'openclaw/plugin-sdk';
const COMPAT_PLUGIN_SDK_SPEC = 'openclaw/plugin-sdk/compat';

const MOVED_ROOT_PLUGIN_SDK_EXPORTS: Record<string, string> = {
  resolvePreferredOpenClawTmpDir: 'openclaw/plugin-sdk/infra-runtime',
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

function rewriteRootPluginSdkImports(
  content: string,
  sourceSpec: string,
): { nextContent: string; changed: boolean } {
  let changed = false;
  const escapedSourceSpec = sourceSpec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const importPattern = new RegExp(`^(\\s*)import\\s+\\{([^}]+)\\}\\s+from\\s+["']${escapedSourceSpec}["'];?\\s*$`, 'gm');

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
      lines.push(`${indent}import { ${remaining.join(', ')} } from "${sourceSpec}";`);
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
  const namedImportPattern = /import\s+\{([^}]+)\}\s+from\s+["'](openclaw\/plugin-sdk(?:\/compat)?)["']/g;
  let namedImportMatch: RegExpExecArray | null;
  while ((namedImportMatch = namedImportPattern.exec(content)) !== null) {
    const specifiers = parseRootImportSpecifiers(namedImportMatch[1]);
    if (
      namedImportMatch[2] === COMPAT_PLUGIN_SDK_SPEC
      || specifiers.some((specifier) => specifier.imported in MOVED_ROOT_PLUGIN_SDK_EXPORTS)
    ) {
      return true;
    }
  }

  const namespaceImportPattern = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["'](openclaw\/plugin-sdk(?:\/compat)?)["']/g;
  let namespaceImportMatch: RegExpExecArray | null;
  while ((namespaceImportMatch = namespaceImportPattern.exec(content)) !== null) {
    if (namespaceImportMatch[2] === COMPAT_PLUGIN_SDK_SPEC) {
      return true;
    }
    const alias = namespaceImportMatch[1];
    for (const movedExport of Object.keys(MOVED_ROOT_PLUGIN_SDK_EXPORTS)) {
      const memberUsePattern = new RegExp(`\\b${alias}\\.${movedExport}\\b`);
      if (memberUsePattern.test(content)) {
        return true;
      }
    }
  }

  const requirePattern = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["'](openclaw\/plugin-sdk(?:\/compat)?)["']\s*\)/g;
  let requireMatch: RegExpExecArray | null;
  while ((requireMatch = requirePattern.exec(content)) !== null) {
    const alias = requireMatch[1];
    const sourceSpec = requireMatch[2];
    if (sourceSpec === COMPAT_PLUGIN_SDK_SPEC) {
      return true;
    }
    for (const movedExport of Object.keys(MOVED_ROOT_PLUGIN_SDK_EXPORTS)) {
      const memberUsePattern = new RegExp(`\\b${alias}\\.${movedExport}\\b`);
      if (memberUsePattern.test(content)) {
        return true;
      }
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
    const rootRewrite = rewriteRootPluginSdkImports(source, ROOT_PLUGIN_SDK_SPEC);
    const compatRewrite = rewriteRootPluginSdkImports(rootRewrite.nextContent, COMPAT_PLUGIN_SDK_SPEC);
    const nextContent = compatRewrite.nextContent;
    const changed = rootRewrite.changed || compatRewrite.changed;
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
