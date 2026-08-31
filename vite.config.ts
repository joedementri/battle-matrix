import { defineConfig } from 'vitest/config';

// One config file for both Vite and Vitest (see PLANS: "Keep it one config file").
export default defineConfig({
  base: '/battle-matrix/',
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
});
