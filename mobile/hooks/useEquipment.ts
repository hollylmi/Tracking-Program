import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useProjectStore } from '../store/project'
import { cachedQuery } from '../lib/cachedQuery'
import { Machine, Breakdown } from '../types'

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
