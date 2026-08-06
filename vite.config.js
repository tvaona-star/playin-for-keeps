import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' makes asset URLs relative, so the build works at any
// GitHub Pages path (username.github.io/<repo>/) without configuration.
export default defineConfig({
  plugins: [react()],
  base: './',
})
