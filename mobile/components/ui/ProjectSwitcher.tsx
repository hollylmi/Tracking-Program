import { useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TouchableWithoutFeedback,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { saveReferenceData, getReferenceData } from '../../lib/db'
import { useAuthStore } from '../../store/auth'
import { useProjectStore } from '../../store/project'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../constants/theme'

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

    try {
      const { data } = await api.projects.detail(projectId)
      try { saveReferenceData(`project_${projectId}`, data) } catch {}
      setActiveProject(data)
    } catch (e) {
      console.warn('Failed to fetch project details:', e)
      const cached = getReferenceData(`project_${projectId}`)
      if (cached) setActiveProject(cached as any)
    } finally {
      setSwitching(false)
      queryClient.invalidateQueries()
    }
  }

  const projectName = activeProject?.name ?? 'Select project'

  // Filter: only show operational projects (not planning-stage)
  const operationalProjects = (user?.accessible_projects ?? []).filter((p: any) => {
    const status = p.status || (p.active ? 'active' : 'completed')
    return status === 'active'
  })

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
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalContainer}>
          {/* Tappable backdrop to dismiss */}
          <TouchableWithoutFeedback onPress={() => setOpen(false)}>
            <View style={styles.backdrop} />
          </TouchableWithoutFeedback>

          {/* Sheet content — NOT inside the backdrop pressable */}
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Switch Project</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {operationalProjects.map((p: any) => {
                const isActive = p.id === activeProject?.id
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.option, isActive && styles.optionActive]}
                    onPress={() => handleSwitch(p.id)}
                    activeOpacity={0.6}
                  >
                    <View style={[styles.dot, { backgroundColor: isActive ? Colors.primary : '#28a745' }]} />
                    <Text style={[styles.optionText, isActive && styles.optionTextActive]} numberOfLines={2}>
                      {p.name}
                    </Text>
                    {isActive && <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />}
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setOpen(false)} activeOpacity={0.7}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
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
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(26,10,16,0.5)',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingBottom: Spacing.xxl + 10,
    ...Shadows.md,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
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
    paddingVertical: Spacing.md + 2,
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
  cancelBtn: {
    marginTop: Spacing.sm,
    marginHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.backgroundSecondary,
    alignItems: 'center',
  },
  cancelText: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
})
