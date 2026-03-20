import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useProjectStore } from '../store/project'

export function useReference() {
  const activeProject = useProjectStore((s) => s.activeProject)

  return useQuery({
    queryKey: ['reference'],
    queryFn: () => api.reference.get().then((r) => r.data),
    enabled: !!activeProject,
    staleTime: 30 * 60 * 1000,
  })
}
