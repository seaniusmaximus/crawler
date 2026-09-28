import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { tableRelay } from './vite-plugin-table-relay.ts'

export default defineConfig({
  plugins: [react(), tableRelay()],
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
})
