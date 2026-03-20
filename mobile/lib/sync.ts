import { getUnsyncedEntries, markEntrySynced } from './db'
import { api } from './api'

/**
 * Pushes all locally-saved unsynced entries to the server.
 * Silently skips any that fail — they'll be retried on the next call.
 */
export async function syncPendingEntries(): Promise<void> {
  const unsynced = getUnsyncedEntries()
  if (unsynced.length === 0) return

  for (const entry of unsynced) {
    try {
      const response = await api.entries.create(entry)
      markEntrySynced(entry.local_id, response.data.id)
    } catch {
      // Leave synced = 0 so it retries next time we come online
    }
  }
}
