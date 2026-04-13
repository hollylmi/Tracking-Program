import { useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PieChart } from 'react-native-gifted-charts'
import Svg, { Circle as SvgCircle } from 'react-native-svg'
import Card from '../../components/ui/Card'
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../../constants/theme'
import ScreenHeader from '../../components/layout/ScreenHeader'
import { api } from '../../lib/api'
import { saveReferenceData, getReferenceData } from '../../lib/db'
import { cachedQuery } from '../../lib/cachedQuery'
import { Entry, ProgressTask, ProjectCosts, MaterialProductivity, ProjectProgress, GanttData, DelayEvent, TodoItem, AdminProjectTask } from '../../types'
import { useAuthStore } from '../../store/auth'
import { useProjectStore } from '../../store/project'
import { useProject } from '../../hooks/useProject'
import { useEntries } from '../../hooks/useEntries'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { useSyncStatus } from '../../hooks/useSyncStatus'
import { prefetchAllData } from '../../lib/prefetch'
import ReportsPanel from '../../components/ui/ReportsPanel'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

// ─── Palette for lot donut charts ────────────────────────────────────────────
const LOT_COLORS = ['#FFB7C5', '#A6E6FC', '#C8F0A0', '#FFD59E', '#C8B0F5', '#FFDDA6']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

function getToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getWeekBounds(): { start: string; end: string } {
  const now = new Date()
  const day = now.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const mon = new Date(now)
  mon.setDate(now.getDate() + diffToMon)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: fmt(mon), end: fmt(sun) }
}

function sortTasks(tasks: ProgressTask[]): ProgressTask[] {
  return [...tasks].sort((a, b) => {
    const lotCompare = a.lot.localeCompare(b.lot, undefined, { numeric: true })
    if (lotCompare !== 0) return lotCompare
    return a.material.localeCompare(b.material)
  })
}

function donutData(pct: number, color: string) {
  const v = Math.max(0, Math.min(100, pct))
  return [
    { value: v, color },
    { value: 100 - v, color: Colors.border },
  ]
}

// ─── Shared skeleton ─────────────────────────────────────────────────────────

function Bone({ h, w, style }: { h: number; w?: string | number; style?: object }) {
  return (
    <View
      style={[
        { height: h, borderRadius: BorderRadius.md, backgroundColor: Colors.border },
        w ? { width: w as any } : { flex: 1 },
        style,
      ]}
    />
  )
}

// ─── Overall Progress (donut) ─────────────────────────────────────────────────

function OverallDonutCard({
  progress,
  costs,
  isLoading,
}: {
  progress?: { overall_pct: number; total_planned: number; total_actual: number; total_remaining: number }
  costs?: ProjectCosts
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <Card style={st.card}>
        <Bone h={12} w="40%" style={{ marginBottom: Spacing.md }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.lg }}>
          <Bone h={144} w={144} style={{ borderRadius: 72 }} />
          <View style={{ flex: 1, gap: Spacing.sm }}>
            <Bone h={28} w="70%" />
            <Bone h={10} w="50%" />
            <Bone h={28} w="70%" />
            <Bone h={10} w="50%" />
          </View>
        </View>
      </Card>
    )
  }

  if (!progress) {
    return (
      <Card style={st.card}>
        <Text style={st.label}>OVERALL PROGRESS</Text>
        <Text style={st.empty}>No progress data recorded yet.</Text>
      </Card>
    )
  }

  const pct = Math.round(progress.overall_pct)

  // Finish dates from gantt data — matches web dashboard exactly
  const estimatedFinish = costs?.target_finish ?? null   // planned completion date
  const projectedFinish = costs?.est_finish ?? null      // forecast based on current rate
  const daysBehind = costs?.variance_days ?? null        // positive = behind, negative = ahead

  return (
    <Card style={st.card}>
      <Text style={st.label}>OVERALL PROGRESS</Text>
      <View style={st.donutRow}>
        <PieChart
          data={donutData(pct, Colors.primary)}
          donut
          radius={72}
          innerRadius={52}
          isAnimated
          centerLabelComponent={() => (
            <View style={{ alignItems: 'center' }}>
              <Text style={st.donutPct}>{pct}%</Text>
              <Text style={st.donutSub}>done</Text>
            </View>
          )}
        />
        <View style={st.donutStats}>
          <View style={st.donutStat}>
            <Text style={st.donutStatNum}>{progress.total_actual.toLocaleString()}</Text>
            <Text style={st.donutStatCaption}>Installed m²</Text>
          </View>
          <View style={st.statDivider} />
          <View style={st.donutStat}>
            <Text style={st.donutStatNum}>{progress.total_remaining.toLocaleString()}</Text>
            <Text style={st.donutStatCaption}>Remaining m²</Text>
          </View>
          <View style={st.statDivider} />
          <View style={st.donutStat}>
            <Text style={st.donutStatNum}>{progress.total_planned.toLocaleString()}</Text>
            <Text style={st.donutStatCaption}>Planned m²</Text>
          </View>
        </View>
      </View>
      {(estimatedFinish || projectedFinish) && (
        <View style={st.finishDates}>
          {estimatedFinish && (
            <View style={st.finishRow}>
              <Text style={st.finishLabel}>Planned finish</Text>
              <Text style={st.finishValue}>{estimatedFinish}</Text>
            </View>
          )}
          {projectedFinish && (
            <View style={st.finishRow}>
              <Text style={st.finishLabel}>Projected finish</Text>
              <Text style={[st.finishValue, daysBehind !== null && daysBehind > 0 ? { color: Colors.warning } : {}]}>
                {projectedFinish}
              </Text>
            </View>
          )}
        </View>
      )}
    </Card>
  )
}

// ─── Weekly Summary ───────────────────────────────────────────────────────────

function WeeklySummaryCard({
  entries,
  isLoading,
}: {
  entries: Entry[]
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <Card style={st.card}>
        <Bone h={12} w="35%" style={{ marginBottom: Spacing.md }} />
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <Bone h={56} />
          <Bone h={56} />
          <Bone h={56} />
        </View>
      </Card>
    )
  }

  const totalSqm = entries.reduce((s, e) => s + (e.install_sqm || 0), 0)
  const totalHours = entries.reduce((s, e) => s + (e.install_hours || 0), 0)
  const totalDelay = entries.reduce((s, e) => s + (e.delay_hours || 0), 0)

  const delayReasons = entries
    .filter((e) => e.delay_hours > 0 && e.delay_reason)
    .map((e) => e.delay_reason as string)
    .filter((v, i, a) => a.indexOf(v) === i)

  return (
    <Card style={st.card}>
      <Text style={st.label}>THIS WEEK</Text>
      <View style={st.weekRow}>
        <View style={st.weekCell}>
          <Text style={st.weekNum}>{totalSqm.toLocaleString()}</Text>
          <Text style={st.weekCaption}>m² installed</Text>
        </View>
        <View style={st.cellDivider} />
        <View style={st.weekCell}>
          <Text style={st.weekNum}>{totalHours.toLocaleString()}</Text>
          <Text style={st.weekCaption}>hours worked</Text>
        </View>
        <View style={st.cellDivider} />
        <View style={st.weekCell}>
          <Text style={st.weekNum}>{entries.length}</Text>
          <Text style={st.weekCaption}>entries</Text>
        </View>
      </View>
      {totalDelay > 0 && (
        <View style={st.delayPill}>
          <Ionicons name="warning-outline" size={13} color={Colors.warning} />
          <Text style={st.delayPillText}>
            {totalDelay}h delay this week
            {delayReasons.length > 0 ? ` — ${delayReasons.slice(0, 2).join(', ')}` : ''}
          </Text>
        </View>
      )}
    </Card>
  )
}

// ─── Lot Progress Cards (horizontal scroll) ───────────────────────────────────

function buildMaterialColorMap(tasks: ProgressTask[]): Record<string, string> {
  const materials = Array.from(new Set(tasks.map(t => t.material))).sort()
  const map: Record<string, string> = {}
  materials.forEach((mat, i) => { map[mat] = LOT_COLORS[i % LOT_COLORS.length] })
  return map
}

function LotProgressCards({
  tasks,
  isLoading,
}: {
  tasks?: ProgressTask[]
  isLoading: boolean
}) {
  const router = useRouter()
  const [filterMat, setFilterMat] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  if (isLoading) {
    return (
      <View style={st.lotSection}>
        <Bone h={12} w="40%" style={{ marginHorizontal: Spacing.md, marginBottom: Spacing.sm }} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={st.lotScroll}
          pointerEvents="none"
        >
          {[0, 1, 2].map((i) => (
            <Bone key={i} h={160} w={136} style={{ borderRadius: BorderRadius.md }} />
          ))}
        </ScrollView>
      </View>
    )
  }

  if (!tasks || tasks.length === 0) {
    return (
      <Card style={st.card}>
        <Text style={st.label}>LOT PROGRESS</Text>
        <Text style={st.empty}>No planned data uploaded for this project.</Text>
      </Card>
    )
  }

  const sorted = sortTasks(tasks)
  const materialColorMap = buildMaterialColorMap(tasks)
  const materials = Array.from(new Set(tasks.map(t => t.material))).sort()
  const filtered = filterMat ? sorted.filter(t => t.material === filterMat) : sorted

  return (
    <View style={st.lotSection}>
      <View style={st.lotHeader}>
        <Text style={[st.label, { marginHorizontal: Spacing.md }]}>LOT PROGRESS</Text>
        <TouchableOpacity
          style={st.matFilter}
          onPress={() => setDropdownOpen(true)}
          activeOpacity={0.75}
        >
          <Text style={st.matFilterText} numberOfLines={1}>
            {filterMat ?? 'All materials'}
          </Text>
          <Ionicons name="chevron-down" size={13} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Material filter dropdown modal */}
      <Modal
        visible={dropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownOpen(false)}
      >
        <Pressable style={st.matOverlay} onPress={() => setDropdownOpen(false)}>
          <View style={st.matDropdown}>
            <Text style={st.matDropdownTitle}>Filter by material</Text>
            {[null, ...materials].map(mat => (
              <TouchableOpacity
                key={mat ?? '__all__'}
                style={[st.matOption, filterMat === mat && st.matOptionActive]}
                onPress={() => { setFilterMat(mat); setDropdownOpen(false) }}
              >
                {mat && (
                  <View style={[st.matSwatch, { backgroundColor: materialColorMap[mat] }]} />
                )}
                <Text style={[st.matOptionText, filterMat === mat && st.matOptionTextActive]}>
                  {mat ?? 'All materials'}
                </Text>
                {filterMat === mat && (
                  <Ionicons name="checkmark" size={14} color={Colors.primary} style={{ marginLeft: 'auto' }} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.lotScroll}
      >
        {filtered.map((task) => {
          const color = materialColorMap[task.material]
          const pct = Math.round(task.pct_complete)
          const complete = pct >= 100
          return (
            <TouchableOpacity
              key={`${task.lot}-${task.material}`}
              style={[st.lotCard, complete && st.lotCardDone]}
              activeOpacity={0.8}
              onPress={() =>
                router.push({
                  pathname: '/lot-entries',
                  params: { lot: task.lot, material: task.material },
                })
              }
            >
              <View style={[st.matTag, { backgroundColor: color + '33' }]}>
                <View style={[st.matTagDot, { backgroundColor: color }]} />
                <Text style={[st.matTagText, { color: Colors.textSecondary }]} numberOfLines={1}>
                  {task.material}
                </Text>
              </View>
              <Text style={st.lotCardLot} numberOfLines={1}>
                Lot {task.lot}
              </Text>
              <View style={st.lotDonutWrap}>
                <PieChart
                  data={donutData(pct, complete ? Colors.success : color)}
                  donut
                  radius={42}
                  innerRadius={30}
                  isAnimated
                  centerLabelComponent={() => (
                    <Text style={[st.lotDonutPct, { color: complete ? Colors.success : Colors.textPrimary }]}>
                      {pct}%
                    </Text>
                  )}
                />
              </View>
              <Text style={st.lotCardStat}>
                {task.actual_sqm.toLocaleString()} / {task.planned_sqm.toLocaleString()} m²
              </Text>
              {complete && (
                <View style={st.completeBadge}>
                  <Text style={st.completeBadgeText}>✓ Done</Text>
                </View>
              )}
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    </View>
  )
}

// ─── Recent Entries ───────────────────────────────────────────────────────────

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
    <View style={st.recentSection}>
      <View style={st.recentHeader}>
        <Text style={st.label}>RECENT ENTRIES</Text>
        <TouchableOpacity onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={st.seeAll}>See all →</Text>
        </TouchableOpacity>
      </View>
      <Card padding="none">
        {isLoading ? (
          <View style={{ padding: Spacing.md, gap: Spacing.md }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ gap: 6 }}>
                <Bone h={12} w="65%" />
                <Bone h={10} w="45%" />
              </View>
            ))}
          </View>
        ) : entries.length === 0 ? (
          <View style={{ padding: Spacing.md }}>
            <Text style={st.empty}>No entries yet.</Text>
          </View>
        ) : (
          entries.map((entry, i) => (
            <View key={entry.id}>
              {i > 0 && <View style={st.rowDivider} />}
              <TouchableOpacity
                onPress={() => onEntryPress(entry.id)}
                activeOpacity={0.85}
                style={st.entryRow}
              >
                <View style={st.entryTopRow}>
                  <Text style={st.entryDate}>{formatDate(entry.date)}</Text>
                  {(entry.lot_number || entry.material) && (
                    <Text style={st.entryLotMat} numberOfLines={1}>
                      {[entry.lot_number, entry.material].filter(Boolean).join(' — ')}
                    </Text>
                  )}
                </View>
                <View style={st.entryStatsRow}>
                  <Text style={st.entryStat}>{entry.install_hours}h</Text>
                  <Text style={st.entryDot}>·</Text>
                  <Text style={st.entryStat}>{entry.install_sqm} m²</Text>
                  <Text style={st.entryDot}>·</Text>
                  <Text style={st.entryStat}>{entry.num_people} crew</Text>
                  {entry.delay_hours > 0 && (
                    <View style={st.delayBadge}>
                      <Text style={st.delayBadgeText}>⚠ {entry.delay_hours}h delay</Text>
                    </View>
                  )}
                  {entry.photo_count > 0 && (
                    <View style={st.photoBadge}>
                      <Ionicons name="camera-outline" size={11} color={Colors.textSecondary} />
                      <Text style={st.photoCount}>{entry.photo_count}</Text>
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

// ─── Cost Card ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function CostCard({ costs, isLoading }: { costs?: ProjectCosts; isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card style={st.card}>
        <Bone h={12} w="30%" style={{ marginBottom: Spacing.md }} />
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <Bone h={56} />
          <Bone h={56} />
          <Bone h={56} />
        </View>
      </Card>
    )
  }

  if (!costs) return null

  const variance = costs.cost_variance
  const isOverrun = variance !== null && variance > 0
  const isSaving = variance !== null && variance < 0
  const onBudget = variance !== null && variance === 0
  const schedBehind = costs.variance_days !== null && costs.variance_days > 0
  const schedAhead = costs.variance_days !== null && costs.variance_days < 0
  const schedOnTime = costs.variance_days === 0

  // Only render if there's at least something to show
  const hasCostData = costs.target_cost !== null
  const hasScheduleData = costs.variance_days !== null || costs.est_finish !== null
  if (!hasCostData && !hasScheduleData) return null

  return (
    <Card style={st.card}>
      <Text style={st.label}>BUDGET & FORECAST</Text>

      {hasCostData && (
        <View style={st.weekRow}>
          <View style={st.weekCell}>
            <Text style={st.weekNum}>{fmt(costs.target_cost!)}</Text>
            <Text style={st.weekCaption}>target</Text>
          </View>
          {costs.forecast_cost !== null && (
            <>
              <View style={st.cellDivider} />
              <View style={st.weekCell}>
                <Text style={[st.weekNum, isOverrun ? { color: Colors.error } : isSaving ? { color: Colors.success } : {}]}>
                  {fmt(costs.forecast_cost)}
                </Text>
                <Text style={st.weekCaption}>forecast{costs.forecast_working_days ? ` (${costs.forecast_working_days}d)` : ''}</Text>
              </View>
            </>
          )}
          {variance !== null && (
            <>
              <View style={st.cellDivider} />
              <View style={st.weekCell}>
                <Text style={[st.weekNum, isOverrun ? { color: Colors.error } : isSaving ? { color: Colors.success } : { color: Colors.textSecondary }]}>
                  {isOverrun ? '+' : isSaving ? '−' : ''}{fmt(variance)}
                </Text>
                <Text style={[st.weekCaption, isOverrun ? { color: Colors.error } : isSaving ? { color: Colors.success } : {}]}>
                  {isOverrun ? 'overrun' : isSaving ? 'saving' : 'on budget'}
                </Text>
              </View>
            </>
          )}
        </View>
      )}

      {!hasCostData && !costs.has_rates && (
        <Text style={[st.empty, { fontSize: 12, marginBottom: Spacing.sm }]}>
          Add role rates and budgeted crew to see cost forecast.
        </Text>
      )}

      {(schedBehind || schedAhead || schedOnTime) && (
        <View style={[
          st.behindPill,
          { marginTop: hasCostData ? Spacing.sm : 0 },
          (schedAhead || schedOnTime) ? { backgroundColor: 'rgba(76,175,80,0.15)' } : {},
        ]}>
          <Ionicons
            name={schedBehind ? 'time-outline' : 'checkmark-circle-outline'}
            size={12}
            color={schedBehind ? Colors.warning : Colors.success}
          />
          <Text style={[st.behindText, (schedAhead || schedOnTime) ? { color: Colors.success } : {}]}>
            {schedBehind
              ? `${costs.variance_days} days behind schedule`
              : schedAhead
              ? `${Math.abs(costs.variance_days!)} days ahead of schedule`
              : 'On schedule'}
          </Text>
        </View>
      )}
      {onBudget && hasCostData && (
        <View style={[st.behindPill, { backgroundColor: 'rgba(76,175,80,0.15)', marginTop: Spacing.sm }]}>
          <Ionicons name="checkmark-circle-outline" size={12} color={Colors.success} />
          <Text style={[st.behindText, { color: Colors.success }]}>On budget</Text>
        </View>
      )}
    </Card>
  )
}

// ─── Productivity Card ────────────────────────────────────────────────────────

function ProductivityCard({
  productivity,
  isLoading,
}: {
  productivity?: { overall: { planned_rate: number | null; actual_rate: number | null; pct_of_target: number | null }; materials: MaterialProductivity[] }
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <Card style={st.card}>
        <Bone h={12} w="40%" style={{ marginBottom: Spacing.md }} />
        <Bone h={56} style={{ marginBottom: Spacing.sm }} />
        {[0, 1].map((i) => (
          <Bone key={i} h={36} style={{ marginBottom: Spacing.xs }} />
        ))}
      </Card>
    )
  }
  if (!productivity || productivity.materials.length === 0) return null

  const { overall, materials } = productivity
  const overallPct = overall.pct_of_target
  const overallAbove = overallPct !== null && overallPct >= 100
  const overallBelow = overallPct !== null && overallPct < 90

  return (
    <Card style={st.card}>
      <Text style={st.label}>PRODUCTIVITY</Text>

      {/* Overall summary banner */}
      <View style={st.prodOverall}>
        <View style={st.prodOverallItem}>
          <Text style={st.prodOverallNum}>
            {overall.planned_rate !== null ? `${overall.planned_rate}` : '—'}
          </Text>
          <Text style={st.prodOverallCaption}>plan m²/p-hr</Text>
        </View>
        <View style={st.cellDivider} />
        <View style={st.prodOverallItem}>
          <Text style={st.prodOverallNum}>
            {overall.actual_rate !== null ? `${overall.actual_rate}` : '—'}
          </Text>
          <Text style={st.prodOverallCaption}>actual m²/p-hr</Text>
        </View>
        <View style={st.cellDivider} />
        <View style={st.prodOverallItem}>
          <Text style={[
            st.prodOverallNum,
            overallAbove ? { color: Colors.success } : overallBelow ? { color: Colors.error } : {},
          ]}>
            {overallPct !== null ? `${overallPct}%` : '—'}
          </Text>
          <Text style={st.prodOverallCaption}>vs plan</Text>
        </View>
      </View>

      {/* Person-hours if available */}
      {overall.actual_person_hours != null && overall.actual_person_hours > 0 && (
        <View style={stProd.personHoursRow}>
          <Ionicons name="people-outline" size={13} color={Colors.textSecondary} />
          <Text style={stProd.personHoursText}>
            Total person-hours: {overall.actual_person_hours.toLocaleString()} p-hrs
          </Text>
        </View>
      )}

      {/* Per-material breakdown */}
      <View style={st.prodHeader}>
        <Text style={[st.prodCell, { flex: 2 }]}>Material</Text>
        <Text style={[st.prodCell, st.prodNum]}>Plan</Text>
        <Text style={[st.prodCell, st.prodNum]}>Actual</Text>
        <Text style={[st.prodCell, st.prodNum]}>vs Plan</Text>
      </View>

      {materials.map((row) => {
        const pct = row.pct_of_target
        const isBelow = pct !== null && pct < 90
        const isAbove = pct !== null && pct >= 100
        return (
          <View key={row.material} style={st.prodRow}>
            <Text style={[st.prodCell, st.prodMatName, { flex: 2 }]} numberOfLines={1}>
              {row.material}
            </Text>
            <Text style={[st.prodCell, st.prodNum]}>
              {row.planned_rate !== null ? `${row.planned_rate}` : '—'}
            </Text>
            <Text style={[st.prodCell, st.prodNum]}>
              {row.actual_rate !== null ? `${row.actual_rate}` : '—'}
            </Text>
            <Text style={[
              st.prodCell,
              st.prodNum,
              st.prodPct,
              isAbove ? { color: Colors.success } : isBelow ? { color: Colors.error } : {},
            ]}>
              {pct !== null ? `${pct}%` : '—'}
            </Text>
          </View>
        )
      })}

      <Text style={st.prodFootnote}>m²/person-hr  ·  based on crew assigned to each production line</Text>
    </Card>
  )
}

// ─── Hours Breakdown Bar ──────────────────────────────────────────────────────

function HoursBreakdownCard({
  progress,
  isLoading,
}: {
  progress?: ProjectProgress
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <Card style={st.card}>
        <Bone h={12} w="45%" style={{ marginBottom: Spacing.md }} />
        <Bone h={28} style={{ marginBottom: Spacing.sm }} />
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <Bone h={14} w="22%" />
          <Bone h={14} w="22%" />
          <Bone h={14} w="22%" />
          <Bone h={14} w="22%" />
        </View>
      </Card>
    )
  }

  if (!progress || progress.total_available_hours == null || progress.total_available_hours === 0) return null

  const deploy = progress.total_install_hours ?? 0
  const variation = progress.total_variation_hours ?? 0
  const lost = progress.total_lost_hours ?? 0
  const other = progress.non_deploy_hours ?? 0
  const total = progress.total_available_hours

  const pctDeploy = Math.round((deploy / total) * 100)
  const pctVariation = Math.round((variation / total) * 100)
  const pctLost = Math.round((lost / total) * 100)
  const pctOther = Math.max(0, 100 - pctDeploy - pctVariation - pctLost)

  const segments = [
    { label: 'Deploy', hours: deploy, pct: pctDeploy, color: '#3D8B41' },
    { label: 'Variation', hours: variation, pct: pctVariation, color: '#C96A00' },
    { label: 'Site Delay', hours: lost, pct: pctLost, color: '#C62828' },
    { label: 'Other', hours: other, pct: pctOther, color: '#888' },
  ].filter(s => s.pct > 0)

  return (
    <Card style={st.card}>
      <Text style={st.label}>HOURS BREAKDOWN</Text>

      {/* Stacked bar */}
      <View style={stHours.barContainer}>
        {segments.map((seg) => (
          <View
            key={seg.label}
            style={[stHours.barSegment, { flex: seg.pct, backgroundColor: seg.color }]}
          />
        ))}
      </View>

      {/* Legend */}
      <View style={stHours.legend}>
        {segments.map((seg) => (
          <View key={seg.label} style={stHours.legendItem}>
            <View style={[stHours.legendDot, { backgroundColor: seg.color }]} />
            <Text style={stHours.legendText}>
              {seg.label}: {seg.hours.toLocaleString()}h ({seg.pct}%)
            </Text>
          </View>
        ))}
      </View>

      {/* Total */}
      <View style={stHours.totalRow}>
        <Text style={stHours.totalLabel}>Total Available</Text>
        <Text style={stHours.totalValue}>{total.toLocaleString()} hrs</Text>
      </View>
    </Card>
  )
}

const stHours = StyleSheet.create({
  barContainer: {
    flexDirection: 'row',
    height: 24,
    borderRadius: BorderRadius.sm,
    overflow: 'hidden',
    marginBottom: Spacing.sm,
  },
  barSegment: {
    height: '100%',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  totalLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  totalValue: {
    ...Typography.caption,
    color: Colors.textPrimary,
    fontWeight: '700',
  },
})

// ─── Progress Comparison Card ────────────────────────────────────────────────

function ProgressComparisonCard({
  progress,
  isLoading,
}: {
  progress?: ProjectProgress
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <Card style={st.card}>
        <Bone h={12} w="50%" style={{ marginBottom: Spacing.md }} />
        <Bone h={120} style={{ borderRadius: 60, alignSelf: 'center', width: 120 }} />
      </Card>
    )
  }

  if (!progress) return null

  const actual = Math.round(progress.overall_pct ?? 0)
  const expected = Math.round(progress.should_be_pct ?? 0)
  const diff = actual - expected
  const isAhead = diff > 0
  const isBehind = diff < 0
  const diffAbs = Math.abs(diff)

  // SVG donut params
  const size = 130
  const stroke = 10
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const actualDash = (Math.min(actual, 100) / 100) * circumference
  const expectedDash = (Math.min(expected, 100) / 100) * circumference

  return (
    <Card style={st.card}>
      <Text style={st.label}>PROGRESS vs SCHEDULE</Text>

      <View style={stComp.donutRow}>
        {/* SVG Donut with both rings */}
        <View style={{ width: size, height: size }}>
          <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {/* Background ring */}
            <SvgCircle cx={size/2} cy={size/2} r={radius} fill="none" stroke={Colors.border} strokeWidth={stroke} />
            {/* Expected ring (blue, thinner, behind) */}
            <SvgCircle cx={size/2} cy={size/2} r={radius} fill="none" stroke={Colors.primary} strokeWidth={stroke * 0.5}
              strokeDasharray={`${expectedDash} ${circumference}`} strokeLinecap="round" opacity={0.4}
              transform={`rotate(-90 ${size/2} ${size/2})`} />
            {/* Actual ring (green, on top) */}
            <SvgCircle cx={size/2} cy={size/2} r={radius} fill="none" stroke={Colors.success} strokeWidth={stroke}
              strokeDasharray={`${actualDash} ${circumference}`} strokeLinecap="round"
              transform={`rotate(-90 ${size/2} ${size/2})`} />
          </Svg>
          {/* Center text */}
          <View style={stComp.donutCenter}>
            <Text style={stComp.donutPct}>{actual}%</Text>
            <Text style={stComp.donutLabel}>actual</Text>
          </View>
        </View>

        {/* Legend + badge */}
        <View style={stComp.donutLegend}>
          <View style={stComp.legendRow}>
            <View style={[stComp.legendDot, { backgroundColor: Colors.success }]} />
            <Text style={stComp.legendText}>Actual progress</Text>
            <Text style={stComp.legendValue}>{actual}%</Text>
          </View>
          <View style={stComp.legendRow}>
            <View style={[stComp.legendDot, { backgroundColor: Colors.primary, opacity: 0.5 }]} />
            <Text style={stComp.legendText}>Should be at</Text>
            <Text style={stComp.legendValue}>{expected}%</Text>
          </View>
          <View style={[
            stComp.heroBadge,
            { backgroundColor: isAhead ? 'rgba(76,175,80,0.15)' : isBehind ? 'rgba(198,40,40,0.15)' : 'rgba(255,255,255,0.1)',
              marginTop: Spacing.sm },
          ]}>
            <Text style={[
              stComp.heroBadgeText,
              isAhead ? { color: Colors.success } : isBehind ? { color: Colors.error } : { color: Colors.textSecondary },
            ]}>
              {isAhead ? '↑ ' : isBehind ? '↓ ' : ''}{diffAbs}% {isAhead ? 'ahead' : isBehind ? 'behind' : 'on track'}
            </Text>
          </View>
        </View>
      </View>
    </Card>
  )
}

const stComp = StyleSheet.create({
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  donutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    marginTop: Spacing.sm,
  },
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
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  donutLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontSize: 10,
  },
  donutLegend: {
    flex: 1,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  legendText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    flex: 1,
  },
  legendValue: {
    ...Typography.caption,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  heroBadgeText: {
    ...Typography.caption,
    fontWeight: '700',
  },
})

// ─── Crew Staffing Display ──────────────────────────────────────────────────

function CrewStaffingRow({
  progress,
  isLoading,
}: {
  progress?: ProjectProgress
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <View style={stCrew.row}>
        <Bone h={36} />
      </View>
    )
  }

  const planned = progress?.planned_crew
  const current = progress?.current_crew
  if (planned == null && current == null) return null

  return (
    <View style={stCrew.row}>
      <View style={stCrew.item}>
        <Ionicons name="people-outline" size={16} color={Colors.textSecondary} />
        <Text style={stCrew.label}>Planned crew</Text>
        <Text style={stCrew.value}>{planned ?? '--'}</Text>
      </View>
      <View style={stCrew.divider} />
      <View style={stCrew.item}>
        <Ionicons name="people" size={16} color={Colors.primary} />
        <Text style={stCrew.label}>Current crew</Text>
        <Text style={stCrew.value}>{current ?? '--'}</Text>
      </View>
    </View>
  )
}

const stCrew = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  item: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
  },
  divider: {
    width: 1,
    backgroundColor: Colors.border,
    alignSelf: 'stretch',
  },
  label: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  value: {
    ...Typography.body,
    color: Colors.textPrimary,
    fontWeight: '700',
    fontFamily: 'Montserrat_700Bold',
  },
})

// ─── Progress by Lot/Material Table ─────────────────────────────────────────

function LotMaterialTableCard({
  tasks,
  isLoading,
}: {
  tasks?: ProgressTask[]
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <Card style={st.card}>
        <Bone h={12} w="55%" style={{ marginBottom: Spacing.md }} />
        {[0, 1, 2].map((i) => (
          <Bone key={i} h={40} style={{ marginBottom: Spacing.xs }} />
        ))}
      </Card>
    )
  }

  if (!tasks || tasks.length === 0) return null

  const sorted = sortTasks(tasks)

  return (
    <Card style={st.card}>
      <Text style={st.label}>PROGRESS BY LOT & MATERIAL</Text>

      {/* Header row */}
      <View style={stLotTable.headerRow}>
        <Text style={[stLotTable.cell, { flex: 1.5 }]}>Lot</Text>
        <Text style={[stLotTable.cell, { flex: 1.5 }]}>Material</Text>
        <Text style={[stLotTable.cell, stLotTable.numCell]}>Planned</Text>
        <Text style={[stLotTable.cell, stLotTable.numCell]}>Actual</Text>
        <Text style={[stLotTable.cell, stLotTable.numCell]}>Remain</Text>
      </View>

      {sorted.map((task) => {
        const pct = Math.round(task.pct_complete)
        const remaining = Math.max(0, task.planned_sqm - task.actual_sqm)
        const complete = pct >= 100
        const barColor = complete ? Colors.success : Colors.primary

        return (
          <View key={`${task.lot}-${task.material}`} style={stLotTable.row}>
            <View style={stLotTable.dataRow}>
              <Text style={[stLotTable.cellValue, { flex: 1.5 }]} numberOfLines={1}>
                {task.lot || '--'}
              </Text>
              <Text style={[stLotTable.cellValue, { flex: 1.5 }]} numberOfLines={1}>
                {task.material || '--'}
              </Text>
              <Text style={[stLotTable.cellValue, stLotTable.numCell]}>
                {task.planned_sqm.toLocaleString()}
              </Text>
              <Text style={[stLotTable.cellValue, stLotTable.numCell]}>
                {task.actual_sqm.toLocaleString()}
              </Text>
              <Text style={[stLotTable.cellValue, stLotTable.numCell]}>
                {remaining.toLocaleString()}
              </Text>
            </View>
            {/* Progress bar */}
            <View style={stLotTable.barTrack}>
              <View style={[stLotTable.barFill, { width: `${Math.min(100, pct)}%`, backgroundColor: barColor }]} />
            </View>
            <Text style={[stLotTable.pctText, complete ? { color: Colors.success } : {}]}>
              {pct}% complete
            </Text>
          </View>
        )
      })}

      <Text style={stLotTable.footnote}>All values in m²</Text>
    </Card>
  )
}

const stLotTable = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    paddingBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 2,
  },
  cell: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  numCell: {
    flex: 1,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  row: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  dataRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  cellValue: {
    ...Typography.caption,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  barTrack: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 2,
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  pctText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontSize: 10,
  },
  footnote: {
    ...Typography.caption,
    color: Colors.textLight,
    marginTop: Spacing.sm,
    fontStyle: 'italic',
  },
})

// ─── Delay Summary by Reason ────────────────────────────────────────────────

interface DelaySummaryRow {
  reason: string
  type: string
  count: number
  totalHours: number
}

function DelaySummaryCard({
  progress,
  isLoading,
}: {
  progress?: ProjectProgress
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <Card style={st.card}>
        <Bone h={12} w="45%" style={{ marginBottom: Spacing.md }} />
        {[0, 1, 2].map((i) => (
          <Bone key={i} h={32} style={{ marginBottom: Spacing.xs }} />
        ))}
      </Card>
    )
  }

  const events = progress?.delay_events ?? []
  if (events.length === 0) return null

  // Aggregate by reason
  const grouped: Record<string, DelaySummaryRow> = {}
  for (const evt of events) {
    const key = evt.reason
    if (!grouped[key]) {
      grouped[key] = { reason: key, type: evt.type || 'delay', count: 0, totalHours: 0 }
    }
    grouped[key].count += 1
    grouped[key].totalHours += evt.hours
  }

  const rows = Object.values(grouped).sort((a, b) => b.totalHours - a.totalHours)

  return (
    <Card style={st.card}>
      <Text style={st.label}>DELAY SUMMARY BY REASON</Text>

      {/* Header */}
      <View style={stDelaySum.headerRow}>
        <Text style={[stDelaySum.cell, { flex: 2.5 }]}>Reason</Text>
        <Text style={[stDelaySum.cell, stDelaySum.numCell]}>Type</Text>
        <Text style={[stDelaySum.cell, stDelaySum.numCell]}>Count</Text>
        <Text style={[stDelaySum.cell, stDelaySum.numCell]}>Hours</Text>
      </View>

      {rows.map((row) => {
        const isVariation = row.type === 'variation'
        return (
          <View key={row.reason} style={stDelaySum.row}>
            <Text style={[stDelaySum.reasonText, { flex: 2.5 }]} numberOfLines={2}>
              {row.reason}
            </Text>
            <View style={[stDelaySum.typeBadge, isVariation ? stDelaySum.typeBadgeVar : stDelaySum.typeBadgeDelay]}>
              <Text style={[stDelaySum.typeBadgeText, isVariation ? { color: '#C96A00' } : { color: Colors.error }]}>
                {isVariation ? 'VAR' : 'DLY'}
              </Text>
            </View>
            <Text style={[stDelaySum.numValue, stDelaySum.numCell]}>{row.count}</Text>
            <Text style={[stDelaySum.numValue, stDelaySum.numCell, { color: Colors.error, fontWeight: '700' }]}>
              {row.totalHours}h
            </Text>
          </View>
        )
      })}

      {/* Totals */}
      <View style={stDelaySum.totalRow}>
        <Text style={[stDelaySum.totalLabel, { flex: 2.5 }]}>Total</Text>
        <Text style={stDelaySum.numCell} />
        <Text style={[stDelaySum.totalValue, stDelaySum.numCell]}>
          {rows.reduce((s, r) => s + r.count, 0)}
        </Text>
        <Text style={[stDelaySum.totalValue, stDelaySum.numCell, { color: Colors.error }]}>
          {rows.reduce((s, r) => s + r.totalHours, 0)}h
        </Text>
      </View>
    </Card>
  )
}

const stDelaySum = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 2,
  },
  cell: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  numCell: {
    flex: 1,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  reasonText: {
    ...Typography.caption,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  typeBadge: {
    flex: 1,
    alignItems: 'center',
  },
  typeBadgeDelay: {},
  typeBadgeVar: {},
  typeBadgeText: {
    ...Typography.caption,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  numValue: {
    ...Typography.caption,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 2,
  },
  totalLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  totalValue: {
    ...Typography.caption,
    color: Colors.textPrimary,
    fontWeight: '700',
  },
})

// ─── Gantt/Schedule Summary Card ────────────────────────────────────────────

// ─── Delay Impact Card ──────────────────────────────────────────────────────

function DelayImpactCard({
  progress,
  isLoading,
}: {
  progress?: ProjectProgress
  isLoading: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  if (isLoading) {
    return (
      <Card style={st.card}>
        <Bone h={12} w="35%" style={{ marginBottom: Spacing.md }} />
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <Bone h={56} />
          <Bone h={56} />
        </View>
      </Card>
    )
  }

  const totalDelay = progress?.total_delay_hours ?? 0
  const impactDays = progress?.delay_impact_days ?? 0
  const events = progress?.delay_events ?? []

  if (totalDelay === 0 && events.length === 0) return null

  const visibleEvents = expanded ? events : events.slice(0, 5)

  return (
    <Card style={st.card}>
      <Text style={st.label}>DELAY IMPACT</Text>

      {/* Summary */}
      <View style={st.weekRow}>
        <View style={st.weekCell}>
          <Text style={[st.weekNum, { color: Colors.error }]}>{totalDelay.toLocaleString()}</Text>
          <Text style={st.weekCaption}>total delay hrs</Text>
        </View>
        <View style={st.cellDivider} />
        <View style={st.weekCell}>
          <Text style={[st.weekNum, { color: Colors.error }]}>{impactDays.toLocaleString()}</Text>
          <Text style={st.weekCaption}>equiv. days</Text>
        </View>
      </View>

      {/* Delay events list */}
      {events.length > 0 && (
        <View style={stDelay.eventsList}>
          <Text style={stDelay.eventsTitle}>Delay Events</Text>
          {visibleEvents.map((evt, i) => (
            <View key={`${evt.date}-${i}`} style={stDelay.eventRow}>
              <View style={stDelay.eventLeft}>
                <Text style={stDelay.eventDate}>{formatDate(evt.date)}</Text>
                <Text style={stDelay.eventReason} numberOfLines={2}>
                  {evt.reason}{evt.description ? ` — ${evt.description}` : ''}
                </Text>
              </View>
              <Text style={stDelay.eventHours}>{evt.hours}h</Text>
            </View>
          ))}
          {events.length > 5 && (
            <TouchableOpacity
              onPress={() => setExpanded(!expanded)}
              activeOpacity={0.75}
              style={stDelay.toggleBtn}
            >
              <Text style={stDelay.toggleText}>
                {expanded ? 'Show less' : `Show all ${events.length} events`}
              </Text>
              <Ionicons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={Colors.primary}
              />
            </TouchableOpacity>
          )}
        </View>
      )}
    </Card>
  )
}

const stDelay = StyleSheet.create({
  eventsList: {
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  eventsTitle: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  eventLeft: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  eventDate: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  eventReason: {
    ...Typography.caption,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  eventHours: {
    ...Typography.caption,
    color: Colors.error,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: Spacing.sm,
  },
  toggleText: {
    ...Typography.caption,
    color: Colors.primary,
    fontWeight: '600',
  },
})

// ─── Sync Status Bar ─────────────────────────────────────────────────────────

function SyncStatusBar({
  pending,
  syncing,
  lastSyncedAt,
  isOnline,
  onSyncNow,
}: {
  pending: number
  syncing: boolean
  lastSyncedAt: Date | null
  isOnline: boolean
  onSyncNow: () => void
}) {
  const hasPending = pending > 0

  // Format last synced time
  function formatLastSynced(d: Date): string {
    const now = new Date()
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH}h ago`
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  }

  const bg = hasPending
    ? 'rgba(201,106,0,0.12)'
    : 'rgba(61,139,65,0.10)'
  const borderCol = hasPending ? Colors.warning : Colors.success
  const iconName = syncing
    ? 'sync-outline'
    : hasPending
    ? 'cloud-upload-outline'
    : 'cloud-done-outline'
  const iconColor = hasPending ? Colors.warning : Colors.success

  return (
    <View style={[stSync.bar, { backgroundColor: bg, borderLeftColor: borderCol }]}>
      <Ionicons name={iconName as any} size={16} color={iconColor} />
      <View style={stSync.text}>
        {syncing ? (
          <Text style={[stSync.main, { color: Colors.textSecondary }]}>Syncing…</Text>
        ) : hasPending ? (
          <Text style={[stSync.main, { color: Colors.warning }]}>
            {pending} item{pending !== 1 ? 's' : ''} pending sync
          </Text>
        ) : (
          <Text style={[stSync.main, { color: Colors.success }]}>All synced</Text>
        )}
        {!syncing && (
          <Text style={stSync.sub}>
            {!isOnline ? 'Offline — will sync on reconnect' :
             lastSyncedAt ? `Last synced ${formatLastSynced(lastSyncedAt)}` :
             'Not yet synced this session'}
          </Text>
        )}
      </View>
      {!syncing && isOnline && (
        <TouchableOpacity
          onPress={onSyncNow}
          style={stSync.btn}
          activeOpacity={0.75}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={stSync.btnText}>{hasPending ? 'Sync now' : 'Refresh'}</Text>
        </TouchableOpacity>
      )}
      {syncing && (
        <ActivityIndicator size="small" color={Colors.textSecondary} />
      )}
    </View>
  )
}

const stProd = StyleSheet.create({
  personHoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,183,197,0.08)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    marginBottom: Spacing.md,
  },
  personHoursText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
})

const stSync = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderLeftWidth: 3,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
  },
  text: { flex: 1 },
  main: { ...Typography.caption, fontWeight: '600' },
  sub: { ...Typography.caption, color: Colors.textLight, marginTop: 1 },
  btn: {
    backgroundColor: Colors.warning,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  btnText: { ...Typography.caption, color: Colors.white, fontWeight: '700' },
})

// ─── Error Card ───────────────────────────────────────────────────────────────

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <Card style={st.card}>
      <Text style={st.label}>UNABLE TO LOAD PROJECT</Text>
      <Text style={[st.empty, { marginTop: Spacing.xs, marginBottom: Spacing.md }]}>
        Check your connection and try again.
      </Text>
      <TouchableOpacity style={st.retryBtn} onPress={onRetry} activeOpacity={0.85}>
        <Text style={st.retryText}>Retry</Text>
      </TouchableOpacity>
    </Card>
  )
}

// ─── To-Do / Admin Task Overview ──────────────────────────────────────────────

function TodoSection({ router, userRole }: { router: any; userRole?: string }) {
  const { data: todoData } = useQuery({
    queryKey: ['my-todos'],
    queryFn: () => api.tasks.myTodos().then((r) => r.data),
    staleTime: 60 * 1000,
    enabled: userRole === 'supervisor' || userRole === 'site',
  })

  const { data: adminData } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api.tasks.adminOverview().then((r) => r.data),
    staleTime: 60 * 1000,
    enabled: userRole === 'admin',
  })

  // Supervisor to-do list
  if (userRole === 'supervisor' || userRole === 'site') {
    const todos = todoData?.todos ?? []
    if (todos.length === 0) return null
    const pending = todos.filter((t) => !t.completed)
    if (pending.length === 0) return (
      <Card style={{ backgroundColor: 'rgba(61,139,65,0.1)', borderWidth: 1, borderColor: 'rgba(61,139,65,0.2)' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
          <Text style={{ ...Typography.bodySmall, color: Colors.success, fontWeight: '600' }}>All tasks complete for today</Text>
        </View>
      </Card>
    )
    return (
      <Card padding="none" style={{ borderLeftWidth: 4, borderLeftColor: Colors.primary, overflow: 'hidden' }}>
        <View style={{ paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.sm }}>
          <Text style={{ ...Typography.label, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>Your Tasks Today</Text>
        </View>
        {todos.map((todo, i) => (
          <TouchableOpacity
            key={`${todo.project_id}-${todo.task_type}`}
            onPress={() => {
              if (todo.completed) return
              if (todo.task_type === 'daily_entry') router.push('/entry/new')
              else if (todo.task_type === 'machine_startup') router.push('/(tabs)/equipment')
              else if (todo.task_type === 'scheduled_check' && todo.check_id) router.push({ pathname: '/scheduled-check/[id]', params: { id: todo.check_id } })
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
            {!todo.completed && <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />}
          </TouchableOpacity>
        ))}
      </Card>
    )
  }

  // Admin overview
  if (userRole === 'admin') {
    const projects = adminData?.projects ?? []
    if (projects.length === 0) return null
    return (
      <Card padding="none" style={{ overflow: 'hidden' }}>
        <View style={{ paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.sm }}>
          <Text style={{ ...Typography.label, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>Daily Task Status</Text>
        </View>
        {projects.map((p, i) => (
          <View key={p.project_id} style={{
            paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
            borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0,
            borderTopColor: Colors.border,
          }}>
            <Text style={{ ...Typography.bodySmall, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 }}>{p.project_name}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name={p.daily_entry.completed ? 'checkmark-circle' : 'close-circle'} size={14}
                  color={p.daily_entry.completed ? Colors.success : Colors.error} />
                <Text style={{ ...Typography.caption, color: Colors.textSecondary }}>Entry</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name={p.machine_startup.completed ? 'checkmark-circle' : 'close-circle'} size={14}
                  color={p.machine_startup.completed ? Colors.success : p.machine_startup.done > 0 ? Colors.warning : Colors.error} />
                <Text style={{ ...Typography.caption, color: Colors.textSecondary }}>
                  Machines {p.machine_startup.done}/{p.machine_startup.total}
                </Text>
              </View>
              {p.standdown_email_needed && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="mail" size={14} color={Colors.warning} />
                  <Text style={{ ...Typography.caption, color: Colors.warning, fontWeight: '600' }}>Standdown</Text>
                </View>
              )}
              {p.open_breakdowns > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="warning" size={14} color={Colors.error} />
                  <Text style={{ ...Typography.caption, color: Colors.error }}>{p.open_breakdowns} BD</Text>
                </View>
              )}
            </View>
          </View>
        ))}
      </Card>
    )
  }

  return null
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const { activeProject, setActiveProject, setAvailableProjects } = useProjectStore()
  const isOnline = useNetworkStatus()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    if (user?.accessible_projects?.length) {
      setAvailableProjects(user.accessible_projects)
    }
  }, [user])

  useEffect(() => {
    if (!activeProject && user?.accessible_projects?.length) {
      const p = user.accessible_projects[0]
      const projectId = p.id
      api.projects.detail(projectId).then((r) => {
        try { saveReferenceData(`project_${projectId}`, r.data) } catch {}
        setActiveProject(r.data)
      }).catch(() => {
        const cached = getReferenceData(`project_${projectId}`)
        if (cached) {
          setActiveProject(cached as any)
        } else {
          // Fallback: set a minimal project so the UI is not stuck loading forever
          setActiveProject({
            id: projectId,
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
      })
    }
  }, [activeProject, user])

  const handleSwitchProject = async (projectId: number) => {
    if (projectId === activeProject?.id) { setSwitcherOpen(false); return }
    setSwitching(true)
    setSwitcherOpen(false)
    try {
      const { data } = await api.projects.detail(projectId)
      try { saveReferenceData(`project_${projectId}`, data) } catch {}
      setActiveProject(data)
    } catch {
      const cached = getReferenceData(`project_${projectId}`)
      if (cached) setActiveProject(cached as any)
    } finally {
      setSwitching(false)
    }
  }

  const { pending, syncing, lastSyncedAt, syncNow } = useSyncStatus()
  const queryClient = useQueryClient()

  const handleFullSync = async () => {
    await syncNow()
    await prefetchAllData()
    queryClient.invalidateQueries()
  }

  const {
    data: project,
    isLoading: projectLoading,
    error: projectError,
    refetch,
  } = useProject()

  const { data: entriesData, isLoading: entriesLoading } = useEntries(
    activeProject ? { per_page: 50 } : undefined
  )

  const { data: costs, isLoading: costsLoading } = useQuery({
    queryKey: ['project-costs', activeProject?.id],
    queryFn: () =>
      cachedQuery(`project_costs_${activeProject!.id}`, () =>
        api.projects.costs(activeProject!.id).then((r) => r.data)
      ),
    enabled: !!activeProject?.id,
    staleTime: 5 * 60 * 1000,
  })

  const allEntries = entriesData?.entries ?? []
  const recentEntries = allEntries.slice(0, 5)

  const { start: weekStart, end: weekEnd } = getWeekBounds()
  const weekEntries = allEntries.filter((e) => e.date >= weekStart && e.date <= weekEnd)

  const projectName = project?.name ?? activeProject?.name ?? 'Plytrack'
  const hasMultipleProjects = (user?.accessible_projects?.length ?? 0) > 1
  const isInitialLoading = !activeProject && !!user?.accessible_projects?.length

  const handleLogout = async () => {
    await useAuthStore.getState().logout()
    useProjectStore.getState().clearProject()
    queryClient.clear()
    router.replace('/login')
  }

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      {/* ── Header ── */}
      <ScreenHeader
        title="Dashboard"
        right={
          <View style={st.headerRight}>
            <View style={[st.networkDot, { backgroundColor: isOnline ? Colors.success : Colors.warning }]} />
            <TouchableOpacity
              onPress={handleLogout}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="log-out-outline" size={22} color={Colors.white} />
            </TouchableOpacity>
          </View>
        }
      />

      {/* ── Project switcher modal ── */}
      <Modal
        visible={switcherOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSwitcherOpen(false)}
      >
        <Pressable style={st.switcherOverlay} onPress={() => setSwitcherOpen(false)}>
          <View style={st.switcherSheet}>
            <Text style={st.switcherTitle}>Switch Project</Text>
            {user?.accessible_projects?.map((p) => {
              const isActive = p.id === activeProject?.id
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[st.switcherOption, isActive && st.switcherOptionActive]}
                  onPress={() => handleSwitchProject(p.id)}
                  activeOpacity={0.75}
                >
                  <View style={[st.switcherDot, { backgroundColor: isActive ? Colors.primary : Colors.border }]} />
                  <Text style={[st.switcherOptionText, isActive && st.switcherOptionTextActive]} numberOfLines={2}>
                    {p.name}
                  </Text>
                  {isActive && <Ionicons name="checkmark-circle" size={18} color={Colors.primary} />}
                </TouchableOpacity>
              )
            })}
          </View>
        </Pressable>
      </Modal>

      {/* ── Project name + site details ── */}
      {!isInitialLoading && (
        <TouchableOpacity
          style={st.siteHeader}
          onPress={() => hasMultipleProjects && setSwitcherOpen(true)}
          activeOpacity={hasMultipleProjects ? 0.7 : 1}
          disabled={!hasMultipleProjects}
        >
          <View style={st.siteProjectRow}>
            {switching ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ marginRight: Spacing.sm }} />
            ) : null}
            <Text style={st.siteProjectName} numberOfLines={1} adjustsFontSizeToFit>
              {projectName}
            </Text>
            {hasMultipleProjects && (
              <Ionicons name="chevron-down" size={18} color={Colors.primary} style={{ marginLeft: Spacing.xs }} />
            )}
          </View>
          {(project?.site_address || project?.site_contact) && (
            <View style={st.siteDetailRow}>
              {project?.site_address && (
                <View style={st.siteDetailItem}>
                  <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.5)" />
                  <Text style={st.siteDetailText} numberOfLines={1}>{project.site_address}</Text>
                </View>
              )}
              {project?.site_contact && (
                <View style={st.siteDetailItem}>
                  <Ionicons name="person-outline" size={12} color="rgba(255,255,255,0.5)" />
                  <Text style={st.siteDetailText} numberOfLines={1}>{project.site_contact}</Text>
                </View>
              )}
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* ── Accent line ── */}
      <View style={st.accentLine} />

      {/* ── Scrollable body ── */}
      <ScrollView
        style={st.scroll}
        contentContainerStyle={st.content}
        showsVerticalScrollIndicator={false}
      >
        {/* New entry button */}
        <TouchableOpacity
          style={st.newEntryBtn}
          onPress={() => router.push('/entry/new')}
          activeOpacity={0.85}
        >
          <Ionicons name="add-circle-outline" size={20} color={Colors.dark} style={{ marginRight: Spacing.sm }} />
          <Text style={st.newEntryText}>+ NEW DAILY ENTRY</Text>
        </TouchableOpacity>

        {/* Sync status bar */}
        <SyncStatusBar
          pending={pending}
          syncing={syncing}
          lastSyncedAt={lastSyncedAt}
          isOnline={isOnline}
          onSyncNow={handleFullSync}
        />

        {projectError ? (
          <ErrorCard onRetry={refetch} />
        ) : (
          <>
            {/* Overall progress donut */}
            <OverallDonutCard
              progress={project?.progress}
              costs={costs}
              isLoading={isInitialLoading || projectLoading}
            />

            {/* Progress vs Schedule — donut with actual & should-be rings */}
            <ProgressComparisonCard
              progress={project?.progress}
              isLoading={isInitialLoading || projectLoading}
            />

            {/* Crew staffing display */}
            <CrewStaffingRow
              progress={project?.progress}
              isLoading={isInitialLoading || projectLoading}
            />

            {/* Weekly summary */}
            <WeeklySummaryCard entries={weekEntries} isLoading={entriesLoading} />

            {/* Hours breakdown bar */}
            <HoursBreakdownCard
              progress={project?.progress}
              isLoading={isInitialLoading || projectLoading}
            />

            {/* Delay impact panel */}
            <DelayImpactCard
              progress={project?.progress}
              isLoading={isInitialLoading || projectLoading}
            />

            {/* Delay summary by reason */}
            <DelaySummaryCard
              progress={project?.progress}
              isLoading={isInitialLoading || projectLoading}
            />

            {/* Recent entries */}
            <RecentEntries
              entries={recentEntries}
              isLoading={entriesLoading}
              onSeeAll={() => router.push('/(tabs)/entries')}
              onEntryPress={(id) => router.push(`/entry/${id}`)}
            />

            {/* Productivity */}
            <ProductivityCard
              productivity={project?.productivity}
              isLoading={isInitialLoading || projectLoading}
            />

            {/* Costs */}
            <CostCard costs={costs} isLoading={costsLoading} />

            {/* Reports (admin/supervisor only) */}
            <ReportsPanel />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.dark,
  },

  // Header right items
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
  siteHeader: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  siteProjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  siteProjectName: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.white,
    fontFamily: 'Montserrat_700Bold',
    letterSpacing: 0.5,
    flexShrink: 1,
  },

  // Project switcher modal
  switcherOverlay: {
    flex: 1,
    backgroundColor: 'rgba(26,10,16,0.5)',
    justifyContent: 'flex-end',
  },
  switcherSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingBottom: Spacing.xxl,
    ...Shadows.md,
  },
  switcherTitle: {
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
  switcherOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  switcherOptionActive: {
    backgroundColor: 'rgba(255,183,197,0.08)',
  },
  switcherDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  switcherOptionText: {
    ...Typography.body,
    color: Colors.textPrimary,
    flex: 1,
  },
  switcherOptionTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  siteDetailRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginTop: 3,
  },
  siteDetailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  siteDetailText: {
    ...Typography.caption,
    color: 'rgba(255,255,255,0.6)',
  },
  accentLine: {
    height: 2,
    backgroundColor: Colors.primary,
    marginHorizontal: Spacing.md,
    borderRadius: 1,
    marginBottom: 2,
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
    ...Shadows.sm,
  },
  newEntryText: {
    ...Typography.h4,
    color: Colors.dark,
    letterSpacing: 1,
    fontFamily: 'Montserrat_600SemiBold',
  },

  // Shared card
  card: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },

  // Shared text
  label: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  empty: {
    ...Typography.body,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },

  // Overall donut
  donutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  donutPct: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.primary,
    fontFamily: 'Montserrat_700Bold',
    textAlign: 'center',
    textShadowColor: 'rgba(255,183,197,0.4)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  donutSub: {
    ...Typography.caption,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  donutStats: {
    flex: 1,
    gap: Spacing.sm,
  },
  donutStat: {
    flex: 1,
    alignItems: 'center',
  },
  donutStatNum: {
    ...Typography.h3,
    color: Colors.textPrimary,
    textAlign: 'center',
    fontWeight: '700',
  },
  donutStatCaption: {
    ...Typography.caption,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 1,
  },
  statDivider: {
    height: 1,
    backgroundColor: Colors.border,
  },

  // Weekly summary
  weekRow: {
    flexDirection: 'row',
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
  weekCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  cellDivider: {
    width: 1,
    backgroundColor: Colors.border,
    alignSelf: 'stretch',
  },
  weekNum: {
    ...Typography.h3,
    color: Colors.textPrimary,
    fontFamily: 'Montserrat_700Bold',
    fontWeight: '700',
  },
  weekCaption: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: 2,
    textAlign: 'center',
  },
  delayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,152,0,0.15)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
  },
  delayPillText: {
    ...Typography.caption,
    color: Colors.warning,
    fontWeight: '600',
  },

  // Lot cards (horizontal scroll)
  lotSection: {
    marginBottom: Spacing.sm,
  },
  lotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    paddingRight: Spacing.md,
  },
  matFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    marginRight: Spacing.md,
  },
  matFilterText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '600',
    maxWidth: 110,
  },
  matOverlay: {
    flex: 1,
    backgroundColor: 'rgba(26,10,16,0.4)',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  matDropdown: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadows.md,
  },
  matDropdownTitle: {
    ...Typography.label,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  matOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  matOptionActive: {
    backgroundColor: 'rgba(255,183,197,0.1)',
  },
  matSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  matOptionText: {
    ...Typography.body,
    color: Colors.textPrimary,
    flex: 1,
  },
  matOptionTextActive: {
    color: Colors.primary,
    fontWeight: '600',
  },
  matTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 4,
    alignSelf: 'center',
  },
  matTagDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  matTagText: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  lotScroll: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  lotCard: {
    width: 136,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.sm,
    alignItems: 'center',
    ...Shadows.sm,
  },
  lotCardDone: {
    backgroundColor: 'rgba(76,175,80,0.08)',
  },
  lotCardLot: {
    ...Typography.label,
    color: Colors.textPrimary,
    fontFamily: 'Montserrat_600SemiBold',
    textAlign: 'center',
    marginBottom: 2,
  },
  lotCardMat: {
    ...Typography.caption,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  lotDonutWrap: {
    marginVertical: Spacing.xs,
  },
  lotDonutPct: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'Montserrat_700Bold',
    textAlign: 'center',
  },
  lotCardStat: {
    ...Typography.caption,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  completeBadge: {
    backgroundColor: 'rgba(76,175,80,0.15)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
  },
  completeBadgeText: {
    ...Typography.caption,
    color: Colors.success,
    fontWeight: '600',
  },

  // Recent entries
  recentSection: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  recentHeader: {
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
  rowDivider: {
    height: 1,
    backgroundColor: Colors.border,
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
    backgroundColor: 'rgba(255,152,0,0.15)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  delayBadgeText: {
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

  // Finish date estimates
  finishDates: {
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 6,
  },
  finishRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  finishLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  finishValue: {
    ...Typography.caption,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  behindPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,152,0,0.15)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  behindText: {
    ...Typography.caption,
    color: Colors.warning,
    fontWeight: '600',
  },

  // Productivity overall banner
  prodOverall: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  prodOverallItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  prodOverallNum: {
    ...Typography.h4,
    color: Colors.textPrimary,
  },
  prodOverallCaption: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },

  // Productivity table
  prodHeader: {
    flexDirection: 'row',
    paddingBottom: Spacing.xs,
    marginBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  prodRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  prodCell: {
    flex: 1,
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  prodNum: {
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  prodMatName: {
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  prodPct: {
    fontWeight: '700',
  },
  prodFootnote: {
    ...Typography.caption,
    color: Colors.textLight,
    marginTop: Spacing.sm,
    fontStyle: 'italic',
  },

  // Retry
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
