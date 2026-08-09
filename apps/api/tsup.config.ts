import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  // Workspace packages are TypeScript source, so they must be bundled in.
  noExternal: ['@reality/shared'],
  // Native/heavy runtime deps stay external and are installed in the image.
  external: ['@prisma/client', '.prisma/client'],
});
