/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/frontend/**/*.{js,ts,jsx,tsx,mdx}',
    './src/backend/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        sfpl: {
          bg: 'var(--sfpl-bg)',
          surface: 'var(--sfpl-surface)',
          'surface-muted': 'var(--sfpl-surface-muted)',
          'surface-strong': 'var(--sfpl-surface-strong)',
          border: 'var(--sfpl-border)',
          'border-strong': 'var(--sfpl-border-strong)',
          primary: 'var(--sfpl-primary)',
          'primary-hover': 'var(--sfpl-primary-hover)',
          text: 'var(--sfpl-text)',
          'text-secondary': 'var(--sfpl-text-secondary)',
          'text-muted': 'var(--sfpl-text-muted)',
        },
        cream: {
          50: '#FDFBF9',
          100: '#FAF6F0',
          200: '#F4EFE3',
          300: '#EFE9D9',
          400: '#EAE4D5',
          500: '#C4B9A3',
          600: '#94A3B8',
          700: '#64748B',
          800: '#475569',
          900: '#111311',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
