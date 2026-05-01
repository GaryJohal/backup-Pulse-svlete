/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        // ── ITBD Brand Blue (#00ADDA) ─────────────────────────────────────────
        brand: {
          50:  '#e6f7fc',  // very light tint
          100: '#b3e9f6',  // sidebar link text  (text-brand-100)
          200: '#80dbf0',
          300: '#4dc8e4',  // sidebar footer text (text-brand-300)
          400: '#26bade',
          500: '#00adda',  // ITBD primary blue
          600: '#00adda',  // btn-primary bg
          700: '#0094ba',  // hover / active nav bg
          800: '#007a9a',
          900: '#174366',  // sidebar background
        },
        // ── Dark theme gray (inverted: 50 = dark surface, 900 = near-white) ──
        gray: {
          50:  '#2d2d2d',  // table headers / hover states (elevated surface)
          100: '#1e1e1e',  // page-level bg wrappers
          200: '#3a3a3a',  // borders
          300: '#4a4a4a',  // muted borders / input borders
          400: '#6b6b6b',  // icons / very muted text
          500: '#9a9a9a',  // placeholder / muted text
          600: '#b8b8b8',  // secondary text
          700: '#d4d4d4',  // body text — brighter on dark bg
          800: '#e8e8e8',  // emphasized body
          900: '#f5f5f5',  // headings (near-white)
        },
        // ── ITBD Success Green (#BED62F) ──────────────────────────────────────
        green: {
          50:  '#1a2308',
          100: '#1e2a0d',  // dark-tinted badge bg
          200: '#293d12',
          300: '#3d5518',
          400: '#bed62f',
          500: '#bed62f',  // ITBD green
          600: '#a8bc29',
          700: '#bed62f',  // text on dark badge
          800: '#bed62f',
          900: '#d4e873',
        },
        // ── Reds (dark-friendly) ──────────────────────────────────────────────
        red: {
          50:  '#2d0a0a',
          100: '#3d1010',  // dark-tinted badge bg
          200: '#5a1a1a',
          300: '#f87171',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#f87171',  // text on dark badge
          800: '#fca5a5',
          900: '#fecaca',
        },
        // ── ITBD Warning Orange (#FF8B17) ─────────────────────────────────────
        orange: {
          50:  '#2d1500',
          100: '#3a1c06',  // dark-tinted badge bg
          200: '#5a2e0a',
          500: '#ff8b17',  // ITBD orange
          600: '#e87a12',
          700: '#ff8b17',  // text on dark badge
          800: '#ffaa55',
          900: '#ffc880',
        },
        yellow: {
          50:  '#2d2000',
          100: '#382608',  // dark-tinted badge bg
          800: '#ff8b17',  // reuse ITBD orange for yellow warnings
        },
        amber: {
          50:  '#2d2000',
          100: '#382608',
          300: '#ffaa55',
          600: '#ff8b17',
          700: '#ff8b17',
          800: '#ffaa55',
        },
        // ── Blue (info / focus rings) ─────────────────────────────────────────
        blue: {
          50:  '#0a1c28',
          100: '#0d2234',
          500: '#00adda',
          600: '#00adda',
          700: '#0094ba',
        },
      },
      // ── Stronger shadows for dark surfaces ───────────────────────────────────
      boxShadow: {
        sm:      '0 1px 2px 0 rgba(0,0,0,0.55)',
        DEFAULT: '0 1px 3px 0 rgba(0,0,0,0.55), 0 1px 2px -1px rgba(0,0,0,0.45)',
        md:      '0 4px 6px -1px rgba(0,0,0,0.55), 0 2px 4px -2px rgba(0,0,0,0.45)',
        lg:      '0 10px 15px -3px rgba(0,0,0,0.55), 0 4px 6px -4px rgba(0,0,0,0.45)',
      },
    },
  },
  plugins: [],
};
