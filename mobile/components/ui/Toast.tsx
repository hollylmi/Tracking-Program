import { useEffect, useRef } from 'react'
import { Animated, Text, StyleSheet } from 'react-native'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'

interface Props {
  visible: boolean
  message: string
  type?: 'success' | 'warning' | 'error'
  onHide: () => void
}

export default function Toast({ visible, message, type = 'success', onHide }: Props) {
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!visible) return
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(2500),
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => onHide())
  }, [visible])

  if (!visible) return null

  const bg =
    type === 'success' ? Colors.success
    : type === 'warning' ? Colors.warning
    : Colors.error

  return (
    <Animated.View style={[styles.container, { backgroundColor: bg, opacity }]}>
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 40,
    left: Spacing.lg,
    right: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    zIndex: 9999,
  },
  text: {
    ...Typography.body,
    color: Colors.white,
    textAlign: 'center',
  },
})
