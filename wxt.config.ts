import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  alias: {
    '@/components': './components',
    '@/store': './store',
    '@/lib': './lib',
    '@/types': './types',
    '@/assets': './assets',
  },
  manifest: {
    name: 'Office Hub Dashboard',
    description:
      'A collaborative new tab dashboard with kanban, mini tools, and live office presence.',
    permissions: ['storage', 'tabs'],
    chrome_url_overrides: {
      newtab: 'newtab.html',
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
