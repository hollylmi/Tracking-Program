import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'

interface Action {
  label: string
  onPress: () => void
}

interface Props {
  icon?: string
  title: string
  subtitle?: string
  /** @deprecated use subtitle instead */
  message?: string
  action?: Action
}

export default function EmptyState({ icon, title, subtitle, message, action }: Props) {
  const body = subtitle ?? message
  return (
    <View style={styles.container}>
      {icon && <Text style={styles.icon}>{icon}</Text>}
      <Text style={styles.title}>{title}</Text>
      {body && <Text style={styles.subtitle}>{body}</Text>}
      {action && (
        <TouchableOpacity style={styles.actionBtn} onPress={action.onPress} activeOpacity={0.85}>
          <Text style={styles.actionText}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  icon: {
    fontSize: 48,
    marginBottom: Spacing.sm,
  },
  title: {
    ...Typography.h3,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  subtitle: {
    ...Typography.body,
    color: Colors.textLight,
    textAlign: 'center',
  },
  actionBtn: {
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  actionText: {
    ...Typography.h4,
    color: Colors.dark,
  },
})
