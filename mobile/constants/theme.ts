export const Colors = {
  primary:       '#FFB7C5',   // pink brand
  primaryDark:   '#E89AAD',   // deeper pink
  dark:          '#1A1018',   // deep wine — nav bars, headers, tab bar
  background:    '#FFF5F7',   // soft pink-white — screen/scroll backgrounds
  surface:       '#FFFFFF',   // white — cards, inputs
  border:        '#F0D0DC',   // soft pink border
  accent:        '#A6E6FC',   // blue accent
  textPrimary:   '#1A0A10',   // near-black warm — main body text
  textSecondary: '#7A4A5A',   // muted plum — secondary labels
  textLight:     '#C0899A',   // soft pink-grey — placeholders
  success:       '#3D8B41',
  warning:       '#C96A00',
  error:         '#C62828',
  white:         '#FFFFFF',
}

export const Typography = {
  h1:        { fontSize: 28, fontWeight: '700' as const },
  h2:        { fontSize: 22, fontWeight: '700' as const },
  h3:        { fontSize: 18, fontWeight: '600' as const },
  h4:        { fontSize: 16, fontWeight: '600' as const },
  body:      { fontSize: 15, fontWeight: '400' as const },
  bodySmall: { fontSize: 13, fontWeight: '400' as const },
  label:     { fontSize: 12, fontWeight: '500' as const },
  caption:   { fontSize: 11, fontWeight: '300' as const },
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
  md:   10,
  lg:   16,
  xl:   24,
  full: 999,
}

export const Shadows = {
  sm: {
    shadowColor: '#8A3050',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  md: {
    shadowColor: '#8A3050',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
}
