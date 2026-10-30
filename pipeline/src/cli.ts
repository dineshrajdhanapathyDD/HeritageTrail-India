import { parseArgs } from 'node:util';
import { pathsFor } from './paths.ts';
import { runBoundaries, runState } from './run.ts';

const USAGE = `Usage:
  npm run pipeline -- boundaries [--offline]
  npm run pipeline -- run --state <slug> [--offline] [--sources a,b]

  boundaries   download geoBoundaries ADM1/ADM2 and write data/processed/boundaries/*
  run          fetch (or with --offline re-read data/raw/<slug>/) and write data/processed/<slug>.*`;

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      state: { type: 'string' },
      offline: { type: 'boolean', default: false },
      sources: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const command = positionals[0];
  const log = (m: string) => console.log(m);
  const paths = pathsFor();

  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }
  if (command === 'boundaries') {
    const out = await runBoundaries({ paths, offline: values.offline, log });
    return out.states.every((s) => s.output.districtCount.ok) ? 0 : 2;
  }
  if (command === 'run') {
    if (!values.state) {
      console.error('--state <slug> is required\n');
      console.error(USAGE);
      return 1;
    }
    const sources = values.sources?.split(',').map((s) => s.trim()).filter(Boolean);
    const { collection, report } = await runState(values.state, { paths, offline: values.offline, sources, log });
    const c = collection.metadata.counts;
    log(`\n${report.state}: ${c.total} published (${c.verified} verified, ${c.unverified} unverified), ${c.rejected} rejected`);
    log(`by category: ${JSON.stringify(c.byCategory)}`);
    log(`flags: ${JSON.stringify(report.flags)}`);
    if (report.asiCoverage) {
      log(`ASI coverage: ${report.asiCoverage.distinctCentralAsiIds} of ${report.asiCoverage.asiPublishedCount} centrally protected IDs`);
    }
    for (const f of report.sourceFailures) log(`source failure: ${f.source}/${f.request}: ${f.error}`);
    return 0;
  }
  console.error(`Unknown command "${command}"\n`);
  console.error(USAGE);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
