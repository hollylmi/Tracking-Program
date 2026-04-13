import { useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { saveReferenceData, getReferenceData } from '../../lib/db'
import { useAuthStore } from '../../store/auth'
import { useProjectStore } from '../../store/project'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../constants/theme'

/**
 * Compact project-switcher button + modal.
 * Drop it into any screen header or layout to let users change the active project.
 *
 * `variant`:
 *   - "pill"   (default) — shows project name in a tappable pill (good for tab headers)
 *   - "header" — larger touch target for use inside ScreenHeader's `right` slot
 */
export default function ProjectSwitcher({ variant = 'pill' }: { variant?: 'pill' | 'header' }) {
  const user = useAuthStore((s) => s.user)
  const { activeProject, setActiveProject } = useProjectStore()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const queryClient = useQueryClient()

  const projectCount = user?.accessible_projects?.length ?? 0
  if (projectCount === 0) return null

  const handleSwitch = async (projectId: number) => {
    if (projectId === activeProject?.id) { setOpen(false); return }
    setOpen(false)
    setSwitching(true)

    // First set a minimal project immediately so the UI updates
    const p = user?.accessible_projects?.find((x) => x.id === projectId)
    if (p) {
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

    // Then try to fetch full project details in the background
    try {
      const { data } = await api.projects.detail(projectId)
      try { saveReferenceData(`project_${projectId}`, data) } catch {}
      setActiveProject(data)
    } catch (e) {
      console.warn('Failed to fetch project details, using cached/minimal:', e)
      const cached = getReferenceData(`project_${projectId}`)
      if (cached) setActiveProject(cached as any)
    } finally {
      setSwitching(false)
      queryClient.invalidateQueries()
    }
  }

  const projectName = activeProject?.name ?? 'Select project'

  return (
    <>
      <TouchableOpacity
        style={variant === 'pill' ? styles.pill : styles.headerBtn}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
      >
        {switching ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <>
            <Text
              style={variant === 'pill' ? styles.pillText : styles.headerText}
              numberOfLines={1}
            >
              {projectName}
            </Text>
            <Ionicons name="chevron-down" size={14} color={Colors.primary} />
          </>
        )}
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Switch Project</Text>
            {user?.accessible_projects?.map((p: any) => {
              const isActive = p.id === activeProject?.id
              const status = p.status || (p.active ? 'active' : 'completed')
              const statusColor = status === 'active' ? '#28a745' : status === 'planning' ? '#17a2b8' : '#6c757d'
              const statusLabel = status === 'active' ? 'Active' : status === 'planning' ? 'Planning' : 'Completed'
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.option, isActive && styles.optionActive]}
                  onPress={() => handleSwitch(p.id)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.dot, { backgroundColor: isActive ? Colors.primary : statusColor }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionText, isActive && styles.optionTextActive]} numberOfLines={2}>
                      {p.name}
                    </Text>
                    <Text style={{ fontSize: 10, color: statusColor, fontWeight: '600' }}>{statusLabel}</Text>
                  </View>
                  {isActive && <Ionicons name="checkmark-circle" size={18} color={Colors.primary} />}
                </TouchableOpacity>
              )
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  // Pill variant (compact, for tab bar header areas)
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,183,197,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,183,197,0.25)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 5,
    maxWidth: 200,
  },
  pillText: {
    ...Typography.caption,
    color: Colors.primary,
    fontWeight: '600',
    flexShrink: 1,
  },

  // Header variant (for ScreenHeader right slot)
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  headerText: {
    ...Typography.bodySmall,
    color: Colors.primary,
    fontWeight: '600',
    maxWidth: 120,
  },

  // Modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(26,10,16,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingBottom: Spacing.xxl,
    ...Shadows.md,
  },
  sheetTitle: {
    ...Typography.h4,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontSize: 11,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  optionActive: {
    backgroundColor: 'rgba(255,183,197,0.08)',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  optionText: {
    ...Typography.body,
    color: Colors.textPrimary,
    flex: 1,
  },
  optionTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
})
