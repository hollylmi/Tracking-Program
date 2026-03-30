import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useProjectStore } from '../store/project'
import { cachedQuery } from '../lib/cachedQuery'
import { Machine, Breakdown, DailyChecksResponse, EquipmentChecklist, MachineDetail } from '../types'

export function useEquipment() {
  return useQuery<Machine[]>({
    queryKey: ['equipment'],
    queryFn: () =>
      cachedQuery('equipment_all', () =>
        api.equipment.list().then((r) => r.data.machines)
      ),
    staleTime: 10 * 60 * 1000,
  })
}

export function useBreakdowns() {
  const activeProject = useProjectStore((s) => s.activeProject)

  return useQuery<Breakdown[]>({
    queryKey: ['breakdowns', activeProject?.id],
    queryFn: () =>
      cachedQuery(`breakdowns_${activeProject?.id ?? 'all'}`, () =>
        api.equipment.breakdowns().then((r) => r.data.breakdowns)
      ),
    staleTime: 5 * 60 * 1000,
  })
}

export function useDailyChecks(projectId?: number, dateStr?: string) {
  return useQuery<DailyChecksResponse>({
    queryKey: ['daily-checks', projectId, dateStr],
    queryFn: () =>
      api.equipment.projectDailyChecks(projectId!, dateStr).then((r) => r.data),
    enabled: !!projectId,
    staleTime: 60 * 1000,
  })
}

export function useChecklist(checklistId?: number) {
  return useQuery<EquipmentChecklist>({
    queryKey: ['checklist', checklistId],
    queryFn: () =>
      api.equipment.checklist(checklistId!).then((r) => r.data),
    enabled: !!checklistId,
    staleTime: 60 * 1000,
  })
}

export function useMachineDetail(machineId?: number) {
  return useQuery<MachineDetail>({
    queryKey: ['machine-detail', machineId],
    queryFn: () =>
      api.equipment.machineDetail(machineId!).then((r) => r.data),
    enabled: !!machineId,
    staleTime: 2 * 60 * 1000,
  })
}
