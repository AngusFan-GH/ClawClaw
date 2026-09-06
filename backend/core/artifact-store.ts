import { copyFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { app } from '../host/desktop';
export type CoreArtifact = { id: string; fileName: string; mimeType: string; fileSize: number; stagedPath: string; preview: null };
export class CoreArtifactStore {
  private readonly root = join(app.getPath('userData'), 'artifacts');
  constructor() { mkdirSync(this.root, { recursive: true }); }
  stagePaths(paths: string[]): CoreArtifact[] { return paths.map(path => { const id = crypto.randomUUID(); const fileName = basename(path); const stagedPath = join(this.root, `${id}-${fileName}`); copyFileSync(path, stagedPath); return { id, fileName, mimeType: 'application/octet-stream', fileSize: statSync(stagedPath).size, stagedPath, preview: null }; }); }
  stageBuffer(base64: string, fileName: string, mimeType: string): CoreArtifact { const id = crypto.randomUUID(); const stagedPath = join(this.root, `${id}-${basename(fileName)}`); writeFileSync(stagedPath, Buffer.from(base64, 'base64')); return { id, fileName: basename(fileName), mimeType, fileSize: statSync(stagedPath).size, stagedPath, preview: null }; }
}
