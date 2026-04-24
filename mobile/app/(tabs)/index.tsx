import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Svg, { Circle as SvgCircle } from 'react-native-svg'
import Card from '../../components/ui/Card'
import ScreenHeader from '../../components/layout/ScreenHeader'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../constants/theme'
import { api } from '../../lib/api'
import { useProjectStore } from '../../store/project'
import { useAuthStore } from '../../store/auth'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { useSyncStatus } from '../../hooks/useSyncStatus'
import { Project, ProjectProgress, ProgressTask } from '../../types'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ProjectListItem {
  id: number
  name: string
  active: boolean
  status?: string
  is_operational?: boolean
}

interface ProjectWithProgress extends ProjectListItem {
  progress: ProjectProgress | null
}

// ─── My Todos Section (supervisor/site users) ─────────────────────────────

function MyTodosSection() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)

  const { data } = useQuery({
    queryKey: ['my-todos'],
    queryFn: () => api.tasks.myTodos().then((r) => r.data),
    staleTime: 60 * 1000,
    enabled: !!user,
  })

  if (!data?.todos?.length) return null

  const todos = data.todos
  const allDone = todos.every((t: any) => t.completed)

  return (
    <Card style={{ marginBottom: Spacing.md, borderLeftWidth: 4, borderLeftColor: allDone ? Colors.success : Colors.warning, overflow: 'hidden' }}>
      <View style={{ paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.sm }}>
        <Text style={{ ...Typography.label, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Your Tasks Today
        </Text>
      </View>
      {allDone && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm }}>
          <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
          <Text style={{ ...Typography.bodySmall, color: Colors.success, fontWeight: '600' }}>All tasks complete for today</Text>
        </View>
      )}
      {todos.map((todo: any, i: number) => (
        <TouchableOpacity
          key={`${todo.project_id}-${todo.task_type}-${todo.check_id || ''}`}
          onPress={() => {
            if (todo.completed) return
            if (todo.task_type === 'daily_entry') router.push('/entry/new')
            else if (todo.task_type === 'machine_startup') router.push('/(tabs)/equipment')
            else if (todo.task_type === 'scheduled_check' && todo.check_id) router.push({ pathname: '/scheduled-check/[id]', params: { id: todo.check_id } })
            else if ((todo.task_type === 'incoming_transfer' || todo.task_type === 'pre_check_transfer') && todo.batch_id) {
              router.push({ pathname: '/transfer-batch/[id]', params: { id: String(todo.batch_id) } })
            }
          }}
          activeOpacity={todo.completed ? 1 : 0.7}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
            paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2,
            borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0,
            borderTopColor: Colors.border,
          }}
        >
          <Ionicons
            name={todo.completed ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={todo.completed ? Colors.success : Colors.textLight}
          />
          <View style={{ flex: 1 }}>
            <Text style={{
              ...Typography.body, color: todo.completed ? Colors.textLight : Colors.textPrimary,
              fontWeight: todo.completed ? '400' : '600',
              textDecorationLine: todo.completed ? 'line-through' : 'none',
            }}>{todo.label}</Text>
            <Text style={{ ...Typography.caption, color: Colors.textSecondary }}>{todo.project_name}</Text>
          </View>
          {todo.progress && !todo.completed && (
            <Text style={{ ...Typography.caption, color: Colors.warning, fontWeight: '700' }}>
              {todo.progress.done}/{todo.progress.total}
            </Text>
          )}
          {(todo.task_type === 'incoming_transfer' || todo.task_type === 'pre_check_transfer') && todo.total && !todo.completed && (
            <Text style={{ ...Typography.caption, color: Colors.warning, fontWeight: '700' }}>
              {todo.done || 0}/{todo.total}
            </Text>
          )}
          {!todo.completed && <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />}
        </TouchableOpacity>
      ))}
    </Card>
  )
}

// ─── Task Overview Section (admin) ─────────────────────────────────────────

function TaskOverviewSection() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  const { data, error } = useQuery({
    queryKey: ['admin-task-overview'],
    queryFn: () => api.tasks.adminOverview().then((r) => r.data),
    staleTime: 60 * 1000,
    enabled: isAdmin,
  })

  if (!isAdmin) return null
  if (!data?.projects?.length) return null

  // Show all projects from the response (API already filters to operational)
  const projects = data.projects
  if (projects.length === 0) return null

  const allDone = projects.every((p: any) =>
    p.daily_entry?.completed && p.machine_startup?.completed &&
    (p.scheduled_checks ?? []).every((sc: any) => sc.completed_today || !sc.is_overdue)
  )

  return (
    <Card style={{ marginBottom: Spacing.md, borderLeftWidth: 4, borderLeftColor: allDone ? Colors.success : Colors.warning, overflow: 'hidden' }}>
      <View style={{ paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.sm }}>
        <Text style={{ ...Typography.label, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Daily Task Status
        </Text>
      </View>
      {projects.map((p: any, i: number) => {
        const entryDone = p.daily_entry?.completed ?? false
        const entryAssigned = !!p.daily_entry?.assigned_to
        const startupDone = p.machine_startup?.completed ?? false
        const startupTotal = p.machine_startup?.total ?? 0
        const startupChecked = p.machine_startup?.done ?? 0
        const schedChecks = p.scheduled_checks ?? []
        const schedAllDone = schedChecks.every((sc: any) => sc.completed_today || !sc.is_overdue)
        const allProjectDone = entryDone && (startupDone || startupTotal === 0) && schedAllDone

        return (
          <View key={p.project_id} style={{
            paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2,
            borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0,
            borderTopColor: Colors.border,
            backgroundColor: allProjectDone ? 'rgba(40,167,69,0.04)' : undefined,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              <Ionicons
                name={allProjectDone ? 'checkmark-circle' : 'alert-circle'}
                size={20}
                color={allProjectDone ? Colors.success : Colors.warning}
              />
              <Text style={{ ...Typography.bodySmall, fontWeight: '700', flex: 1 }}>{p.project_name}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: Spacing.lg, marginTop: 4, marginLeft: 28 }}>
              {/* Daily Entry status */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons
                  name={entryDone ? 'checkmark-circle' : 'close-circle'}
                  size={14}
                  color={entryDone ? Colors.success : Colors.error}
                />
                <Text style={{ ...Typography.caption, color: entryDone ? Colors.success : Colors.error, fontWeight: '600' }}>
                  Daily Entry
                </Text>
                {entryAssigned && !entryDone && (
                  <Text style={{ ...Typography.caption, color: Colors.textLight }}> ({p.daily_entry.assigned_to})</Text>
                )}
              </View>
              {/* Machine Startup status */}
              {startupTotal > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons
                    name={startupDone ? 'checkmark-circle' : 'close-circle'}
                    size={14}
                    color={startupDone ? Colors.success : Colors.error}
                  />
                  <Text style={{ ...Typography.caption, color: startupDone ? Colors.success : Colors.error, fontWeight: '600' }}>
                    Equipment {startupChecked}/{startupTotal}
                  </Text>
                </View>
              )}
              {/* Breakdowns */}
              {(p.open_breakdowns ?? 0) > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="warning" size={14} color={Colors.error} />
                  <Text style={{ ...Typography.caption, color: Colors.error, fontWeight: '600' }}>
                    {p.open_breakdowns} breakdown{p.open_breakdowns > 1 ? 's' : ''}
                  </Text>
                </View>
              )}
            </View>
            {/* Scheduled checks */}
            {(p.scheduled_checks ?? []).length > 0 && (
              <View style={{ marginTop: 4, marginLeft: 28, gap: 3 }}>
                {p.scheduled_checks.map((sc: any) => (
                  <TouchableOpacity
                    key={sc.id}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                    onPress={() => router.push({ pathname: '/scheduled-check/[id]', params: { id: sc.id } })}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={sc.completed_today ? 'checkmark-circle' : sc.is_overdue ? 'alert-circle' : 'time-outline'}
                      size={14}
                      color={sc.completed_today ? Colors.success : sc.is_overdue ? Colors.error : Colors.warning}
                    />
                    <Text style={{ ...Typography.caption, color: sc.completed_today ? Colors.success : sc.is_overdue ? Colors.error : Colors.textSecondary, fontWeight: '600', flex: 1 }}>
                      {sc.name}
                    </Text>
                    <Text style={{ fontSize: 10, color: Colors.textLight }}>
                      {sc.machine_count} machine{sc.machine_count !== 1 ? 's' : ''}
                    </Text>
                    <Ionicons name="chevron-forward" size={12} color={Colors.textLight} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )
      })}
    </Card>
  )
}

// ─── Material color palette (matches dashboard) ─────────────────────────────
const MAT_COLORS = ['#FFB7C5', '#A6E6FC', '#C8F0A0', '#FFD59E', '#C8B0F5', '#FFDDA6']

// ─── Helpers ────────────────────────────────────────────────────────────────

interface AggregatedMaterial {
  material: string
  planned_sqm: number
  actual_sqm: number
  pct_complete: number
}

function aggregateMaterials(tasks: ProgressTask[]): AggregatedMaterial[] {
  const map = new Map<string, { planned: number; actual: number }>()
  for (const t of tasks) {
    const existing = map.get(t.material)
    if (existing) {
      existing.planned += t.planned_sqm
      existing.actual += t.actual_sqm
    } else {
      map.set(t.material, { planned: t.planned_sqm, actual: t.actual_sqm })
    }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([material, { planned, actual }]) => ({
      material,
      planned_sqm: planned,
      actual_sqm: actual,
      pct_complete: planned > 0 ? Math.round((actual / planned) * 100) : 0,
    }))
}

// ─── Donut Ring Component ───────────────────────────────────────────────────

function DonutRing({
  size,
  stroke,
  actualPct,
  expectedPct,
}: {
  size: number
  stroke: number
  actualPct: number
  expectedPct: number | null
}) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const actualDash = (Math.min(Math.max(actualPct, 0), 100) / 100) * circumference
  const expectedDash = expectedPct != null
    ? (Math.min(Math.max(expectedPct, 0), 100) / 100) * circumference
    : 0

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background ring */}
        <SvgCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={Colors.border}
          strokeWidth={stroke}
        />
        {/* Expected ring (pink, thinner, behind) */}
        {expectedPct != null && expectedPct > 0 && (
          <SvgCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={Colors.primary}
            strokeWidth={stroke * 0.5}
            strokeDasharray={`${expectedDash} ${circumference}`}
            strokeLinecap="round"
            opacity={0.4}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
        {/* Actual ring (green, on top) */}
        <SvgCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={Colors.success}
          strokeWidth={stroke}
          strokeDasharray={`${actualDash} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {/* Center text */}
      <View style={s.donutCenter}>
        <Text style={s.donutPct}>{Math.round(actualPct)}%</Text>
        <Text style={s.donutLabel}>done</Text>
      </View>
    </View>
  )
}

// ─── Material Progress Bar ──────────────────────────────────────────────────

function MaterialBar({
  material,
  pct,
  actual,
  planned,
  color,
}: {
  material: string
  pct: number
  actual: number
  planned: number
  color: string
}) {
  return (
    <View style={s.matRow}>
      <View style={s.matLabelRow}>
        <View style={[s.matDot, { backgroundColor: color }]} />
        <Text style={s.matName} numberOfLines={1}>{material}</Text>
        <Text style={s.matPct}>{pct}%</Text>
      </View>
      <View style={s.matBarBg}>
        <View style={[s.matBarFill, { width: `${Math.min(pct, 100)}%`, backgroundColor: color }]} />
      </View>
      <Text style={s.matDetail}>
        {actual.toLocaleString()} / {planned.toLocaleString()} m²
      </Text>
    </View>
  )
}

// ─── Skeleton Card ──────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <Card style={s.projectCard}>
      <View style={s.cardTop}>
        <View style={[s.bone, { width: 100, height: 100, borderRadius: 50 }]} />
        <View style={{ flex: 1, gap: Spacing.sm }}>
          <View style={[s.bone, { width: '70%', height: 16 }]} />
          <View style={[s.bone, { width: '50%', height: 12 }]} />
          <View style={[s.bone, { width: '40%', height: 24, borderRadius: BorderRadius.full }]} />
        </View>
      </View>
      <View style={{ gap: Spacing.xs, marginTop: Spacing.md }}>
        <View style={[s.bone, { width: '100%', height: 8, borderRadius: 4 }]} />
        <View style={[s.bone, { width: '80%', height: 8, borderRadius: 4 }]} />
      </View>
    </Card>
  )
}

// ─── Project Card ───────────────────────────────────────────────────────────

function ProjectCard({ project, onPress }: { project: ProjectWithProgress; onPress: () => void }) {
  const progress = project.progress
  if (!progress) return null

  const actual = Math.round(progress.overall_pct ?? 0)
  const expected = progress.should_be_pct != null ? Math.round(progress.should_be_pct) : null
  const diff = expected != null ? actual - expected : 0
  const isAhead = diff > 0
  const isBehind = diff < 0
  const diffAbs = Math.abs(diff)

  const materials = aggregateMaterials(progress.tasks ?? [])

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      <Card style={s.projectCard}>
        {/* Top row: donut + info */}
        <View style={s.cardTop}>
          <DonutRing size={100} stroke={8} actualPct={actual} expectedPct={expected} />

          <View style={s.cardInfo}>
            <Text style={s.projectName} numberOfLines={2}>{project.name}</Text>
            <Text style={s.projectSqm}>
              {progress.total_actual.toLocaleString()} / {progress.total_planned.toLocaleString()} m²
            </Text>

            {/* Ahead / behind badge */}
            {expected != null && (
              <View
                style={[
                  s.badge,
                  {
                    backgroundColor: isAhead
                      ? 'rgba(76,175,80,0.15)'
                      : isBehind
                      ? 'rgba(198,40,40,0.15)'
                      : 'rgba(255,255,255,0.1)',
                  },
                ]}
              >
                <Text
                  style={[
                    s.badgeText,
                    isAhead
                      ? { color: Colors.success }
                      : isBehind
                      ? { color: Colors.error }
                      : { color: Colors.textSecondary },
                  ]}
                >
                  {isAhead ? '\u2191 ' : isBehind ? '\u2193 ' : ''}
                  {diffAbs}% {isAhead ? 'ahead' : isBehind ? 'behind' : 'on track'}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Material progress bars */}
        {materials.length > 0 && (
          <View style={s.materialsSection}>
            {materials.map((mat, i) => (
              <MaterialBar
                key={mat.material}
                material={mat.material}
                pct={mat.pct_complete}
                actual={mat.actual_sqm}
                planned={mat.planned_sqm}
                color={MAT_COLORS[i % MAT_COLORS.length]}
              />
            ))}
          </View>
        )}

        {/* Tap hint */}
        <View style={s.tapHint}>
          <Ionicons name="arrow-forward" size={14} color={Colors.textLight} />
          <Text style={s.tapHintText}>Tap for dashboard</Text>
        </View>
      </Card>
    </TouchableOpacity>
  )
}

// ─── Main Screen ────────────────────────────────────────────────────────────

export default function OverviewScreen() {
  const router = useRouter()
  const activeProject = useProjectStore((s) => s.activeProject)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const user = useAuthStore((s) => s.user)
  const isOnline = useNetworkStatus()
  const { pending, syncing, lastSyncedAt, syncNow } = useSyncStatus()
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)

  // Fetch all projects
  const {
    data: projectsData,
    isLoading: projectsLoading,
    refetch: refetchProjects,
  } = useQuery({
    queryKey: ['overview-projects'],
    queryFn: () => api.projects.list().then((r) => r.data.projects as ProjectListItem[]),
    staleTime: 2 * 60 * 1000,
  })

  // Filter to operational projects (status === 'active')
  const operationalProjects = (projectsData ?? []).filter(
    (p) => p.is_operational || p.status === 'active'
  )

  // Set active project if not set (so pill shows immediately)
  useEffect(() => {
    if (!activeProject && operationalProjects.length > 0) {
      const p = operationalProjects[0]
      setActiveProject({
        id: p.id, name: p.name, start_date: null, active: true,
        quoted_days: null, hours_per_day: null, site_address: null,
        site_contact: null, track_by_lot: false,
      })
    }
  }, [activeProject, operationalProjects])

  // Fetch progress for each operational project
  const [projectsWithProgress, setProjectsWithProgress] = useState<ProjectWithProgress[]>([])
  const [detailsLoading, setDetailsLoading] = useState(false)

  const fetchAllProgress = useCallback(async (projects: ProjectListItem[]) => {
    if (projects.length === 0) {
      setProjectsWithProgress([])
      return
    }
    setDetailsLoading(true)
    try {
      const results = await Promise.all(
        projects.map(async (p) => {
          try {
            const res = await api.projects.detail(p.id)
            return {
              ...p,
              progress: res.data.progress ?? null,
            } as ProjectWithProgress
          } catch {
            return { ...p, progress: null } as ProjectWithProgress
          }
        })
      )
      // Only show projects that have progress data
      setProjectsWithProgress(results.filter((r) => r.progress != null))
    } finally {
      setDetailsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (operationalProjects.length > 0) {
      fetchAllProgress(operationalProjects)
    } else if (!projectsLoading) {
      setProjectsWithProgress([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsData])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await refetchProjects()
      const projects = (res.data ?? []) as ProjectListItem[]
      const operational = projects.filter((p) => p.is_operational || p.status === 'active')
      await fetchAllProgress(operational)
    } finally {
      setRefreshing(false)
    }
  }, [refetchProjects, fetchAllProgress])

  const handleProjectPress = (project: ProjectWithProgress) => {
    // Set the project in the store and navigate to dashboard
    setActiveProject({
      id: project.id,
      name: project.name,
      active: project.active,
      start_date: null,
      quoted_days: null,
      hours_per_day: null,
      site_address: null,
      site_contact: null,
      track_by_lot: true,
    })
    router.push('/(tabs)/dashboard')
  }

  const isLoading = projectsLoading || detailsLoading

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title="Overview" subtitle="All projects" />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        {/* Pre-Start button — only when a project is active */}
        {activeProject?.id ? (
          <TouchableOpacity
            style={s.preStartBtn}
            onPress={() => router.push(`/pre-start/${activeProject.id}`)}
            activeOpacity={0.85}
          >
            <Ionicons name="scan-outline" size={20} color="#fff" style={{ marginRight: Spacing.sm }} />
            <Text style={s.preStartText}>START PRE-START</Text>
          </TouchableOpacity>
        ) : null}

        {/* New Daily Entry button */}
        <TouchableOpacity
          style={s.newEntryBtn}
          onPress={() => router.push('/entry/new')}
          activeOpacity={0.85}
        >
          <Ionicons name="add-circle-outline" size={20} color={Colors.dark} style={{ marginRight: Spacing.sm }} />
          <Text style={s.newEntryText}>NEW DAILY ENTRY</Text>
        </TouchableOpacity>

        {/* Task lists — admin sees all projects, others see their personal todos */}
        <TaskOverviewSection />
        <MyTodosSection />

        {/* Sync status */}
        <View style={s.syncBar}>
          <Ionicons
            name={syncing ? 'sync-outline' : pending > 0 ? 'cloud-upload-outline' : 'cloud-done-outline'}
            size={14}
            color={pending > 0 ? Colors.warning : Colors.success}
          />
          <Text style={{ fontSize: 11, color: pending > 0 ? Colors.warning : Colors.success, fontWeight: '600', flex: 1 }}>
            {syncing ? 'Syncing...' : pending > 0 ? `${pending} pending` : 'All synced'}
          </Text>
          {!syncing && isOnline && (
            <TouchableOpacity onPress={syncNow} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={{ fontSize: 11, color: Colors.primary, fontWeight: '700' }}>{pending > 0 ? 'Sync' : 'Refresh'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {isLoading && projectsWithProgress.length === 0 ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : projectsWithProgress.length === 0 ? (
          <View style={s.emptyWrap}>
            <Ionicons name="grid-outline" size={48} color={Colors.textLight} />
            <Text style={s.emptyTitle}>No operational projects</Text>
            <Text style={s.emptySubtitle}>
              Projects with status "active" will appear here with progress tracking.
            </Text>
          </View>
        ) : (
          projectsWithProgress.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onPress={() => handleProjectPress(project)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.dark,
  },
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: Spacing.md,
    gap: Spacing.md,
    paddingBottom: Spacing.xxl,
  },

  // Pre-Start button
  preStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  preStartText: {
    ...Typography.bodySmall,
    color: '#fff',
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // New entry button
  newEntryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.lg,
  },
  newEntryText: {
    ...Typography.bodySmall,
    color: Colors.dark,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // Sync bar
  syncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  // Project card
  projectCard: {
    marginBottom: 0,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  cardInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  projectName: {
    ...Typography.h3,
    color: Colors.textPrimary,
  },
  projectSqm: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    marginTop: 2,
  },
  badgeText: {
    ...Typography.caption,
    fontWeight: '700',
  },

  // Donut center
  donutCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  donutPct: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  donutLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontSize: 9,
  },

  // Material bars
  materialsSection: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.sm,
  },
  matRow: {
    gap: 3,
  },
  matLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  matDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  matName: {
    ...Typography.caption,
    color: Colors.textSecondary,
    flex: 1,
  },
  matPct: {
    ...Typography.caption,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  matBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.border,
    overflow: 'hidden',
  },
  matBarFill: {
    height: 6,
    borderRadius: 3,
  },
  matDetail: {
    ...Typography.caption,
    color: Colors.textLight,
    fontSize: 10,
  },

  // Tap hint
  tapHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    justifyContent: 'flex-end',
  },
  tapHintText: {
    ...Typography.caption,
    color: Colors.textLight,
  },

  // Empty state
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl * 2,
    gap: Spacing.sm,
  },
  emptyTitle: {
    ...Typography.h3,
    color: Colors.textSecondary,
  },
  emptySubtitle: {
    ...Typography.bodySmall,
    color: Colors.textLight,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },

  // Skeleton
  bone: {
    backgroundColor: Colors.border,
    borderRadius: BorderRadius.md,
  },
})
