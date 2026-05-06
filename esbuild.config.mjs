import esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: 'out/extension.js',
  sourcemap: true,
  sourcesContent: false,
  external: ['vscode'],
  logLevel: 'info',
  minify: true,
  treeShaking: true,
});

if (isWatch) {
  await ctx.watch();
  // eslint-disable-next-line no-console
  console.log('esbuild: watching…');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
