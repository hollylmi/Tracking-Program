import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { useSyncStatus } from '../../hooks/useSyncStatus'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'

export function OfflineBanner() {
  const isOnline = useNetworkStatus()
  const { pending } = useSyncStatus()

  if (isOnline) return null

  return (
    <View style={styles.banner}>
      <Ionicons name="cloud-offline-outline" size={16} color={Colors.warning} />
      <Text style={styles.text}>
        You're offline
        {pending > 0 && ` · ${pending} pending`}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    backgroundColor: 'rgba(201, 106, 0, 0.12)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(201, 106, 0, 0.25)',
  },
  text: {
    ...Typography.bodySmall,
    color: Colors.warning,
  },
})
