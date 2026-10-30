import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CategoriesConfig,
  SourcesConfig,
  StateConfig,
  type SourceConfig,
} from '@heritagetrail/shared';
import type { z } from 'zod';
import type { PipelinePaths } from './paths.ts';

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function parseFile<T extends z.ZodType>(schema: T, file: string): z.infer<T> {
  const result = schema.safeParse(readJson(file));
  if (!result.success) throw new Error(`Invalid config ${file}: ${result.error.message}`);
  return result.data;
}

export interface PipelineConfig {
  sources: SourcesConfig;
  categories: CategoriesConfig;
  states: StateConfig[];
}

export function loadConfig(paths: PipelinePaths): PipelineConfig {
  const statesDir = join(paths.configDir, 'states');
  const states = readdirSync(statesDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const state = parseFile(StateConfig, join(statesDir, f));
      if (`${state.slug}.json` !== f) throw new Error(`config/states/${f}: slug must match the file name`);
      return state;
    });
  return {
    sources: parseFile(SourcesConfig, join(paths.configDir, 'sources.json')),
    categories: parseFile(CategoriesConfig, join(paths.configDir, 'categories.json')),
    states,
  };
}

export function getState(config: PipelineConfig, slug: string): StateConfig {
  const state = config.states.find((s) => s.slug === slug);
  if (!state) {
    throw new Error(`Unknown state "${slug}". Known: ${config.states.map((s) => s.slug).join(', ')}`);
  }
  return state;
}

export function getSource(config: PipelineConfig, id: string): SourceConfig {
  const source = config.sources.sources.find((s) => s.id === id);
  if (!source) throw new Error(`Source "${id}" missing from config/sources.json`);
  return source;
}
