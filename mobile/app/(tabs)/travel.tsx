import { useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, Linking, SectionList,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import ScreenHeader from '../../components/layout/ScreenHeader'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme'
import { API_BASE_URL } from '../../constants/api'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/auth'

type Flight = {
  id: number
  date: string
  direction: 'inbound' | 'outbound'
  airline: string | null
  flight_number: string | null
  departure_airport: string | null
  departure_time: string | null
  arrival_airport: string | null
  arrival_time: string | null
  booking_reference: string | null
  notes: string | null
}

type Housemate = {
  name: string
  room_info: string | null
  date_from: string
  date_to: string
}

type AccomDoc = {
  id: number
  title: string
  original_name: string
  doc_type: string
  url: string
}

type Accommodation = {
  id: number
  date_from: string
  date_to: string
  property_name: string | null
  address: string | null
  phone: string | null
  room_info: string | null
  booking_reference: string | null
  check_in_time: string | null
  check_out_time: string | null
  notes: string | null
  housemates: Housemate[]
  instructions: string | null
  documents: AccomDoc[]
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

function FlightCard({ flight }: { flight: Flight }) {
  const isInbound = flight.direction === 'inbound'
  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.row}>
          <View style={[styles.dirBadge, { backgroundColor: isInbound ? '#1B5E2015' : '#E6510015' }]}>
            <Ionicons
              name={isInbound ? 'arrow-forward-circle' : 'arrow-back-circle'}
              size={16}
              color={isInbound ? '#2E7D32' : '#E65100'}
            />
            <Text style={[styles.dirText, { color: isInbound ? '#2E7D32' : '#E65100' }]}>
              {isInbound ? 'Inbound' : 'Outbound'}
            </Text>
          </View>
          <Text style={styles.dateText}>{formatDate(flight.date)}</Text>
        </View>
      </View>
      <View style={styles.routeRow}>
        <View style={styles.airport}>
          <Text style={styles.airportCode}>{flight.departure_airport || '—'}</Text>
          <Text style={styles.timeText}>{flight.departure_time || ''}</Text>
        </View>
        <View style={styles.arrowContainer}>
          <View style={styles.arrowLine} />
          <Ionicons name="airplane" size={16} color={Colors.primary} />
          <View style={styles.arrowLine} />
        </View>
        <View style={[styles.airport, { alignItems: 'flex-end' }]}>
          <Text style={styles.airportCode}>{flight.arrival_airport || '—'}</Text>
          <Text style={styles.timeText}>{flight.arrival_time || ''}</Text>
        </View>
      </View>
      {(flight.airline || flight.flight_number) && (
        <View style={styles.detailRow}>
          <Ionicons name="ticket-outline" size={14} color={Colors.textSecondary} />
          <Text style={styles.detailText}>
            {[flight.airline, flight.flight_number].filter(Boolean).join(' ')}
          </Text>
        </View>
      )}
      {flight.booking_reference && (
        <View style={styles.detailRow}>
          <Ionicons name="bookmark-outline" size={14} color={Colors.textSecondary} />
          <Text style={styles.detailText}>Ref: {flight.booking_reference}</Text>
        </View>
      )}
      {flight.notes && (
        <View style={styles.detailRow}>
          <Ionicons name="chatbubble-outline" size={14} color={Colors.textSecondary} />
          <Text style={styles.detailText}>{flight.notes}</Text>
        </View>
      )}
    </Card>
  )
}

function AccommodationCard({ accom }: { accom: Accommodation }) {
  const [expanded, setExpanded] = useState(false)
  const token = useAuthStore((s) => s.accessToken)

  const openDoc = (url: string) => {
    Linking.openURL(`${API_BASE_URL}${url}`)
  }

  return (
    <Card style={styles.card}>
      <TouchableOpacity onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.propertyName}>{accom.property_name || 'Accommodation'}</Text>
            {accom.address && (
              <View style={styles.detailRow}>
                <Ionicons name="location-outline" size={14} color={Colors.textSecondary} />
                <Text style={styles.detailText}>{accom.address}</Text>
              </View>
            )}
          </View>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={Colors.textSecondary} />
        </View>
        <View style={styles.dateRange}>
          <Text style={styles.dateRangeText}>
            {formatDate(accom.date_from)} — {formatDate(accom.date_to)}
          </Text>
          {accom.room_info && (
            <View style={styles.roomBadge}>
              <Text style={styles.roomText}>{accom.room_info}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.expandedContent}>
          {/* Times */}
          {(accom.check_in_time || accom.check_out_time) && (
            <View style={styles.timesRow}>
              {accom.check_in_time && (
                <View style={styles.timeItem}>
                  <Ionicons name="log-in-outline" size={14} color="#2E7D32" />
                  <Text style={styles.detailText}>Check-in: {accom.check_in_time}</Text>
                </View>
              )}
              {accom.check_out_time && (
                <View style={styles.timeItem}>
                  <Ionicons name="log-out-outline" size={14} color="#E65100" />
                  <Text style={styles.detailText}>Check-out: {accom.check_out_time}</Text>
                </View>
              )}
            </View>
          )}

          {accom.phone && (
            <TouchableOpacity style={styles.detailRow} onPress={() => Linking.openURL(`tel:${accom.phone}`)}>
              <Ionicons name="call-outline" size={14} color={Colors.primary} />
              <Text style={[styles.detailText, { color: Colors.primary }]}>{accom.phone}</Text>
            </TouchableOpacity>
          )}

          {accom.booking_reference && (
            <View style={styles.detailRow}>
              <Ionicons name="bookmark-outline" size={14} color={Colors.textSecondary} />
              <Text style={styles.detailText}>Ref: {accom.booking_reference}</Text>
            </View>
          )}

          {/* Instructions */}
          {accom.instructions && (
            <View style={styles.instructionsBox}>
              <Text style={styles.sectionLabel}>Instructions</Text>
              <Text style={styles.instructionsText}>{accom.instructions}</Text>
            </View>
          )}

          {/* Housemates */}
          {accom.housemates.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>
                <Ionicons name="people-outline" size={14} /> Staying with you
              </Text>
              {accom.housemates.map((hm, i) => (
                <View key={i} style={styles.housemateRow}>
                  <Ionicons name="person-outline" size={14} color={Colors.textSecondary} />
                  <Text style={styles.detailText}>
                    {hm.name}{hm.room_info ? ` (${hm.room_info})` : ''}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Documents */}
          {accom.documents.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Documents</Text>
              {accom.documents.map((doc) => (
                <TouchableOpacity key={doc.id} style={styles.docRow} onPress={() => openDoc(doc.url)}>
                  <Ionicons name="document-outline" size={16} color={Colors.primary} />
                  <Text style={[styles.detailText, { color: Colors.primary }]}>{doc.title}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {accom.notes && (
            <View style={styles.detailRow}>
              <Ionicons name="chatbubble-outline" size={14} color={Colors.textSecondary} />
              <Text style={styles.detailText}>{accom.notes}</Text>
            </View>
          )}
        </View>
      )}
    </Card>
  )
}

export default function TravelScreen() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['my-travel'],
    queryFn: () => api.travel.my().then((r) => r.data),
  })

  const flights = data?.flights || []
  const accommodations = data?.accommodations || []
  const noEmployee = data?.no_employee

  const sections = []
  if (flights.length > 0) {
    sections.push({ title: 'Upcoming Flights', data: flights.map((f) => ({ type: 'flight' as const, item: f })) })
  }
  if (accommodations.length > 0) {
    sections.push({ title: 'Accommodation', data: accommodations.map((a) => ({ type: 'accom' as const, item: a })) })
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Travel" subtitle="Your flights & accommodation" />
      {noEmployee ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Not Linked"
          message="Your account is not linked to an employee record. Contact admin."
        />
      ) : sections.length === 0 && !isLoading ? (
        <EmptyState
          icon="airplane-outline"
          title="No Upcoming Travel"
          message="When flights or accommodation are booked for you, they'll appear here."
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item, index) => `${item.type}-${item.type === 'flight' ? (item.item as Flight).id : (item.item as Accommodation).id}`}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Ionicons
                name={section.title === 'Upcoming Flights' ? 'airplane' : 'home'}
                size={16}
                color={Colors.primary}
              />
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{section.data.length}</Text>
              </View>
            </View>
          )}
          renderItem={({ item }) =>
            item.type === 'flight'
              ? <FlightCard flight={item.item as Flight} />
              : <AccommodationCard accom={item.item as Accommodation} />
          }
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.primary} />}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.dark },
  listContent: { padding: Spacing.md, paddingBottom: 100 },
  card: { marginBottom: Spacing.sm },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flex: 1 },
  dirBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  dirText: { fontSize: 12, fontWeight: '600' },
  dateText: { fontSize: 13, fontWeight: '600', color: Colors.text },
  routeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: Spacing.sm, marginBottom: Spacing.xs,
  },
  airport: { alignItems: 'flex-start', minWidth: 60 },
  airportCode: { fontSize: 18, fontWeight: '700', color: Colors.text },
  timeText: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  arrowContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  arrowLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,183,197,0.3)' },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  detailText: { fontSize: 13, color: Colors.textSecondary },
  propertyName: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 2 },
  dateRange: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  dateRangeText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  roomBadge: {
    backgroundColor: 'rgba(255,183,197,0.15)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4,
  },
  roomText: { fontSize: 11, color: Colors.primary, fontWeight: '600' },
  expandedContent: { marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  timesRow: { flexDirection: 'row', gap: 16, marginBottom: 6 },
  timeItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  instructionsBox: {
    backgroundColor: 'rgba(255,183,197,0.08)', borderRadius: BorderRadius.sm,
    padding: Spacing.sm, marginTop: Spacing.sm,
  },
  instructionsText: { fontSize: 13, color: Colors.text, lineHeight: 20 },
  section: { marginTop: Spacing.sm },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  housemateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, paddingVertical: 4 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: Spacing.sm, marginTop: Spacing.xs,
  },
  sectionHeaderText: { fontSize: 15, fontWeight: '700', color: Colors.text },
  countBadge: {
    backgroundColor: 'rgba(255,183,197,0.2)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },
  countText: { fontSize: 11, fontWeight: '700', color: Colors.primary },
})
