import { saveReferenceData, getReferenceData } from './db'

/**
 * Wraps an API call with SQLite caching.
 * - Online: fetches from API, caches result, returns it
 * - Offline / API failure: returns cached data from SQLite
 * - No cache and no network: throws so React Query shows error state
 */
export async function cachedQuery<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  try {
    const data = await fetcher()
    try { saveReferenceData(cacheKey, data) } catch {}
    return data
  } catch (err) {
    // API failed (offline, timeout, server error) — try cache
    const cached = getReferenceData(cacheKey) as T | null
    if (cached !== null) return cached
    throw err // no cache either — let React Query handle the error
  }
}
