import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useProjectStore } from '../store/project'
import { ReferenceData } from '../types'

export function useReference() {
  const activeProject = useProjectStore((s) => s.activeProject)

  return useQuery<ReferenceData>({
    queryKey: ['reference'],
    queryFn: () => api.reference.get().then((r) => r.data as ReferenceData),
    enabled: !!activeProject,
    staleTime: 30 * 60 * 1000,
  })
}
