import { defineConfig } from 'vite';
import plugin from '@vitejs/plugin-react';
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [plugin()],
    server: {
        port: 55462,
    },
    build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        hostedFields: resolve(__dirname, 'src/hostedFields/hosted-fields.html'),
        expressCheckout: resolve(__dirname, 'src/expressCheckout/express-checkout.html'),
        thankYou: resolve(__dirname, 'src/thank-you/thank-you.html'),
      },
    },
  },
})
