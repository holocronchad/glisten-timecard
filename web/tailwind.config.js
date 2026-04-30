/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#DEDBC8',
        creamSoft: '#E1E0CC',
        ink: '#0A0A0A',
        carbon: '#101010',
        graphite: '#1A1A1A',
        slate: '#212121',
        mute: '#6B6B66',
        // Per Dr. Dawood 2026-04-29: clock-in green, clock-out maroon so
        // the punch types are visually distinct everywhere they render.
        // These read well on the dark UI and the cream PDF/print exports.
        clockIn: '#7CB382',
        clockInDeep: '#3F8055',
        clockOut: '#B5462E',
        clockOutDeep: '#7C2D2D',
        lunchAccent: '#C9A961',
      },
      fontFamily: {
        sans: ['Almarai', 'system-ui', 'sans-serif'],
        serif: ['"Instrument Serif"', 'serif'],
      },
      letterSpacing: {
        tightest: '-0.04em',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        fadeUp: 'fadeUp 0.6s ease-out forwards',
        fadeIn: 'fadeIn 0.4s ease-out forwards',
      },
    },
  },
  plugins: [],
};
