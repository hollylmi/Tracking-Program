import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useProjectStore } from '../store/project'
import { cachedQuery } from '../lib/cachedQuery'
import { Project } from '../types'

export function useProject() {
  const activeProject = useProjectStore((s) => s.activeProject)

  return useQuery<Project>({
    queryKey: ['project', activeProject?.id],
    queryFn: () =>
      cachedQuery(`project_${activeProject!.id}`, () =>
        api.projects.detail(activeProject!.id).then((r) => r.data)
      ),
    enabled: !!activeProject,
    staleTime: 5 * 60 * 1000,
  })
}
