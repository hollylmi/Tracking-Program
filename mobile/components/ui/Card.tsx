import { View, StyleSheet, ViewStyle } from 'react-native'
import { Colors, BorderRadius, Spacing, Shadows } from '../../constants/theme'

type PaddingAlias = 'sm' | 'md' | 'lg' | 'none'

interface Props {
  children: React.ReactNode
  style?: ViewStyle
  shadow?: 'sm' | 'md' | 'none'
  padding?: number | PaddingAlias
}

const PADDING: Record<PaddingAlias, number> = {
  sm: Spacing.sm,
  md: Spacing.md,
  lg: Spacing.lg,
  none: 0,
}

export default function Card({ children, style, shadow = 'sm', padding = 'md' }: Props) {
  const p = typeof padding === 'number' ? padding : PADDING[padding]
  return (
    <View
      style={[
        styles.card,
        shadow !== 'none' && Shadows[shadow],
        { padding: p },
        style,
      ]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
})
