import { useState, forwardRef } from 'react'
import { TextInput, View, Text, StyleSheet, TextInputProps } from 'react-native'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'

interface Props extends TextInputProps {
  label?: string
  error?: string
}

const AppInput = forwardRef<TextInput, Props>(function AppInput(
  { label, error, style, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false)

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        ref={ref}
        style={[styles.input, focused && styles.focused, !!error && styles.errored, style]}
        placeholderTextColor={Colors.textLight}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
})

export default AppInput

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.sm },
  label: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 5,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    ...Typography.body,
    color: Colors.textPrimary,
  },
  focused: {
    borderColor: Colors.primary,
    borderWidth: 1.5,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  errored: {
    borderColor: Colors.error,
  },
  error: {
    ...Typography.bodySmall,
    color: Colors.error,
    marginTop: 4,
  },
})
