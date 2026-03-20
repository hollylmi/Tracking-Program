import { useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { api } from '../lib/api'
import { useAuthStore } from '../store/auth'
import { useProjectStore } from '../store/project'
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme'

export default function LoginScreen() {
  const router = useRouter()
  const { login } = useAuthStore()
  const { setActiveProject } = useProjectStore()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const passwordRef = useRef<TextInput>(null)

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError('Please enter your username and password.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      // Step 1: get tokens
      const { data: tokenData } = await api.auth.login(username.trim(), password)

      // Step 2: set token in store so the interceptor can attach it to the /me call
      await login(tokenData.access_token, tokenData.refresh_token, {
        ...tokenData.user,
        accessible_projects: [],
      })

      // Step 3: fetch full user with accessible_projects
      const { data: fullUser } = await api.auth.me()

      // Step 4: overwrite store with complete user object
      await login(tokenData.access_token, tokenData.refresh_token, fullUser)

      // Step 5: auto-select project if user has exactly one
      if (fullUser.accessible_projects.length === 1) {
        const p = fullUser.accessible_projects[0]
        setActiveProject({
          id: p.id,
          name: p.name,
          start_date: null,
          active: true,
          quoted_days: null,
          hours_per_day: null,
        })
      }

      router.replace('/(tabs)')
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Login failed. Please try again.'
      setError(message)
      // Clear any partial auth state so the user isn't stuck half-authenticated
      await useAuthStore.getState().logout()
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand header */}
        <View style={styles.header}>
          <Text style={styles.symbol}>P/</Text>
          <Text style={styles.brand}>PLYTRACK</Text>
          <Text style={styles.tagline}>Construction Site Management</Text>
        </View>

        {/* Login card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign In</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Enter username"
              placeholderTextColor={Colors.textLight}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              editable={!loading}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              ref={passwordRef}
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Enter password"
              placeholderTextColor={Colors.textLight}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              editable={!loading}
            />
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={Colors.dark} size="small" />
            ) : (
              <Text style={styles.buttonText}>SIGN IN</Text>
            )}
          </TouchableOpacity>

          {error && <Text style={styles.error}>{error}</Text>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.dark,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  symbol: {
    fontSize: 48,
    fontWeight: '700',
    color: Colors.primary,
    lineHeight: 54,
  },
  brand: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 4,
    marginTop: Spacing.xs,
  },
  tagline: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  cardTitle: {
    ...Typography.h3,
    color: Colors.textPrimary,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  field: {
    marginBottom: Spacing.md,
  },
  label: {
    ...Typography.label,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm + 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    ...Typography.body,
    color: Colors.textPrimary,
  },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    ...Typography.h4,
    color: Colors.dark,
    letterSpacing: 1,
  },
  error: {
    ...Typography.bodySmall,
    color: Colors.error,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
})
