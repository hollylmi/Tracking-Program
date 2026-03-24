import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useProjectStore } from '../store/project'
import { cachedQuery } from '../lib/cachedQuery'
import { Document } from '../types'

export function useDocuments() {
  const activeProject = useProjectStore((s) => s.activeProject)

  return useQuery<Document[]>({
    queryKey: ['documents', activeProject?.id],
    queryFn: () =>
      cachedQuery(`documents_${activeProject!.id}`, () =>
        api.documents.list(activeProject?.id).then((r) => r.data.documents)
      ),
    enabled: !!activeProject,
    staleTime: 10 * 60 * 1000,
  })
}
