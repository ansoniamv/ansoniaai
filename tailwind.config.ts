import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1280px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        hairline: "hsl(var(--hairline))",
        gridline: "hsl(var(--gridline))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
        tier: {
          "strong-fg": "hsl(var(--tier-strong-fg))",
          "strong-bg": "hsl(var(--tier-strong-bg))",
          "medium-fg": "hsl(var(--tier-medium-fg))",
          "medium-bg": "hsl(var(--tier-medium-bg))",
          "maybe-fg": "hsl(var(--tier-maybe-fg))",
          "maybe-bg": "hsl(var(--tier-maybe-bg))",
          "skip-fg": "hsl(var(--tier-skip-fg))",
          "skip-bg": "hsl(var(--tier-skip-bg))",
        },
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "sans-serif"],
        display: ['"Inter Tight"', '"Inter"', "system-ui", "sans-serif"],
        serif: ['"Source Serif 4"', '"Source Serif Pro"', "Georgia", "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        // Institutional 8px-rhythm scale: 12/14/16/20/24/32/40
        "2xs": ["11px", { lineHeight: "1.35" }],
        xs: ["12px", { lineHeight: "1.45" }],
        sm: ["14px", { lineHeight: "1.5" }],
        base: ["16px", { lineHeight: "1.55" }],
        lg: ["20px", { lineHeight: "1.4" }],
        xl: ["24px", { lineHeight: "1.3" }],
        "2xl": ["32px", { lineHeight: "1.2", letterSpacing: "-0.015em" }],
        "3xl": ["40px", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        "4xl": ["48px", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
      },
      spacing: {
        // 8px grid (Tailwind already covers most; just ensure consistency)
        18: "4.5rem",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.06)",
        "card-hover": "0 4px 12px rgba(16, 24, 40, 0.08)",
        elevated: "0 8px 24px rgba(16, 24, 40, 0.08)",
      },
      transitionDuration: {
        DEFAULT: "150ms",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 200ms ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
