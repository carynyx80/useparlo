import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  define: { global: 'globalThis' },
  resolve: {
    alias: [
      // Browser: load only circomlibjs' Poseidon (its package entry also pulls in ethers/blake-hash, which need Node's Buffer).
      // Node (scripts/e2e.mjs) resolves the normal package entry, which exports the same buildPoseidon.
      { find: /^circomlibjs$/, replacement: fileURLToPath(new URL('./node_modules/circomlibjs/src/poseidon_wasm.js', import.meta.url)) },
    ],
  },
})
