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
  // Borderless + soft shadow — matches the web app's `.card { border: none;
  // box-shadow: 0 1px 4px rgba(0,0,0,0.07) }` look.
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
  },
})
