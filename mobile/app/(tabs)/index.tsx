import { useEffect } from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import ScreenHeader from '../../components/layout/ScreenHeader'
import Card from '../../components/ui/Card'
import ProgressBar from '../../components/ui/ProgressBar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { useAuthStore } from '../../store/auth'
import { useProjectStore } from '../../store/project'
import { useProject } from '../../hooks/useProject'
import { useEntries } from '../../hooks/useEntries'
import { api } from '../../lib/api'
import { Entry } from '../../types'

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

function EntryRow({ entry }: { entry: Entry }) {
  return (
    <View style={styles.entryRow}>
      <View style={styles.entryLeft}>
        <Text style={styles.entryDate}>{formatDate(entry.date)}</Text>
        <Text style={styles.entrySub} numberOfLines={1}>
          {[entry.lot_number, entry.material].filter(Boolean).join(' · ') || 'No details'}
        </Text>
      </View>
      <View style={styles.entryRight}>
        <Text style={styles.entryHours}>{entry.install_hours}h</Text>
        <Text style={styles.entryPeople}>{entry.num_people} crew</Text>
      </View>
    </View>
  )
}

export default function DashboardScreen() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const { activeProject, setActiveProject, setAvailableProjects } = useProjectStore()

  // Populate available projects from user session
  useEffect(() => {
    if (user?.accessible_projects?.length) {
      setAvailableProjects(user.accessible_projects)
    }
  }, [user])

  // Auto-select first project if none selected
  useEffect(() => {
    if (!activeProject && user?.accessible_projects?.length) {
      api.projects.detail(user.accessible_projects[0].id).then((r) => {
        setActiveProject(r.data)
      })
    }
  }, [activeProject, user])

  const { data: project, isLoading: projectLoading } = useProject()
  const { data: entriesData, isLoading: entriesLoading } = useEntries(
    activeProject ? { project_id: activeProject.id, per_page: 5 } : undefined
  )

  const progress = project?.progress
  const entries = entriesData?.entries ?? []
  const isLoading = projectLoading || (!activeProject && !!user?.accessible_projects?.length)

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader
        title="Dashboard"
        subtitle={project?.name ?? activeProject?.name ?? 'Plytrack'}
        right={
          <TouchableOpacity
            onPress={() => {
              useAuthStore.getState().logout()
              router.replace('/login')
            }}
          >
            <Text style={styles.logoutBtn}>Logout</Text>
          </TouchableOpacity>
        }
      />

      {isLoading ? (
        <View style={styles.center}>
          <LoadingSpinner message="Loading project..." />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Progress card */}
          {progress ? (
            <Card style={styles.section}>
              <Text style={styles.sectionTitle}>Overall Progress</Text>
              <ProgressBar value={progress.overall_pct} showPercent />
              <View style={styles.statsRow}>
                <StatCell label="Planned" value={`${progress.total_planned.toLocaleString()} m²`} />
                <StatCell label="Installed" value={`${progress.total_actual.toLocaleString()} m²`} />
                <StatCell label="Remaining" value={`${progress.total_remaining.toLocaleString()} m²`} />
              </View>
              {progress.tasks.length > 0 && (
                <View style={styles.tasks}>
                  {progress.tasks.map((t, i) => (
                    <View key={i} style={styles.taskRow}>
                      <Text style={styles.taskLabel} numberOfLines={1}>
                        {t.lot} — {t.material}
                      </Text>
                      <ProgressBar value={t.pct_complete} showPercent height={5} />
                    </View>
                  ))}
                </View>
              )}
            </Card>
          ) : (
            <Card style={styles.section}>
              <Text style={styles.sectionTitle}>Overall Progress</Text>
              <Text style={styles.empty}>No progress data recorded yet.</Text>
            </Card>
          )}

          {/* Recent entries */}
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Entries</Text>
            {entriesLoading ? (
              <LoadingSpinner size="small" />
            ) : entries.length > 0 ? (
              entries.map((entry, i) => (
                <View key={entry.id}>
                  <EntryRow entry={entry} />
                  {i < entries.length - 1 && <View style={styles.divider} />}
                </View>
              ))
            ) : (
              <Text style={styles.empty}>No entries yet.</Text>
            )}
          </Card>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },
  center: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, gap: Spacing.md },
  section: { marginBottom: 0 },
  sectionTitle: {
    ...Typography.h4,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
  },
  statCell: { alignItems: 'center', flex: 1 },
  statValue: { ...Typography.h4, color: Colors.textPrimary },
  statLabel: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  tasks: { marginTop: Spacing.md, gap: Spacing.sm },
  taskRow: { gap: 4 },
  taskLabel: { ...Typography.bodySmall, color: Colors.textSecondary },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  entryLeft: { flex: 1, marginRight: Spacing.sm },
  entryDate: { ...Typography.body, color: Colors.textPrimary },
  entrySub: { ...Typography.bodySmall, color: Colors.textSecondary, marginTop: 2 },
  entryRight: { alignItems: 'flex-end' },
  entryHours: { ...Typography.h4, color: Colors.textPrimary },
  entryPeople: { ...Typography.caption, color: Colors.textSecondary },
  divider: { height: 1, backgroundColor: Colors.border },
  empty: { ...Typography.body, color: Colors.textSecondary },
  logoutBtn: {
    ...Typography.body,
    color: Colors.primary,
    fontFamily: 'Montserrat_600SemiBold',
  },
})
