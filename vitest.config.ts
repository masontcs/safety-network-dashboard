import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  // The React plugin transforms JSX so component .test.tsx files run under the default
  // `vitest run` — not just the separate `test:ui` config. Env stays node by default;
  // component tests opt into jsdom per-file via `// @vitest-environment jsdom`.
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'node',
    globals: false,
  },
})
