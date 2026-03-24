import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getUnsyncedEntries, getUnsyncedBreakdowns,
  markEntrySynced, markBreakdownSynced,
  getPendingPhotos, deletePendingPhotos,
} from '../lib/db'
import { api } from '../lib/api'
import { useToastStore } from '../store/toast'

export interface SyncStatus {
  pendingEntries: number
  pendingBreakdowns: number
  pending: number          // total
  syncing: boolean
  lastSyncedAt: Date | null
  syncNow: () => Promise<void>
  refresh: () => void
}

export function useSyncStatus(): SyncStatus {
  const [pendingEntries, setPendingEntries] = useState(0)
  const [pendingBreakdowns, setPendingBreakdowns] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const showToast = useToastStore((s) => s.show)
  const syncingRef = useRef(false)

  const refresh = useCallback(() => {
    try {
      setPendingEntries(getUnsyncedEntries().length)
      setPendingBreakdowns(getUnsyncedBreakdowns().length)
    } catch {
      // DB not ready yet
    }
  }, [])

  // Poll SQLite every 5s so the count stays current
  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh])

  const syncNow = useCallback(async () => {
    if (syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)

    let synced = 0
    let failed = 0

    try {
      const unsyncedEntries = getUnsyncedEntries()
      for (const entry of unsyncedEntries) {
        try {
          const res = await api.entries.create({
            ...entry,
            employee_ids: entry.employee_ids ?? [],
            machine_ids: entry.machine_ids ?? [],
            standdown_machine_ids: entry.standdown_machine_ids ?? [],
          } as any)
          const serverId = res.data.id
          markEntrySynced(entry.local_id, serverId)
          synced++

          // Upload any pending photos
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
          failed++
        }
      }

      const unsyncedBreakdowns = getUnsyncedBreakdowns()
      for (const bd of unsyncedBreakdowns) {
        try {
          const res = await api.equipment.createBreakdown({
            machine_id: bd.machine_id,
            breakdown_date: bd.breakdown_date,
            description: bd.description,
          })
          markBreakdownSynced(bd.local_id, (res.data as any).id)
          synced++
        } catch {
          failed++
        }
      }

      if (synced > 0 || failed === 0) {
        setLastSyncedAt(new Date())
        if (synced > 0) {
          showToast(`Synced ${synced} item${synced !== 1 ? 's' : ''}`, 'success')
        }
      }
      if (failed > 0) {
        showToast(`${failed} item${failed !== 1 ? 's' : ''} failed to sync`, 'warning')
      }
    } finally {
      refresh()
      setSyncing(false)
      syncingRef.current = false
    }
  }, [refresh, showToast])

  return {
    pendingEntries,
    pendingBreakdowns,
    pending: pendingEntries + pendingBreakdowns,
    syncing,
    lastSyncedAt,
    syncNow,
    refresh,
  }
}
