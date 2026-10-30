import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const repoPath = (...parts: string[]) => path.join(REPO_ROOT, ...parts);
