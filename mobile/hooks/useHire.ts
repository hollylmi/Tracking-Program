import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useProjectStore } from '../store/project'
import { cachedQuery } from '../lib/cachedQuery'
import { HiredMachine } from '../types'

export function useHire(projectId?: number) {
  const activeProject = useProjectStore((s) => s.activeProject)
  const pid = projectId ?? activeProject?.id

  return useQuery<HiredMachine[]>({
    queryKey: ['hire', pid],
    queryFn: () =>
      cachedQuery(`hire_${pid}`, () =>
        api.hire.list(pid).then((r) => r.data.hired_machines)
      ),
    enabled: !!pid,
    staleTime: 5 * 60 * 1000,
  })
}
