import { View, Text, StyleSheet, TouchableOpacity, ActionSheetIOS, Platform, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { useAuthStore } from '../../store/auth'
import { useProjectStore } from '../../store/project'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { useSyncStatus } from '../../hooks/useSyncStatus'
import { api } from '../../lib/api'
import Logo from '../../assets/logo.svg'

interface Props {
  title: string
  subtitle?: string
  showBack?: boolean
  right?: React.ReactNode
  hideProject?: boolean
}

export default function ScreenHeader({ title, subtitle, showBack = false, right, hideProject = false }: Props) {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const { activeProject, setActiveProject } = useProjectStore()
  const isOnline = useNetworkStatus()
  const { pending } = useSyncStatus()
  const queryClient = useQueryClient()

  // Only operational projects
  const operationalProjects = (user?.accessible_projects ?? []).filter((p: any) => {
    const status = p.status || (p.active ? 'active' : 'completed')
    return status === 'active'
  })

  const handleSwitchProject = () => {
    if (operationalProjects.length <= 1) return
    const names = operationalProjects.map((p: any) => p.name)
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...names, 'Cancel'], cancelButtonIndex: names.length, title: 'Switch Project' },
        (idx) => { if (idx < names.length) doSwitch(operationalProjects[idx]) }
      )
    } else {
      Alert.alert('Switch Project', undefined,
        [...operationalProjects.map((p: any) => ({ text: p.name, onPress: () => doSwitch(p) })),
         { text: 'Cancel', style: 'cancel' as const }]
      )
    }
  }

  const doSwitch = async (p: any) => {
    setActiveProject({
      id: p.id, name: p.name, start_date: null, active: true,
      quoted_days: null, hours_per_day: null, site_address: null,
      site_contact: null, track_by_lot: false,
    })
    try {
      const { data } = await api.projects.detail(p.id)
      setActiveProject(data)
    } catch {}
    queryClient.invalidateQueries()
  }

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => { logout(); router.replace('/login') } },
    ])
  }

  return (
    <View style={styles.container}>
      {/* Row 1: Logo + Project Pill + Status icons */}
      <View style={styles.topRow}>
        <View style={styles.logoWrap}>
          {showBack ? (
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-back" size={22} color={Colors.white} />
            </TouchableOpacity>
          ) : (
            <Logo width={48} height={24} />
          )}
        </View>

        {/* Project pill — center */}
        {!hideProject && activeProject && (
          <TouchableOpacity
            style={styles.pill}
            onPress={handleSwitchProject}
            activeOpacity={operationalProjects.length > 1 ? 0.7 : 1}
            hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          >
            <Text style={styles.pillText} numberOfLines={1}>{activeProject.name}</Text>
            {operationalProjects.length > 1 && (
              <Ionicons name="chevron-down" size={12} color={Colors.primary} />
            )}
          </TouchableOpacity>
        )}

        {/* Right: online status + logout */}
        <View style={styles.rightIcons}>
          {!isOnline ? (
            <View style={styles.statusBadge}>
              <Ionicons name="cloud-offline-outline" size={14} color={Colors.warning} />
              {pending > 0 && <Text style={styles.pendingText}>{pending}</Text>}
            </View>
          ) : (
            <View style={[styles.onlineDot, { backgroundColor: '#28a745' }]} />
          )}
          <TouchableOpacity onPress={handleLogout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="log-out-outline" size={20} color="rgba(255,255,255,0.5)" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Row 2: Title */}
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}> — {subtitle}</Text>}
        {right && <View style={styles.rightSlot}>{right}</View>}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.dark,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xs,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 36,
  },
  logoWrap: {
    width: 50,
  },
  backBtn: {
    paddingVertical: 2,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,183,197,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,183,197,0.3)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    marginHorizontal: Spacing.sm,
    maxWidth: 240,
  },
  pillText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '700',
    flexShrink: 1,
  },
  rightIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    width: 50,
    justifyContent: 'flex-end',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  pendingText: {
    fontSize: 10,
    color: Colors.warning,
    fontWeight: '700',
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
  },
  title: {
    ...Typography.h4,
    color: Colors.white,
    fontSize: 16,
  },
  subtitle: {
    ...Typography.caption,
    color: 'rgba(255,255,255,0.5)',
  },
  rightSlot: {
    marginLeft: 'auto',
  },
})
