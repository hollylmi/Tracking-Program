// Australian (en-AU) date formatting helpers.
// Handles both date-only strings (YYYY-MM-DD) and full ISO timestamps safely —
// appending 'T00:00:00' to a value that already has a time component produces
// "Invalid Date", which was a bug in several earlier call sites.

const AU_LOCALE = 'en-AU'

function toDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input
  const s = String(input).trim()
  if (!s) return null
  // Handle DD/MM/YYYY — some backend endpoints pre-format dates in AU style
  const auMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (auMatch) {
    const [, dd, mm, yyyy, hh, min, sec] = auMatch
    const d = new Date(
      Number(yyyy), Number(mm) - 1, Number(dd),
      Number(hh || 0), Number(min || 0), Number(sec || 0),
    )
    return isNaN(d.getTime()) ? null : d
  }
  // If the string has no time component, treat as local midnight to avoid UTC shift
  const iso = /T\d/.test(s) ? s : `${s}T00:00:00`
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

export function formatDate(
  input: string | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' },
): string {
  const d = toDate(input)
  if (!d) return '—'
  return d.toLocaleDateString(AU_LOCALE, opts)
}

export function formatDateLong(input: string | Date | null | undefined): string {
  return formatDate(input, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateShort(input: string | Date | null | undefined): string {
  return formatDate(input, { day: 'numeric', month: 'short' })
}

export function formatDateWithWeekday(input: string | Date | null | undefined): string {
  return formatDate(input, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(input: string | Date | null | undefined): string {
  const d = toDate(input)
  if (!d) return '—'
  return d.toLocaleString(AU_LOCALE, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function formatTime(input: string | Date | null | undefined): string {
  const d = toDate(input)
  if (!d) return '—'
  return d.toLocaleTimeString(AU_LOCALE, { hour: '2-digit', minute: '2-digit' })
}

// Format a JS Date as YYYY-MM-DD (for API payloads — always local date, no timezone conversion)
export function toISODateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
