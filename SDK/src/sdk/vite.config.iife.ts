import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        lib: {
            entry: resolve(__dirname, 'index.iife.ts'),
            name: 'Monek',
            fileName: (format) => `monek-checkout.${format}.js`,
            formats: ['iife'],
        },
        outDir: 'dist',
        emptyOutDir: false,
        rollupOptions: {
            output: {
                exports: 'none',
            },
        },
    },
});
