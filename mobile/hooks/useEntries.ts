import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useProjectStore } from '../store/project'
import { cachedQuery } from '../lib/cachedQuery'

export function useEntries(params?: Record<string, string | number | undefined>) {
  const activeProject = useProjectStore((s) => s.activeProject)

  return useQuery({
    queryKey: ['entries', activeProject?.id, params],
    queryFn: () =>
      cachedQuery(
        `entries_${activeProject!.id}_${JSON.stringify(params ?? {})}`,
        () => api.entries.list({ project_id: activeProject?.id, ...params }).then((r) => r.data)
      ),
    enabled: !!activeProject,
    staleTime: 2 * 60 * 1000,
  })
}
