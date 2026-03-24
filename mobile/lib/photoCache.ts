import * as FileSystem from 'expo-file-system/legacy'
import { useAuthStore } from '../store/auth'
import { API_BASE_URL } from '../constants/api'

const PHOTO_CACHE_DIR = `${FileSystem.cacheDirectory}photos/`

/** Ensure the cache directory exists */
async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(PHOTO_CACHE_DIR)
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PHOTO_CACHE_DIR, { intermediates: true })
  }
}

/** Convert a server photo URL to a stable local filename */
function urlToFilename(url: string): string {
  // Use the last path segment as filename (e.g. "abc123.jpg")
  const parts = url.split('/')
  const name = parts[parts.length - 1] || 'photo'
  // Strip query params
  return name.split('?')[0]
}

/** Get full URL from a potentially relative photo URL */
function fullUrl(url: string): string {
  if (url.startsWith('http')) return url
  return `${API_BASE_URL}${url}`
}

/**
 * Download a photo to local cache. Returns the local file URI.
 * If already cached, returns immediately without re-downloading.
 */
export async function cachePhoto(url: string): Promise<string> {
  await ensureDir()
  const filename = urlToFilename(url)
  const localUri = `${PHOTO_CACHE_DIR}${filename}`

  const info = await FileSystem.getInfoAsync(localUri)
  if (info.exists) {
    console.log('[PhotoCache] Already cached:', filename)
    return localUri
  }

  const token = useAuthStore.getState().accessToken
  const downloadUrl = fullUrl(url)
  console.log('[PhotoCache] Downloading:', downloadUrl, '→', localUri)

  const result = await FileSystem.downloadAsync(downloadUrl, localUri, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })

  console.log('[PhotoCache] Download result:', result.status, 'size:', result.headers?.['content-length'] ?? 'unknown')

  // Check if download actually produced a file (server might return HTML error page)
  if (result.status !== 200) {
    console.warn('[PhotoCache] Non-200 status:', result.status, 'for', url)
    // Delete the bad file
    try { await FileSystem.deleteAsync(localUri, { idempotent: true }) } catch {}
    throw new Error(`Photo download failed: ${result.status}`)
  }

  return localUri
}

/**
 * Get the local cached URI for a photo, or null if not cached.
 */
export async function getCachedPhotoUri(url: string): Promise<string | null> {
  const filename = urlToFilename(url)
  const localUri = `${PHOTO_CACHE_DIR}${filename}`
  const info = await FileSystem.getInfoAsync(localUri)
  return info.exists ? localUri : null
}

/**
 * Cache all photos for a list of entries. Called during prefetch.
 */
export async function cacheEntryPhotos(
  entries: Array<{ photos?: Array<{ url: string }> }>
): Promise<void> {
  const urls: string[] = []
  for (const entry of entries) {
    for (const photo of entry.photos ?? []) {
      urls.push(photo.url)
    }
  }
  console.log(`[PhotoCache] Caching ${urls.length} photos from ${entries.length} entries`)
  const results = await Promise.allSettled(urls.map((url) => cachePhoto(url)))
  const failed = results.filter(r => r.status === 'rejected')
  if (failed.length > 0) {
    console.warn(`[PhotoCache] ${failed.length}/${urls.length} photos failed to cache`)
  }
}
