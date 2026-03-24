import { getUnsyncedEntries, markEntrySynced, getPendingPhotos, deletePendingPhotos } from './db'
import { api } from './api'

/**
 * Pushes all locally-saved unsynced entries to the server,
 * including employee_ids, machine_ids, standdown_machine_ids, and photos.
 * Silently skips any that fail — they'll be retried on the next call.
 */
export async function syncPendingEntries(): Promise<void> {
  const unsynced = getUnsyncedEntries()
  if (unsynced.length === 0) return

  for (const entry of unsynced) {
    try {
      const response = await api.entries.create({
        ...entry,
        employee_ids: entry.employee_ids ?? [],
        machine_ids: entry.machine_ids ?? [],
        standdown_machine_ids: entry.standdown_machine_ids ?? [],
      } as any)
      const serverId = response.data.id
      markEntrySynced(entry.local_id, serverId)

      // Upload any pending photos for this entry
      const photos = getPendingPhotos(entry.local_id)
      let allUploaded = true
      for (const photo of photos) {
        try {
          await api.photos.upload(serverId, photo.uri, photo.filename)
        } catch {
          allUploaded = false
        }
      }
      if (allUploaded) {
        deletePendingPhotos(entry.local_id)
      }
    } catch {
      // Leave synced = 0 so it retries next time we come online
    }
  }
}
