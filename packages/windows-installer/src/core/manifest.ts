export interface InstallerPayload {
  arch: string;
  unpackedDir: string;
}

export interface InstallerManifest {
  manifestVersion: 1;
  productName: string;
  displayName: string;
  version: string;
  backend: 'clawclaw-installer-core';
  payloads: InstallerPayload[];
}

export function parseInstallerManifest(value: unknown): InstallerManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('Installer manifest must be an object');
  }

  const manifest = value as Partial<InstallerManifest>;
  if (manifest.manifestVersion !== 1) {
    throw new Error(`Unsupported installer manifest version: ${String(manifest.manifestVersion)}`);
  }
  if (manifest.backend !== 'clawclaw-installer-core') {
    throw new Error(`Unsupported installer backend: ${String(manifest.backend)}`);
  }
  if (!manifest.productName || !manifest.displayName || !manifest.version) {
    throw new Error('Installer manifest is missing productName, displayName, or version');
  }
  if (!Array.isArray(manifest.payloads) || manifest.payloads.length === 0) {
    throw new Error('Installer manifest must include at least one payload');
  }

  return {
    manifestVersion: 1,
    productName: manifest.productName,
    displayName: manifest.displayName,
    version: manifest.version,
    backend: 'clawclaw-installer-core',
    payloads: manifest.payloads.map((payload) => {
      if (!payload || typeof payload !== 'object') {
        throw new Error('Installer payload must be an object');
      }
      const next = payload as Partial<InstallerPayload>;
      if (!next.arch || !next.unpackedDir) {
        throw new Error('Installer payload is missing arch or unpackedDir');
      }
      return {
        arch: next.arch,
        unpackedDir: next.unpackedDir,
      };
    }),
  };
}
