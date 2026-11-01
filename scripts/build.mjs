// Build script for The Night Ward.
// Bundles src/main.js (three.js included) into a single IIFE script so that
// index.html can be opened directly from disk (file://) or any static host.
import * as esbuild from 'esbuild';

const args = new Set(process.argv.slice(2));

const options = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  outfile: 'dist/night-ward.js',
  minify: !args.has('--serve'),
  sourcemap: args.has('--serve') ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
};

if (args.has('--serve')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: '.', port: 8080 });
  console.log(`\n  The Night Ward dev server: http://localhost:${port}/\n`);
} else if (args.has('--check')) {
  await esbuild.build({ ...options, write: false });
  console.log('Bundle OK');
} else {
  await esbuild.build(options);
}
