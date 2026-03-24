import { useRef, useEffect } from 'react'
import { View, Text, StyleSheet, Animated, LayoutChangeEvent } from 'react-native'
import { Colors, Typography, Spacing } from '../../constants/theme'

interface Props {
  value: number         // 0–100
  label?: string
  showPercent?: boolean
  fillColor?: string
  trackColor?: string
  height?: number
  borderRadius?: number
  animated?: boolean
  // legacy alias kept for any existing callers
  color?: string
}

export default function ProgressBar({
  value,
  label,
  showPercent = true,
  fillColor,
  trackColor = Colors.surface,
  height = 8,
  borderRadius = 4,
  animated = true,
  color,
}: Props) {
  const resolvedFill = fillColor ?? color ?? Colors.primary
  const pct = Math.min(100, Math.max(0, value))

  const trackWidth = useRef(0)
  const animWidth = useRef(new Animated.Value(0)).current
  // Skip animation on the very first useEffect run — onLayout handles that
  const hasAnimated = useRef(false)

  useEffect(() => {
    if (!animated) return
    if (!hasAnimated.current) {
      hasAnimated.current = true
      return
    }
    if (trackWidth.current === 0) return
    Animated.timing(animWidth, {
      toValue: (pct / 100) * trackWidth.current,
      duration: 600,
      useNativeDriver: false,
    }).start()
  }, [pct, animated])

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width
    if (w === 0) return
    trackWidth.current = w
    if (!animated) return
    Animated.timing(animWidth, {
      toValue: (pct / 100) * w,
      duration: 800,
      useNativeDriver: false,
    }).start()
  }

  return (
    <View style={styles.wrapper}>
      {(label || showPercent) && (
        <View style={styles.row}>
          {label && <Text style={styles.label}>{label}</Text>}
          {showPercent && <Text style={styles.pct}>{Math.round(pct)}%</Text>}
        </View>
      )}
      <View
        style={{ height, borderRadius, backgroundColor: trackColor, overflow: 'hidden', width: '100%' }}
        onLayout={handleLayout}
      >
        {animated ? (
          <Animated.View
            style={{ width: animWidth, height, borderRadius, backgroundColor: resolvedFill }}
          />
        ) : (
          <View
            style={{ width: `${pct}%`, height, borderRadius, backgroundColor: resolvedFill }}
          />
        )}
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
})
