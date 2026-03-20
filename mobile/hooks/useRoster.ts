import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useRoster() {
  return useQuery({
    queryKey: ['roster'],
    queryFn: () => api.roster.get().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })
}
