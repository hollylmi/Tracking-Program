import { api } from './api'
import { saveReferenceData } from './db'
import { useAuthStore } from '../store/auth'
import { cacheEntryPhotos } from './photoCache'

/**
 * Prefetch all viewable data for every accessible project into SQLite cache.
 * Called after auth loads on app start, and on offline→online transitions.
 */
export async function prefetchAllData(): Promise<void> {
  const user = useAuthStore.getState().user
  if (!user) return

  const projects = user.accessible_projects ?? []

  // Prefetch in parallel per project, but don't let one failure kill everything
  await Promise.allSettled(
    projects.map((p) => prefetchProject(p.id))
  )

  // Global data (not project-scoped)
  await Promise.allSettled([
    fetchAndCache('equipment_all', () => api.equipment.list().then((r) => r.data.machines)),
    fetchAndCache('roster_my', () => api.roster.my().then((r) => r.data.schedule)),
    fetchAndCache('roster_my_full', () => api.roster.my().then((r) => r.data)),
    fetchAndCache('scheduling_grid_default', () => api.scheduling.grid().then((r) => r.data)),
  ])
}

async function prefetchProject(projectId: number): Promise<void> {
  // Cache keys MUST match exactly what the hooks/screens generate
  await Promise.allSettled([
    fetchAndCache(`project_${projectId}`, () =>
      api.projects.detail(projectId).then((r) => r.data)
    ),
    fetchAndCache(`reference_${projectId}`, () =>
      api.reference.get(projectId).then((r) => r.data)
    ),
    // Entries list + individual entry details + photos
    fetchAndCache(`entries_${projectId}_${JSON.stringify({ per_page: 200 })}`, async () => {
      const { data } = await api.entries.list({ project_id: projectId, per_page: 200 })
      // Fetch full details for each entry (for offline detail view + photo caching)
      const detailResults = await Promise.allSettled(
        data.entries.map(async (entry: any) => {
          const { data: detail } = await api.entries.detail(entry.id)
          saveReferenceData(`entry_${entry.id}`, detail)
          return detail
        })
      )
      // Download photo files for offline viewing
      const entryDetails = detailResults
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map((r) => r.value)
      try { await cacheEntryPhotos(entryDetails) } catch {}
      return data
    }),
    fetchAndCache(`entries_${projectId}_${JSON.stringify({ per_page: 50 })}`, () =>
      api.entries.list({ project_id: projectId, per_page: 50 }).then((r) => r.data)
    ),
    fetchAndCache(`project_costs_${projectId}`, () =>
      api.projects.costs(projectId).then((r) => r.data)
    ),
    fetchAndCache(`documents_${projectId}`, () =>
      api.documents.list(projectId).then((r) => r.data.documents)
    ),
    fetchAndCache(`breakdowns_${projectId}`, () =>
      api.equipment.breakdowns(projectId).then((r) => r.data.breakdowns)
    ),
    // Equipment tab uses project-scoped queries
    fetchAndCache(`machines_project_${projectId}`, () =>
      api.equipment.list(projectId).then((r) => r.data.machines)
    ),
    // Hired machines for the Equipment > Hired tab
    fetchAndCache(`hire_${projectId}`, () =>
      api.hire.list(projectId).then((r) => r.data.hired_machines)
    ),
    // Machine detail pages — cache each machine
    (async () => {
      try {
        const { data } = await api.equipment.list(projectId)
        await Promise.allSettled(
          data.machines.map((m: any) =>
            fetchAndCache(`machine_${m.id}`, () =>
              api.equipment.detail(m.id).then((r) => r.data)
            )
          )
        )
      } catch {}
    })(),
  ])
}

async function fetchAndCache(key: string, fetcher: () => Promise<unknown>): Promise<void> {
  try {
    const data = await fetcher()
    saveReferenceData(key, data)
  } catch {
    // Silently skip — stale cache is better than no cache
  }
}
