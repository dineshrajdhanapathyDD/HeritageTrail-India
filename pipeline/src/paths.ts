import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (pipeline/src/paths.ts -> ../..). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface PipelinePaths {
  root: string;
  configDir: string;
  rawRoot: string;
  rawBoundariesDir: string;
  processedDir: string;
  boundariesDir: string;
}

export function pathsFor(root: string = REPO_ROOT): PipelinePaths {
  return {
    root,
    configDir: join(root, 'config'),
    rawRoot: join(root, 'data', 'raw'),
    rawBoundariesDir: join(root, 'data', 'raw', 'boundaries'),
    processedDir: join(root, 'data', 'processed'),
    boundariesDir: join(root, 'data', 'processed', 'boundaries'),
  };
}

export const rawStateDir = (paths: PipelinePaths, slug: string): string => join(paths.rawRoot, slug);
