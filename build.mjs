import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['node_modules/digitaljs/src/index.mjs'],
  bundle: true,
  outfile: 'digitaljs.bundle.js',
  format: 'iife',
  globalName: 'digitaljs',
  loader: { '.png': 'dataurl' },
  alias: {
    'jquery': 'jquery',
    'lodash': 'lodash',
    'backbone': 'backbone',
    'jointjs': 'jointjs',
    'elkjs/lib/elk.bundled.js': 'elkjs/lib/elk.bundled.js'
  }
});
