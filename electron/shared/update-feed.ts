export type UpdateChannel = 'stable';

export const UPDATE_BASE_URL = 'https://clawclaw.xzinfra.com/updates';
export const PORTABLE_UPDATE_BASE_URL = 'https://clawclaw.xzinfra.com/updates-portable';

export type PortableUpdateTarget =
  | 'win32-x64'
  | 'win32-arm64'
  | 'darwin-x64'
  | 'darwin-arm64';

export interface PortableUpdateArtifact {
  url: string;
  sha512: string;
  size: number;
}

export interface PortableUpdateManifest {
  version: string;
  releaseDate: string;
  layoutVersion: number;
  minimumAppVersion: string;
  artifact: PortableUpdateArtifact;
  notes?: string;
}

export const UPDATE_FEEDS: Record<UpdateChannel, {
  url: string;
  allowPrerelease: boolean;
}> = {
  stable: {
    url: `${UPDATE_BASE_URL}/stable`,
    allowPrerelease: false,
  },
};

export function getPortableManifestName(target: PortableUpdateTarget): string {
  return `${target}.json`;
}

export function getPortableManifestUrl(channel: UpdateChannel, target: PortableUpdateTarget): string {
  return `${PORTABLE_UPDATE_BASE_URL}/${channel}/${getPortableManifestName(target)}`;
}
