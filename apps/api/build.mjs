// Bundles the API with esbuild. npm packages stay external (installed in the
// image); the workspace package @vm/domain is bundled in.
import { build } from 'esbuild';

await build({
  entryPoints: { server: 'src/server.ts', 'jobs/daily': 'src/jobs/daily.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  plugins: [
    {
      name: 'bundle-workspace',
      setup(b) {
        b.onResolve({ filter: /^@vm\/domain$/ }, () => ({ path: new URL('../../packages/domain/src/index.ts', import.meta.url).pathname }));
      },
    },
  ],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
