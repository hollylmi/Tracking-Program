import { View, Text, StyleSheet, ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, BorderRadius } from '../../constants/theme'

type Variant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'delay' | 'accent'
type Size = 'sm' | 'md'

const variantColors: Record<Variant, { bg: string; text: string }> = {
  default: { bg: Colors.surface, text: Colors.textSecondary },
  success:  { bg: '#E8F5E9', text: Colors.success },
  warning:  { bg: '#FFF3E0', text: Colors.warning },
  error:    { bg: '#FFEBEE', text: Colors.error },
  info:     { bg: '#E3F6FF', text: '#0288D1' },
  accent:   { bg: '#E3F6FF', text: '#0288D1' },
  delay:    { bg: Colors.warning, text: Colors.white },
}

interface Props {
  label: string
  variant?: Variant
  size?: Size
  icon?: React.ComponentProps<typeof Ionicons>['name']
  style?: ViewStyle
}

export default function Badge({ label, variant = 'default', size = 'sm', icon, style }: Props) {
  const { bg, text } = variantColors[variant]
  const sm = size === 'sm'

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: bg,
          paddingHorizontal: sm ? Spacing.sm : 10,
          paddingVertical: sm ? 2 : 4,
        },
        style,
      ]}
    >
      {icon && (
        <Ionicons name={icon} size={sm ? 10 : 12} color={text} style={{ marginRight: 3 }} />
      )}
      <Text style={[styles.text, { color: text, fontSize: sm ? 11 : 13 }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BorderRadius.full,
    alignSelf: 'flex-start',
  },
  text: {
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
})
