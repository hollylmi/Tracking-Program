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
  Dimensions,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api, resetRefreshState } from '../lib/api'
import { API_BASE_URL } from '../constants/api'
import { useAuthStore } from '../store/auth'
import { useProjectStore } from '../store/project'
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme'
import Logo from '../assets/logo.svg'

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')

// ─── Focused input wrapper ────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  returnKeyType,
  onSubmitEditing,
  editable,
  inputRef,
}: {
  label: string
  value: string
  onChangeText: (v: string) => void
  placeholder: string
  secureTextEntry?: boolean
  returnKeyType?: 'next' | 'done'
  onSubmitEditing?: () => void
  editable?: boolean
  inputRef?: React.RefObject<TextInput>
}) {
  const [hidden, setHidden] = useState(secureTextEntry ?? false)

  return (
    <View style={fieldSt.wrap}>
      <Text style={fieldSt.label}>{label}</Text>
      <View style={fieldSt.row}>
        <TextInput
          ref={inputRef}
          style={fieldSt.input}
          value={value}
          onChangeText={onChangeText}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={placeholder}
          placeholderTextColor={Colors.textLight}
          secureTextEntry={hidden}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          editable={editable}
        />
        {secureTextEntry && (
          <TouchableOpacity
            onPress={() => setHidden(h => !h)}
            style={fieldSt.eye}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={hidden ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={Colors.textLight}
            />
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

const fieldSt = StyleSheet.create({
  wrap: { marginBottom: Spacing.md },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
  },
  rowFocused: {
    borderColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  input: {
    flex: 1,
    ...Typography.body,
    color: Colors.textPrimary,
    paddingVertical: Spacing.sm + 4,
  },
  eye: {
    paddingLeft: Spacing.sm,
  },
})

// ─── Main screen ──────────────────────────────────────────────────────────────

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

    // Clear any stale refresh state from previous session
    resetRefreshState()

    try {
      // Step 1: Authenticate
      console.log('Attempting login to:', API_BASE_URL)
      const { data: tokenData } = await api.auth.login(username.trim(), password)
      await login(tokenData.access_token, tokenData.refresh_token, {
        ...tokenData.user,
        accessible_projects: [],
      })

      // Step 2: Fetch full user profile (with accessible projects)
      try {
        const { data: fullUser } = await api.auth.me()
        await login(tokenData.access_token, tokenData.refresh_token, fullUser)

        if (fullUser.accessible_projects?.length > 0) {
          const p = fullUser.accessible_projects[0]
          setActiveProject({
            id: p.id,
            name: p.name,
            start_date: null,
            active: true,
            quoted_days: null,
            hours_per_day: null,
            site_address: null,
            site_contact: null,
            track_by_lot: false,
          })
        }
      } catch {
        // /auth/me failed but login succeeded — continue with basic user info
        console.warn('Failed to fetch full user profile, continuing with basic info')
      }

      router.replace('/(tabs)')
    } catch (err: unknown) {
      console.error('Login error:', JSON.stringify(err, Object.getOwnPropertyNames(err as object), 2))
      const axiosErr = err as { response?: { status?: number; data?: { error?: string } }; code?: string; message?: string }
      const status = axiosErr?.response?.status
      const message =
        axiosErr?.response?.data?.error ||
        (status === 401 ? 'Invalid username or password.' :
         `Connection error (${axiosErr?.code || axiosErr?.message || 'unknown'}). API: ${API_BASE_URL}`)
      setError(message)
      // Only logout if we actually had tokens set (login partially succeeded)
      if (useAuthStore.getState().accessToken) {
        await useAuthStore.getState().logout()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* ── Background shading layers ── */}
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="always"
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Brand ── */}
        <View style={styles.brand}>
          <View style={styles.logoHalo}>
            <Logo width={180} height={96} />
          </View>
          <Text style={styles.wordmark}>PLYTRACK</Text>
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <View style={styles.dividerDot} />
            <View style={styles.dividerLine} />
          </View>
          <Text style={styles.tagline}>Geosynthetic Installation Management</Text>
        </View>

        {/* ── Card ── */}
        <View style={styles.card}>
          {/* Card top accent bar */}
          <View style={styles.cardAccent} />

          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Sign In</Text>
            <Text style={styles.cardSub}>Enter your credentials to continue</Text>

            <View style={styles.fields}>
              <Field
                label="Username"
                value={username}
                onChangeText={setUsername}
                placeholder="Enter your username"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                editable={!loading}
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                editable={!loading}
                inputRef={passwordRef}
              />
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={15} color={Colors.error} style={{ marginRight: 6 }} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.88}
            >
              {loading ? (
                <ActivityIndicator color={Colors.dark} size="small" />
              ) : (
                <>
                  <Text style={styles.buttonText}>SIGN IN</Text>
                  <Ionicons name="arrow-forward" size={16} color={Colors.dark} style={{ marginLeft: 8 }} />
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Footer ── */}
        <Text style={styles.footer}>© Plytrack · LMI Group Pty Ltd</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Background glow blobs
  glowTop: {
    position: 'absolute',
    top: -SCREEN_H * 0.15,
    left: SCREEN_W * 0.5 - SCREEN_H * 0.35,
    width: SCREEN_H * 0.7,
    height: SCREEN_H * 0.7,
    borderRadius: SCREEN_H * 0.35,
    backgroundColor: Colors.primary,
    opacity: 0.07,
  },
  glowBottom: {
    position: 'absolute',
    bottom: -SCREEN_H * 0.2,
    right: -SCREEN_W * 0.2,
    width: SCREEN_H * 0.55,
    height: SCREEN_H * 0.55,
    borderRadius: SCREEN_H * 0.275,
    backgroundColor: '#A6E6FC',
    opacity: 0.05,
  },

  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xxl,
  },

  // Brand block
  brand: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
    width: '100%',
  },
  logoHalo: {
    width: 180,
    height: 62,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    overflow: 'hidden',
    marginBottom: Spacing.sm,
  },
  wordmark: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: 8,
    marginBottom: Spacing.md,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 120,
    marginBottom: Spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.primary,
    opacity: 0.3,
  },
  dividerDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.primary,
    opacity: 0.5,
    marginHorizontal: 6,
  },
  tagline: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.textSecondary,
    letterSpacing: 0.8,
    textAlign: 'center',
  },

  // Card
  card: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  cardAccent: {
    height: 3,
    backgroundColor: Colors.primary,
    opacity: 0.8,
  },
  cardBody: {
    padding: Spacing.lg,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 4,
  },
  cardSub: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  fields: {
    marginBottom: Spacing.sm,
  },

  // Error
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(244,67,54,0.1)',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(244,67,54,0.2)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.md,
  },
  errorText: {
    ...Typography.bodySmall,
    color: Colors.error,
    flex: 1,
  },

  // Button
  button: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 5,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.dark,
    letterSpacing: 2.5,
  },

  // Footer
  footer: {
    ...Typography.caption,
    color: Colors.textLight,
    textAlign: 'center',
    marginTop: Spacing.xl,
    letterSpacing: 0.5,
  },
})
