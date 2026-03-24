import { View, ActivityIndicator, Text, StyleSheet } from 'react-native'
import { Colors, Typography, Spacing } from '../../constants/theme'

interface Props {
  fullScreen?: boolean
  size?: 'small' | 'large'
  color?: string
  message?: string
}

export default function LoadingSpinner({
  fullScreen = false,
  size = 'large',
  color = Colors.primary,
  message,
}: Props) {
  const content = (
    <>
      <ActivityIndicator size={size} color={color} />
      {message && <Text style={styles.message}>{message}</Text>}
    </>
  )

  if (fullScreen) {
    return <View style={styles.fullScreen}>{content}</View>
  }
  return <View style={styles.inline}>{content}</View>
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    backgroundColor: Colors.dark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inline: {
    alignItems: 'center',
  },
  message: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
  },
})
