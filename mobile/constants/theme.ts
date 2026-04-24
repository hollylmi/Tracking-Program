export const Colors = {
  primary:       '#FFB7C5',   // pink brand
  primaryDark:   '#E89AAD',   // deeper pink
  dark:          '#2F2F2F',   // slate — matches web navbar (--ply-slate)
  darkMid:       '#3F3F3F',   // slate mid — hover states
  background:    '#F6F3F4',   // web-style soft grey-pink (close to --ply-bg)
  surface:       '#FFFFFF',   // white cards/inputs
  border:        '#E6DDE1',   // softer neutral pink-grey border
  borderSoft:    '#EFE8EB',   // hairline border for internal dividers
  accent:        '#A6E6FC',   // blue accent
  textPrimary:   '#1E1E1E',   // near-black, slight warmth
  textSecondary: '#6C6C6C',   // neutral grey (like web's muted text)
  textLight:     '#A9A0A3',   // soft grey — placeholders
  success:       '#3D8B41',
  warning:       '#C96A00',
  error:         '#C62828',
  white:         '#FFFFFF',
}

export const Typography = {
  h1:        { fontSize: 28, fontWeight: '800' as const, letterSpacing: 0.3 },
  h2:        { fontSize: 22, fontWeight: '700' as const, letterSpacing: 0.2 },
  h3:        { fontSize: 18, fontWeight: '700' as const },
  h4:        { fontSize: 16, fontWeight: '700' as const },
  body:      { fontSize: 15, fontWeight: '400' as const },
  bodySmall: { fontSize: 13, fontWeight: '400' as const },
  label:     { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.8 },
  caption:   { fontSize: 11, fontWeight: '400' as const },
}

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
}

export const BorderRadius = {
  sm:   6,
  md:   12,   // up from 10 — matches web card 0.75rem
  lg:   16,
  xl:   24,
  full: 999,
}

// Gentle, web-app-style shadows — low opacity, short blur, small offset.
export const Shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.09,
    shadowRadius: 10,
    elevation: 4,
  },
}
