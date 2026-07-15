import { nodeResolve } from '@rollup/plugin-node-resolve';

export default [
  {
    input: 'dist/esm/index.js',
    output: {
      file: 'dist/plugin.js',
      format: 'iife',
      name: 'capacitorCapgoCapacitorFastSql',
      globals: {
        '@capacitor/core': 'capacitorExports',
      },
      sourcemap: true,
      inlineDynamicImports: true,
    },
    // Bundle sqlite-wasm into the IIFE — there is no browser global for it.
    external: ['@capacitor/core'],
    plugins: [
      nodeResolve({
        browser: true,
        preferBuiltins: false,
      }),
    ],
  },
  {
    input: 'dist/esm/index.js',
    output: {
      file: 'dist/plugin.cjs.js',
      format: 'cjs',
      sourcemap: true,
      inlineDynamicImports: true,
    },
    external: ['@capacitor/core', '@sqlite.org/sqlite-wasm'],
  },
];
