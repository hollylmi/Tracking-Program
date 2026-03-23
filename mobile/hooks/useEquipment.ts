import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useProjectStore } from '../store/project'

export function useEquipment() {
  return useQuery({
    queryKey: ['equipment'],
    queryFn: () => api.equipment.list().then((r) => r.data.machines),
    staleTime: 10 * 60 * 1000,
  })
}

export function useBreakdowns() {
  const activeProject = useProjectStore((s) => s.activeProject)

  return useQuery({
    queryKey: ['breakdowns', activeProject?.id],
    queryFn: () => api.equipment.breakdowns().then((r) => r.data.breakdowns),
    staleTime: 5 * 60 * 1000,
  })
}
