import { View, StyleSheet, ViewStyle } from 'react-native'
import { Colors, BorderRadius, Spacing, Shadows } from '../../constants/theme'

interface Props {
  children: React.ReactNode
  style?: ViewStyle
  shadow?: 'sm' | 'md' | 'none'
  padding?: 'sm' | 'md' | 'lg' | 'none'
}

export default function Card({
  children,
  style,
  shadow = 'sm',
  padding = 'md',
}: Props) {
  return (
    <View
      style={[
        styles.card,
        shadow !== 'none' && Shadows[shadow],
        padding !== 'none' && styles[`padding_${padding}`],
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
  padding_sm: { padding: Spacing.sm },
  padding_md: { padding: Spacing.md },
  padding_lg: { padding: Spacing.lg },
})
