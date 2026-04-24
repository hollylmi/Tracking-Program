import { useState, useMemo, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ScreenHeader from '../../components/layout/ScreenHeader'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import CheckModal, { CONDITION_OPTIONS } from '../../components/equipment/CheckModal'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { api } from '../../lib/api'
import { useToastStore } from '../../store/toast'
import { useProjectStore } from '../../store/project'
import type { DailyCheckMachine } from '../../types'

export default function PreStartScreen() {
  const params = useLocalSearchParams<{ projectId: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { show } = useToastStore()
  const availableProjects = useProjectStore((s) => s.availableProjects)
  const activeProject = useProjectStore((s) => s.activeProject)

  const projectId = Number(params.projectId)
  const project = availableProjects.find((p) => p.id === projectId) || (activeProject?.id === projectId ? activeProject : null)

  const [checkingMachine, setCheckingMachine] = useState<DailyCheckMachine | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['daily-checks', projectId],
    queryFn: () => api.equipment.projectDailyChecks(projectId).then((r) => r.data),
    enabled: !!projectId,
    staleTime: 30_000,
  })

  const machines = data?.machines ?? []
  const total = data?.total ?? 0
  const checked = data?.checked ?? 0
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0

  const sorted = useMemo(() => {
    // Unchecked first (alerts first), then checked
    return [...machines].sort((a, b) => {
      const aChecked = !!a.check
      const bChecked = !!b.check
      if (aChecked !== bChecked) return aChecked ? 1 : -1
      return (a.name || '').localeCompare(b.name || '')
    })
  }, [machines])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await refetch() } finally { setRefreshing(false) }
  }, [refetch])

  const handleSubmit = useCallback(
    async (condition: string, notes: string, hoursReading: string | undefined,
           photos: { uri: string; filename: string }[], tagUid: string | undefined) => {
      if (!checkingMachine) return
      try {
        await api.equipment.submitDailyCheck({
          machine_id: checkingMachine.machine_id ?? undefined,
          hired_machine_id: checkingMachine.hired_machine_id ?? undefined,
          project_id: projectId,
          condition,
          notes: notes || undefined,
          hours_reading: hoursReading,
          tag_uid: tagUid,
          photos,
        })
        show('Pre-start recorded', 'success')
        setCheckingMachine(null)
        queryClient.invalidateQueries({ queryKey: ['daily-checks'] })
        if (condition === 'broken_down') {
          router.push({
            pathname: '/breakdown/new',
            params: {
              machine_id: String(checkingMachine.machine_id ?? ''),
              machine_name: checkingMachine.name,
            },
          })
        }
      } catch {
        show('Failed to submit pre-start', 'error')
      }
    },
    [checkingMachine, projectId, queryClient, router, show]
  )

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <ScreenHeader
        title="Pre-Start"
        subtitle={project?.name}
        showBack
      />

      {/* Progress bar */}
      <View style={s.progressWrap}>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, {
            width: `${pct}%`,
            backgroundColor: pct === 100 ? Colors.success : Colors.primary,
          }]} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.xs }}>
          <Text style={s.progressLabel}>{checked} / {total} pre-started</Text>
          <Text style={[s.progressLabel, { color: pct === 100 ? Colors.success : Colors.textSecondary }]}>
            {pct === 100 ? 'All done' : `${pct}%`}
          </Text>
        </View>
      </View>

      {isLoading && machines.length === 0 ? (
        <View style={{ padding: Spacing.md }}>
          <View style={s.skeleton} />
          <View style={s.skeleton} />
          <View style={s.skeleton} />
        </View>
      ) : total === 0 ? (
        <EmptyState
          icon="🔧"
          title="No equipment"
          subtitle="No machines assigned to this site yet."
        />
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(m) => m.machine_id ? `m-${m.machine_id}` : `h-${m.hired_machine_id}`}
          renderItem={({ item }) => (
            <MachineRow
              machine={item}
              onPress={() => setCheckingMachine(item)}
            />
          )}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
          ListFooterComponent={
            <Text style={s.hint}>
              Only pre-start the machines you're using today. Unused machines can be skipped.
            </Text>
          }
        />
      )}

      {checkingMachine && (
        <CheckModal
          visible={!!checkingMachine}
          machineName={checkingMachine.name}
          isFleetMachine={checkingMachine.source === 'fleet'}
          activeTagUid={checkingMachine.active_tag_uid}
          onClose={() => setCheckingMachine(null)}
          onSubmit={handleSubmit}
        />
      )}
    </SafeAreaView>
  )
}

function MachineRow({ machine, onPress }: { machine: DailyCheckMachine; onPress: () => void }) {
  const checked = !!machine.check
  const condOpt = CONDITION_OPTIONS.find((c) => c.value === machine.check?.condition)
  const hasAlerts = machine.alerts && machine.alerts.length > 0
  const hasTag = !!machine.active_tag_uid

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} disabled={checked}>
      <Card padding="none" style={{ overflow: 'hidden', opacity: checked ? 0.7 : 1 }}>
        <View style={[s.accentBar, {
          backgroundColor: checked ? Colors.success : hasAlerts ? Colors.warning : Colors.border,
        }]} />
        <View style={s.row}>
          <View style={[s.iconWrap, {
            backgroundColor: checked ? 'rgba(61,139,65,0.15)' : hasAlerts ? 'rgba(201,106,0,0.1)' : Colors.surface,
          }]}>
            <Ionicons
              name={checked ? 'checkmark-circle' : hasAlerts ? 'alert-circle' : 'ellipse-outline'}
              size={22}
              color={checked ? Colors.success : hasAlerts ? Colors.warning : Colors.textLight}
            />
          </View>
          <View style={s.info}>
            <Text style={s.name}>{machine.name}</Text>
            {machine.plant_id ? <Text style={s.type}>#{machine.plant_id}</Text> : null}
            {machine.type ? <Text style={s.type}>{machine.type}</Text> : null}
            {!checked && !hasTag ? (
              <Text style={[s.type, { color: Colors.textLight, fontStyle: 'italic' }]}>
                No tag registered — scan not required
              </Text>
            ) : null}
          </View>
          <View style={s.right}>
            {checked && condOpt ? (
              <View style={[s.statusPill, { backgroundColor: condOpt.bg }]}>
                <Text style={[s.statusText, { color: condOpt.color }]}>{condOpt.label}</Text>
              </View>
            ) : (
              <View style={s.scanBtn}>
                <Ionicons
                  name={hasTag ? 'scan-outline' : 'arrow-forward'}
                  size={14}
                  color={Colors.dark}
                  style={{ marginRight: 4 }}
                />
                <Text style={s.scanBtnText}>{hasTag ? 'Scan & Check' : 'Check'}</Text>
              </View>
            )}
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  progressWrap: {
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  progressTrack: { height: 8, backgroundColor: Colors.border, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  progressLabel: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '600' },
  list: { padding: Spacing.md, gap: Spacing.sm },
  accentBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.md, paddingLeft: Spacing.md + 4, paddingRight: Spacing.md, gap: Spacing.md },
  iconWrap: { width: 40, height: 40, borderRadius: BorderRadius.md, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1 },
  name: { ...Typography.h4, color: Colors.textPrimary },
  type: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center' },
  statusPill: { borderRadius: BorderRadius.full, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { ...Typography.caption, fontWeight: '700' },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
  },
  scanBtnText: { ...Typography.caption, color: Colors.dark, fontWeight: '700' },
  skeleton: { height: 72, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, marginBottom: Spacing.sm },
  hint: {
    ...Typography.caption,
    color: Colors.textLight,
    textAlign: 'center',
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    fontStyle: 'italic',
  },
})
