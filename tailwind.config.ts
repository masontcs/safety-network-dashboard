import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Design system — do not deviate from these values
        bg: {
          base:    '#111111',
          card:    '#1e1e1e',
          surface: '#2a2a2a',
        },
        border: {
          default:  '#2a2a2a',
          emphasis: '#333333',
        },
        accent: {
          orange:     '#ff6b00',
          'orange-dark': '#cc5500',
          red:        '#cc4444',
        },
        text: {
          primary:   '#ffffff',
          secondary: '#cccccc',
          muted:     '#888888',
          faint:     '#555555',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
      },
    },
  },
  plugins: [],
}

export default config
