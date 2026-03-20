import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useProjectStore } from '../store/project'

export function useProject() {
  const activeProject = useProjectStore((s) => s.activeProject)

  return useQuery({
    queryKey: ['project', activeProject?.id],
    queryFn: () => api.projects.detail(activeProject!.id).then((r) => r.data),
    enabled: !!activeProject,
    staleTime: 5 * 60 * 1000,
  })
}
