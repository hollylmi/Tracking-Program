import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { cachedQuery } from '../lib/cachedQuery'

export function useRoster() {
  return useQuery({
    queryKey: ['roster'],
    queryFn: () =>
      cachedQuery('roster_my', () =>
        api.roster.my().then((r) => r.data.schedule)
      ),
    staleTime: 5 * 60 * 1000,
  })
}
