import { useEffect, useRef } from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import Card from '../../components/ui/Card'
import ProgressBar from '../../components/ui/ProgressBar'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { useAuthStore } from '../../store/auth'
import { useProjectStore } from '../../store/project'
import { useProject } from '../../hooks/useProject'
import { useEntries } from '../../hooks/useEntries'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { api } from '../../lib/api'
import { Entry, ProgressTask } from '../../types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

function getToday(): string {
  return new Date().toISOString().split('T')[0]
}

function getWeekBounds(): { start: string; end: string } {
  const now = new Date()
  const day = now.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const mon = new Date(now)
  mon.setDate(now.getDate() + diffToMon)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  return { start: fmt(mon), end: fmt(sun) }
}

function sortTasks(tasks: ProgressTask[]): ProgressTask[] {
  return [...tasks].sort((a, b) => {
    const aComplete = a.pct_complete >= 100
    const bComplete = b.pct_complete >= 100
    if (aComplete !== bComplete) return aComplete ? 1 : -1
    return a.lot.localeCompare(b.lot, undefined, { numeric: true })
  })
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SkeletonBox({ height, style }: { height: number; style?: object }) {
  return (
    <View
      style={[{ height, borderRadius: BorderRadius.md, backgroundColor: Colors.surface }, style]}
    />
  )
}

function SkeletonLoading() {
  return (
    <>
      <Card style={styles.sectionCard}>
        <SkeletonBox height={14} style={{ width: '45%', marginBottom: Spacing.xs }} />
        <SkeletonBox height={36} style={{ width: '28%', alignSelf: 'flex-end', marginBottom: Spacing.sm }} />
        <SkeletonBox height={12} style={{ marginBottom: Spacing.md }} />
        <View style={{ flexDirection: 'row', gap: Spacing.md }}>
          <SkeletonBox height={50} style={{ flex: 1 }} />
          <SkeletonBox height={50} style={{ flex: 1 }} />
          <SkeletonBox height={50} style={{ flex: 1 }} />
        </View>
      </Card>
      <View style={styles.todayRow}>
        <Card style={styles.todayCard}>
          <SkeletonBox height={12} style={{ width: '55%', marginBottom: Spacing.sm }} />
          <SkeletonBox height={30} style={{ width: '70%' }} />
        </Card>
        <View style={styles.todayGap} />
        <Card style={styles.todayCard}>
          <SkeletonBox height={12} style={{ width: '55%', marginBottom: Spacing.sm }} />
          <SkeletonBox height={30} style={{ width: '70%' }} />
        </Card>
      </View>
      <Card style={styles.sectionCard}>
        <SkeletonBox height={14} style={{ width: '40%', marginBottom: Spacing.md }} />
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ gap: 6, marginBottom: Spacing.md }}>
            <SkeletonBox height={12} style={{ width: '65%' }} />
            <SkeletonBox height={6} />
          </View>
        ))}
      </Card>
    </>
  )
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <Card style={styles.sectionCard}>
      <Text style={styles.sectionLabel}>UNABLE TO LOAD PROJECT</Text>
      <Text style={[styles.emptyText, { marginTop: Spacing.xs, marginBottom: Spacing.md }]}>
        Check your connection and try again.
      </Text>
      <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.85}>
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    </Card>
  )
}

function ProgressCard({
  progress,
  isLoading,
}: {
  progress?: {
    overall_pct: number
    total_planned: number
    total_actual: number
    total_remaining: number
  }
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <Card style={styles.sectionCard}>
        <SkeletonBox height={14} style={{ width: '45%', marginBottom: Spacing.xs }} />
        <SkeletonBox height={36} style={{ width: '28%', alignSelf: 'flex-end', marginBottom: Spacing.sm }} />
        <SkeletonBox height={12} style={{ marginBottom: Spacing.md }} />
        <View style={{ flexDirection: 'row', gap: Spacing.md }}>
          <SkeletonBox height={50} style={{ flex: 1 }} />
          <SkeletonBox height={50} style={{ flex: 1 }} />
          <SkeletonBox height={50} style={{ flex: 1 }} />
        </View>
      </Card>
    )
  }

  if (!progress) {
    return (
      <Card style={styles.sectionCard}>
        <Text style={styles.sectionLabel}>OVERALL PROGRESS</Text>
        <Text style={styles.emptyText}>No progress data recorded yet.</Text>
      </Card>
    )
  }

  return (
    <Card style={styles.sectionCard}>
      <View style={styles.progressHeaderRow}>
        <Text style={styles.sectionLabel}>OVERALL PROGRESS</Text>
        <Text style={styles.progressPct}>{Math.round(progress.overall_pct)}%</Text>
      </View>
      <ProgressBar
        value={progress.overall_pct}
        showPercent={false}
        height={12}
        fillColor={Colors.primary}
        trackColor={Colors.surface}
        animated
      />
      <View style={styles.progressStatRow}>
        <View style={styles.progressStatCell}>
          <Text style={styles.progressStatNum}>{progress.total_actual.toLocaleString()}</Text>
          <Text style={styles.progressStatCaption}>Installed m²</Text>
        </View>
        <View style={styles.progressStatDivider} />
        <View style={styles.progressStatCell}>
          <Text style={styles.progressStatNum}>{progress.total_remaining.toLocaleString()}</Text>
          <Text style={styles.progressStatCaption}>Remaining m²</Text>
        </View>
        <View style={styles.progressStatDivider} />
        <View style={styles.progressStatCell}>
          <Text style={styles.progressStatNum}>{progress.total_planned.toLocaleString()}</Text>
          <Text style={styles.progressStatCaption}>Planned m²</Text>
        </View>
      </View>
    </Card>
  )
}

function TodayCard({ label, sqm, isLoading }: { label: string; sqm: number; isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card style={styles.todayCard}>
        <SkeletonBox height={12} style={{ width: '55%', marginBottom: Spacing.sm }} />
        <SkeletonBox height={30} style={{ width: '70%' }} />
      </Card>
    )
  }
  return (
    <Card style={styles.todayCard}>
      <Text style={styles.todayLabel}>{label}</Text>
      <Text style={styles.todayNum}>
        {sqm.toLocaleString()}
        <Text style={styles.todaySuffix}> m²</Text>
      </Text>
    </Card>
  )
}

function LotBreakdown({ tasks, isLoading }: { tasks?: ProgressTask[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card style={styles.sectionCard}>
        <SkeletonBox height={14} style={{ width: '40%', marginBottom: Spacing.md }} />
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ gap: 6, marginBottom: Spacing.md }}>
            <SkeletonBox height={12} style={{ width: '65%' }} />
            <SkeletonBox height={6} />
          </View>
        ))}
      </Card>
    )
  }

  if (!tasks || tasks.length === 0) {
    return (
      <Card style={styles.sectionCard}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.sectionLabel}>LOT PROGRESS</Text>
        </View>
        <Text style={styles.emptyText}>No planned data uploaded for this project.</Text>
      </Card>
    )
  }

  const sorted = sortTasks(tasks)

  return (
    <Card style={styles.sectionCard}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.sectionLabel}>LOT PROGRESS</Text>
        <Text style={styles.headerCount}>{tasks.length} lots</Text>
      </View>
      {sorted.map((task, i) => (
        <View key={`${task.lot}-${task.material}`}>
          {i > 0 && <View style={styles.rowDivider} />}
          <View style={styles.lotRow}>
            <View style={styles.lotRowTop}>
              <Text style={styles.lotLabel} numberOfLines={1}>
                Lot {task.lot} — {task.material}
              </Text>
              <Text style={styles.lotPct}>{Math.round(task.pct_complete)}%</Text>
            </View>
            <ProgressBar
              value={task.pct_complete}
              showPercent={false}
              height={6}
              borderRadius={3}
              fillColor={Colors.primary}
              trackColor={Colors.surface}
              animated
            />
          </View>
        </View>
      ))}
    </Card>
  )
}

function RecentEntries({
  entries,
  isLoading,
  onSeeAll,
  onEntryPress,
}: {
  entries: Entry[]
  isLoading: boolean
  onSeeAll: () => void
  onEntryPress: (id: number) => void
}) {
  return (
    <View style={styles.recentSection}>
      <View style={styles.recentHeaderRow}>
        <Text style={styles.sectionLabel}>RECENT ENTRIES</Text>
        <TouchableOpacity onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.seeAll}>See all →</Text>
        </TouchableOpacity>
      </View>
      <Card padding="none">
        {isLoading ? (
          <View style={{ padding: Spacing.md, gap: Spacing.md }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ gap: 6 }}>
                <SkeletonBox height={12} style={{ width: '65%' }} />
                <SkeletonBox height={10} style={{ width: '45%' }} />
              </View>
            ))}
          </View>
        ) : entries.length === 0 ? (
          <View style={{ padding: Spacing.md }}>
            <Text style={styles.emptyText}>No entries yet.</Text>
          </View>
        ) : (
          entries.map((entry, i) => (
            <View key={entry.id}>
              {i > 0 && <View style={styles.rowDivider} />}
              <TouchableOpacity
                onPress={() => onEntryPress(entry.id)}
                activeOpacity={0.85}
                style={styles.entryRow}
              >
                <View style={styles.entryTopRow}>
                  <Text style={styles.entryDate}>{formatDate(entry.date)}</Text>
                  {(entry.lot_number || entry.material) && (
                    <Text style={styles.entryLotMat} numberOfLines={1}>
                      {[entry.lot_number, entry.material].filter(Boolean).join(' — ')}
                    </Text>
                  )}
                </View>
                <View style={styles.entryStatsRow}>
                  <Text style={styles.entryStat}>{entry.install_hours}h</Text>
                  <Text style={styles.entryDot}>·</Text>
                  <Text style={styles.entryStat}>{entry.install_sqm} m²</Text>
                  <Text style={styles.entryDot}>·</Text>
                  <Text style={styles.entryStat}>{entry.num_people} crew</Text>
                  {entry.delay_hours > 0 && (
                    <View style={styles.delayBadge}>
                      <Text style={styles.delayText}>⚠ {entry.delay_hours}h delay</Text>
                    </View>
                  )}
                  {entry.photo_count > 0 && (
                    <View style={styles.photoBadge}>
                      <Ionicons name="camera-outline" size={11} color={Colors.textSecondary} />
                      <Text style={styles.photoCount}>{entry.photo_count}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            </View>
          ))
        )}
      </Card>
    </View>
  )
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const { activeProject, setActiveProject, setAvailableProjects } = useProjectStore()
  const isOnline = useNetworkStatus()

  useEffect(() => {
    if (user?.accessible_projects?.length) {
      setAvailableProjects(user.accessible_projects)
    }
  }, [user])

  useEffect(() => {
    if (!activeProject && user?.accessible_projects?.length) {
      api.projects.detail(user.accessible_projects[0].id).then((r) => {
        setActiveProject(r.data)
      })
    }
  }, [activeProject, user])

  const {
    data: project,
    isLoading: projectLoading,
    error: projectError,
    refetch,
  } = useProject()

  const { data: entriesData, isLoading: entriesLoading } = useEntries(
    activeProject ? { per_page: 50 } : undefined
  )

  const allEntries = entriesData?.entries ?? []
  const recentEntries = allEntries.slice(0, 5)

  const today = getToday()
  const { start: weekStart, end: weekEnd } = getWeekBounds()

  const todaySqm = allEntries
    .filter((e) => e.date === today)
    .reduce((sum, e) => sum + (e.install_sqm || 0), 0)

  const weekSqm = allEntries
    .filter((e) => e.date >= weekStart && e.date <= weekEnd)
    .reduce((sum, e) => sum + (e.install_sqm || 0), 0)

  const projectName = project?.name ?? activeProject?.name ?? 'Plytrack'
  const hasMultipleProjects = (user?.accessible_projects?.length ?? 0) > 1
  const isInitialLoading = !activeProject && !!user?.accessible_projects?.length

  const handleLogout = () => {
    useAuthStore.getState().logout()
    router.replace('/login')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {projectName}
          </Text>
          {hasMultipleProjects && (
            <Ionicons
              name="chevron-down"
              size={15}
              color={Colors.textSecondary}
              style={{ marginLeft: 4 }}
            />
          )}
        </View>
        <View style={styles.headerRight}>
          <View
            style={[
              styles.networkDot,
              { backgroundColor: isOnline ? '#5A5A5A' : Colors.warning },
            ]}
          />
          <TouchableOpacity
            onPress={handleLogout}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="log-out-outline" size={22} color={Colors.white} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Scrollable body ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* New entry button */}
        <TouchableOpacity
          style={styles.newEntryBtn}
          onPress={() => router.push('/entry/new')}
          activeOpacity={0.85}
        >
          <Ionicons
            name="add-circle-outline"
            size={20}
            color={Colors.dark}
            style={{ marginRight: Spacing.sm }}
          />
          <Text style={styles.newEntryText}>+ NEW DAILY ENTRY</Text>
        </TouchableOpacity>

        {isInitialLoading ? (
          <SkeletonLoading />
        ) : projectError ? (
          <ErrorCard onRetry={refetch} />
        ) : (
          <>
            {/* Overall progress */}
            <ProgressCard progress={project?.progress} isLoading={projectLoading} />

            {/* Today / this week */}
            <View style={styles.todayRow}>
              <TodayCard label="TODAY" sqm={todaySqm} isLoading={entriesLoading} />
              <View style={styles.todayGap} />
              <TodayCard label="THIS WEEK" sqm={weekSqm} isLoading={entriesLoading} />
            </View>

            {/* Lot breakdown */}
            <LotBreakdown tasks={project?.progress?.tasks} isLoading={projectLoading} />

            {/* Recent entries */}
            <RecentEntries
              entries={recentEntries}
              isLoading={entriesLoading}
              onSeeAll={() => router.push('/(tabs)/entries')}
              onEntryPress={(id) => router.push(`/entry/${id}`)}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.dark,
  },

  // Header
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  headerTitle: {
    ...Typography.h4,
    color: Colors.white,
    fontFamily: 'Montserrat_700Bold',
    flexShrink: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  networkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // Scroll
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: Spacing.xxl,
  },

  // New entry button
  newEntryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    height: 52,
    borderRadius: BorderRadius.md,
    margin: Spacing.md,
  },
  newEntryText: {
    ...Typography.h4,
    color: Colors.dark,
    letterSpacing: 1,
    fontFamily: 'Montserrat_600SemiBold',
  },

  // Shared card layout
  sectionCard: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },

  // Progress card
  progressHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: Spacing.sm,
  },
  progressPct: {
    ...Typography.h1,
    color: Colors.dark,
  },
  progressStatRow: {
    flexDirection: 'row',
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  progressStatCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  progressStatDivider: {
    width: 1,
    backgroundColor: Colors.border,
    alignSelf: 'stretch',
  },
  progressStatNum: {
    ...Typography.h3,
    color: Colors.dark,
  },
  progressStatCaption: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: 2,
    textAlign: 'center',
  },

  // Today / week cards
  todayRow: {
    flexDirection: 'row',
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  todayGap: { width: Spacing.sm },
  todayCard: { flex: 1 },
  todayLabel: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.xs,
  },
  todayNum: {
    ...Typography.h2,
    color: Colors.primary,
  },
  todaySuffix: {
    ...Typography.body,
    color: Colors.textSecondary,
  },

  // Section label (shared)
  sectionLabel: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  headerCount: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },

  // Lot rows
  rowDivider: {
    height: 1,
    backgroundColor: Colors.border,
  },
  lotRow: {
    paddingVertical: Spacing.sm,
    gap: 6,
  },
  lotRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lotLabel: {
    ...Typography.bodySmall,
    color: Colors.textPrimary,
    flex: 1,
    marginRight: Spacing.sm,
  },
  lotPct: {
    ...Typography.label,
    color: Colors.textSecondary,
  },

  // Recent entries section
  recentSection: {
    marginHorizontal: Spacing.md,
  },
  recentHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  seeAll: {
    ...Typography.body,
    color: Colors.primary,
    fontFamily: 'Montserrat_600SemiBold',
  },
  entryRow: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  entryTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  entryDate: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
  },
  entryLotMat: {
    ...Typography.bodySmall,
    color: Colors.textPrimary,
    maxWidth: '55%',
  },
  entryStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  entryStat: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  entryDot: {
    ...Typography.caption,
    color: Colors.textLight,
  },
  delayBadge: {
    backgroundColor: '#FFF3E0',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  delayText: {
    ...Typography.caption,
    color: Colors.warning,
    fontWeight: '600',
  },
  photoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  photoCount: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },

  // Misc
  emptyText: {
    ...Typography.body,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  retryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    alignSelf: 'flex-start',
  },
  retryText: {
    ...Typography.body,
    color: Colors.dark,
    fontFamily: 'Montserrat_600SemiBold',
  },
})
