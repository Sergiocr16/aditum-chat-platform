import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Un único widget.js IIFE embebible en cualquier página.
// El CSS se importa como string (?inline) y se inyecta en el Shadow DOM,
// así los estilos del host jamás chocan con los del widget.
export default defineConfig({
  plugins: [preact()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  build: {
    lib: {
      entry: 'src/main.tsx',
      name: 'AditumChat',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
    rollupOptions: {
      output: { extend: true, inlineDynamicImports: true },
    },
    target: 'es2019',
    minify: true,
  },
  server: {
    port: 5173,
    open: '/demo/index.html',
  },
})
