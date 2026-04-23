import { useState, useEffect } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, Alert, ActivityIndicator, Modal, StatusBar, Linking,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { WebView } from 'react-native-webview'
import ScreenHeader from '../../components/layout/ScreenHeader'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { API_BASE_URL } from '../../constants/api'
import { api } from '../../lib/api'
import { cachedQuery } from '../../lib/cachedQuery'
import { useAuthStore } from '../../store/auth'
import { useProjectStore } from '../../store/project'
import { Document } from '../../types'
import { cacheDocument, getCachedDocumentUri } from '../../lib/documentCache'

// ─── Config ───────────────────────────────────────────────────────────────────

const PDF_EXTS = new Set(['pdf'])
const BROWSER_EXTS = new Set(['doc', 'docx', 'xls', 'xlsx', 'dwg', 'dxf'])

const DOC_ICONS: Record<string, string> = {
  pdf:  'document-text-outline',
  dwg:  'layers-outline',
  dxf:  'layers-outline',
  doc:  'document-outline',
  docx: 'document-outline',
  xls:  'grid-outline',
  xlsx: 'grid-outline',
  png:  'image-outline',
  jpg:  'image-outline',
  jpeg: 'image-outline',
}

const DOC_COLORS: Record<string, string> = {
  pdf:  '#F44336',
  dwg:  '#2196F3',
  dxf:  '#2196F3',
  doc:  '#1565C0',
  docx: '#1565C0',
  xls:  '#2E7D32',
  xlsx: '#2E7D32',
  png:  '#9C27B0',
  jpg:  '#9C27B0',
  jpeg: '#9C27B0',
}

function getExt(filename: string) {
  return filename.split('.').pop()?.toLowerCase() ?? ''
}

import { formatDate as fmtDateAU } from '../../lib/dates'

function formatDate(dateStr: string) {
  return fmtDateAU(dateStr, { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── PDF Viewer Modal ─────────────────────────────────────────────────────────

function PdfViewerModal({
  doc, token, onClose,
}: {
  doc: Document
  token: string
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(true)
  const [url, setUrl] = useState(`${API_BASE_URL}/api/documents/${doc.id}/file?token=${token}`)

  // Try local cache first (for offline viewing)
  useEffect(() => {
    getCachedDocumentUri(doc.id, doc.filename).then((localUri) => {
      if (localUri) setUrl(localUri)
    })
  }, [doc.id])

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      <View style={[pdfStyles.root, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={pdfStyles.header}>
          <TouchableOpacity onPress={onClose} style={pdfStyles.closeBtn}>
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={pdfStyles.headerCenter}>
            <Text style={pdfStyles.headerTitle} numberOfLines={1}>{doc.filename}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* WebView renders PDF natively on iOS; uses system renderer on Android */}
        <WebView
          source={{ uri: url }}
          style={pdfStyles.pdf}
          onLoadEnd={() => setLoading(false)}
          onError={() => {
            Alert.alert('Error', 'Could not load document.')
            onClose()
          }}
          originWhitelist={['*']}
          allowFileAccess
        />

        {loading && (
          <View style={pdfStyles.loadingOverlay}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={pdfStyles.loadingText}>Loading…</Text>
          </View>
        )}
      </View>
    </Modal>
  )
}

// ─── Doc Card ─────────────────────────────────────────────────────────────────

function DocCard({ doc }: { doc: Document }) {
  const [opening, setOpening] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [isCached, setIsCached] = useState(false)
  const [pdfVisible, setPdfVisible] = useState(false)
  const token = useAuthStore(s => s.accessToken) ?? ''
  const ext = getExt(doc.filename)
  const icon = DOC_ICONS[ext] ?? 'document-outline'
  const color = DOC_COLORS[ext] ?? Colors.textSecondary

  // Check if doc is saved offline
  useEffect(() => {
    getCachedDocumentUri(doc.id, doc.filename).then((uri) => setIsCached(!!uri))
  }, [doc.id])

  const handleOpen = async () => {
    if (opening) return

    if (PDF_EXTS.has(ext)) {
      setPdfVisible(true)
      return
    }

    // Non-PDF: open in device browser
    setOpening(true)
    try {
      const url = `${API_BASE_URL}/api/documents/${doc.id}/file?token=${token}`
      await Linking.openURL(url)
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not open the document.')
    } finally {
      setOpening(false)
    }
  }

  const handleSaveOffline = async () => {
    setDownloading(true)
    try {
      await cacheDocument(doc.id, doc.filename)
      setIsCached(true)
    } catch {
      Alert.alert('Error', 'Could not save document for offline use.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      <Card padding="none">
        <View style={styles.docRow}>
          <View style={[styles.docIcon, { backgroundColor: color + '20' }]}>
            <Ionicons name={icon as any} size={22} color={color} />
          </View>
          <View style={styles.docInfo}>
            <Text style={styles.docName} numberOfLines={2}>{doc.filename}</Text>
            <Text style={styles.docMeta}>
              {ext.toUpperCase()}
              {doc.uploaded_at ? `  ·  ${formatDate(doc.uploaded_at)}` : ''}
              {isCached ? '  ·  Saved offline' : ''}
            </Text>
          </View>
          {!isCached && (
            <TouchableOpacity onPress={handleSaveOffline} style={styles.saveBtn} activeOpacity={0.8} disabled={downloading}>
              {downloading
                ? <ActivityIndicator size="small" color={Colors.textSecondary} />
                : <Ionicons name="download-outline" size={18} color={Colors.textSecondary} />}
            </TouchableOpacity>
          )}
          {isCached && (
            <Ionicons name="checkmark-circle" size={18} color={Colors.success} style={{ marginRight: 4 }} />
          )}
          <TouchableOpacity onPress={handleOpen} style={styles.openBtn} activeOpacity={0.8} disabled={opening}>
            {opening
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : <Ionicons name="eye-outline" size={20} color={Colors.primary} />}
          </TouchableOpacity>
        </View>
      </Card>

      {pdfVisible && (
        <PdfViewerModal
          doc={doc}
          token={token}
          onClose={() => setPdfVisible(false)}
        />
      )}
    </>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DocumentsScreen() {
  const [refreshing, setRefreshing] = useState(false)
  const activeProject = useProjectStore(s => s.activeProject)

  const { data: docs = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['documents', activeProject?.id],
    queryFn: () =>
      cachedQuery(`documents_${activeProject?.id}`, () =>
        api.documents.list(activeProject?.id).then(r => r.data.documents)
      ),
    staleTime: 5 * 60 * 1000,
  })

  const handleRefresh = async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title="Documents" subtitle={activeProject?.name} />

      {isLoading ? (
        <View style={styles.loadingBody}>
          {[0, 1, 2, 3].map(i => <View key={i} style={styles.skeleton} />)}
        </View>
      ) : isError ? (
        <View style={styles.errorBody}>
          <Text style={styles.errorText}>Could not load documents.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={d => String(d.id)}
          renderItem={({ item }) => <DocCard doc={item} />}
          contentContainerStyle={[styles.list, docs.length === 0 && styles.listEmpty]}
          ListEmptyComponent={
            <EmptyState
              icon="📁"
              title="No documents"
              subtitle={activeProject ? 'No documents uploaded for this project' : 'Select a project to view documents'}
            />
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },
  loadingBody: { flex: 1, backgroundColor: Colors.background, padding: Spacing.md, gap: Spacing.sm },
  list: { padding: Spacing.md, gap: Spacing.sm, backgroundColor: Colors.background },
  listEmpty: { flexGrow: 1, backgroundColor: Colors.background },
  docRow: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, gap: Spacing.md },
  docIcon: { width: 44, height: 44, borderRadius: BorderRadius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  docInfo: { flex: 1 },
  docName: { ...Typography.bodySmall, color: Colors.textPrimary, fontWeight: '500' },
  docMeta: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  openBtn: { padding: Spacing.sm },
  saveBtn: { padding: Spacing.sm },
  skeleton: { height: 72, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, marginBottom: Spacing.sm },
  errorBody: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  errorText: { ...Typography.body, color: Colors.textSecondary },
  retryBtn: { backgroundColor: Colors.primary, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  retryText: { ...Typography.body, color: Colors.dark, fontWeight: '600' },
})

const pdfStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1a1a1a' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: '#1a1a1a', borderBottomWidth: 1, borderColor: '#333',
  },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { ...Typography.bodySmall, color: '#fff', fontWeight: '600' },
  headerPages: { ...Typography.caption, color: '#aaa', marginTop: 2 },
  pdf: { flex: 1, backgroundColor: '#2a2a2a' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1a1a1a',
    alignItems: 'center', justifyContent: 'center', gap: Spacing.md,
  },
  loadingText: { ...Typography.bodySmall, color: '#aaa' },
})
