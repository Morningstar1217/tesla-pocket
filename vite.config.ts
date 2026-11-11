import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

export default defineConfig({
  plugins: [(uni as unknown as { default: typeof uni }).default()],
  server: { proxy: { '/api': 'http://127.0.0.1:8776' } },
  build: { sourcemap: false },
})
