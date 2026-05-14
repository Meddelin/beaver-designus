/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./web/index.html",
    "./web/src/**/*.{ts,tsx}",
  ],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        display: ['"IBM Plex Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        ink: {
          0: "var(--ink-0)",
          1: "var(--ink-1)",
          2: "var(--ink-2)",
          3: "var(--ink-3)",
          4: "var(--ink-4)",
          5: "var(--ink-5)",
        },
        paper: {
          0: "var(--paper-0)",
          1: "var(--paper-1)",
          2: "var(--paper-2)",
          3: "var(--paper-3)",
        },
        line: {
          DEFAULT: "var(--line)",
          strong: "var(--line-strong)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          dim: "var(--accent-dim)",
          glow: "var(--accent-glow)",
          contrast: "var(--accent-contrast)",
        },
        state: {
          success: "var(--state-success)",
          warning: "var(--state-warning)",
          danger: "var(--state-danger)",
          info: "var(--state-info)",
        },
      },
      borderRadius: {
        xs: "4px",
        sm: "6px",
        DEFAULT: "8px",
        md: "10px",
        lg: "14px",
        xl: "20px",
        "2xl": "28px",
      },
      boxShadow: {
        "elev-1": "0 1px 0 0 var(--line), 0 1px 2px 0 rgba(0,0,0,0.04)",
        "elev-2": "0 2px 0 -1px var(--line), 0 8px 24px -8px rgba(0,0,0,0.25)",
        "elev-3": "0 4px 24px -4px rgba(0,0,0,0.4), 0 12px 48px -12px rgba(0,0,0,0.3)",
        "focus-accent": "0 0 0 3px var(--accent-glow)",
      },
      transitionTimingFunction: {
        snap: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      transitionDuration: {
        120: "120ms",
        200: "200ms",
        320: "320ms",
      },
      keyframes: {
        "caret-blink": {
          "0%, 70%": { opacity: "1" },
          "71%, 100%": { opacity: "0" },
        },
        "stream-in": {
          "0%": { opacity: "0", transform: "translateY(2px)", filter: "blur(2px)" },
          "100%": { opacity: "1", transform: "translateY(0)", filter: "blur(0)" },
        },
        "shimmer-y": {
          "0%": { backgroundPosition: "0 -200%" },
          "100%": { backgroundPosition: "0 200%" },
        },
      },
      animation: {
        "caret-blink": "caret-blink 1s steps(1, end) infinite",
        "stream-in": "stream-in 180ms cubic-bezier(0.32,0.72,0,1) both",
        "shimmer-y": "shimmer-y 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};
