import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useProjectStore } from '../store/project'
import { ReferenceData } from '../types'

export function useReference() {
  const activeProject = useProjectStore((s) => s.activeProject)

  return useQuery<ReferenceData>({
    queryKey: ['reference', activeProject?.id],
    queryFn: () => api.reference.get(activeProject?.id).then((r) => r.data as ReferenceData),
    enabled: !!activeProject,
    staleTime: 30 * 60 * 1000,
  })
}
