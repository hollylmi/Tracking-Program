import * as FileSystem from 'expo-file-system/legacy'
import { useAuthStore } from '../store/auth'
import { API_BASE_URL } from '../constants/api'

const DOC_CACHE_DIR = `${FileSystem.documentDirectory}documents/`

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DOC_CACHE_DIR)
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DOC_CACHE_DIR, { intermediates: true })
  }
}

function safeFilename(docId: number, filename: string): string {
  return `${docId}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
}

/**
 * Download a document for offline viewing.
 * Returns the local file URI.
 */
export async function cacheDocument(docId: number, filename: string): Promise<string> {
  await ensureDir()
  const localName = safeFilename(docId, filename)
  const localUri = `${DOC_CACHE_DIR}${localName}`

  const info = await FileSystem.getInfoAsync(localUri)
  if (info.exists) return localUri

  const token = useAuthStore.getState().accessToken
  const url = `${API_BASE_URL}/api/documents/${docId}/file?token=${token}`

  await FileSystem.downloadAsync(url, localUri)
  return localUri
}

/**
 * Check if a document is cached locally. Returns the URI or null.
 */
export async function getCachedDocumentUri(docId: number, filename: string): Promise<string | null> {
  const localName = safeFilename(docId, filename)
  const localUri = `${DOC_CACHE_DIR}${localName}`
  const info = await FileSystem.getInfoAsync(localUri)
  return info.exists ? localUri : null
}

/**
 * Check if document is cached (sync version for UI indicators).
 */
export function isDocumentCachedSync(docId: number, filename: string): Promise<boolean> {
  return getCachedDocumentUri(docId, filename).then((uri) => uri !== null)
}
