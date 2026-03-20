import { View, Text, StyleSheet } from 'react-native'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'

interface Props {
  value: number // 0–100
  label?: string
  showPercent?: boolean
  color?: string
  height?: number
}

export default function ProgressBar({
  value,
  label,
  showPercent = true,
  color = Colors.primary,
  height = 8,
}: Props) {
  const pct = Math.min(100, Math.max(0, value))

  return (
    <View style={styles.wrapper}>
      {(label || showPercent) && (
        <View style={styles.row}>
          {label && <Text style={styles.label}>{label}</Text>}
          {showPercent && <Text style={styles.pct}>{Math.round(pct)}%</Text>}
        </View>
      )}
      <View style={[styles.track, { height }]}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color, height }]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  label: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
  },
  pct: {
    ...Typography.label,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  track: {
    backgroundColor: Colors.border,
    borderRadius: BorderRadius.full,
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    borderRadius: BorderRadius.full,
  },
})
