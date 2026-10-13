import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  base: './', plugins: [react()],
  build: { outDir: mode === 'guest' ? 'dist-guest' : 'dist', rollupOptions: { input: mode === 'guest' ? 'guest.html' : ['index.html', 'guest.html'] } },
  test: { include: ['tests/**/*.test.ts'], exclude: ['**/firestore.rules.test.ts','**/requests.firestore.test.ts','**/auth.firestore.test.ts'] }
}));
