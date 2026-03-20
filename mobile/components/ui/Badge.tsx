import { View, Text, StyleSheet, ViewStyle } from 'react-native'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'

type Variant = 'default' | 'success' | 'warning' | 'error' | 'accent'

const variantColors: Record<Variant, { bg: string; text: string }> = {
  default: { bg: Colors.surface, text: Colors.textSecondary },
  success: { bg: '#E8F5E9', text: Colors.success },
  warning: { bg: '#FFF3E0', text: Colors.warning },
  error: { bg: '#FFEBEE', text: Colors.error },
  accent: { bg: '#E3F6FF', text: '#0288D1' },
}

interface Props {
  label: string
  variant?: Variant
  style?: ViewStyle
}

export default function Badge({ label, variant = 'default', style }: Props) {
  const { bg, text } = variantColors[variant]
  return (
    <View style={[styles.badge, { backgroundColor: bg }, style]}>
      <Text style={[styles.text, { color: text }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    alignSelf: 'flex-start',
  },
  text: {
    ...Typography.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
})
