import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useProjectStore } from '../store/project'

export function useDocuments() {
  const activeProject = useProjectStore((s) => s.activeProject)

  return useQuery({
    queryKey: ['documents', activeProject?.id],
    queryFn: () => api.documents.list(activeProject?.id).then((r) => r.data),
    enabled: !!activeProject,
    staleTime: 10 * 60 * 1000,
  })
}
