from collections import defaultdict
from datetime import date, timedelta

from models import (db, ProjectAssignment, EmployeeLeave, EmployeeSwing,
                    ScheduleDayOverride, Project, PublicHoliday, CFMEUDate,
                    ProjectWorkedSunday, FlightBooking, AccommodationBooking,
                    AccommodationProperty, DailyEntry, entry_employees, Employee)


def build_day_summary(hm, date_from, date_to):
    """Return a list of dicts for each day in range, plus summary counts.
    Public holidays and CFMEU dates for the machine's project are treated
    as non-working days (no hire charge)."""
    sd_map = {sd.stand_down_date: sd.reason for sd in hm.stand_downs}
    count_saturdays = hm.count_saturdays if hm.count_saturdays is not None else True

    # Build set of public holidays + CFMEU dates for the machine's project
    project = hm.project
    non_charge_dates = set()
    non_charge_reasons = {}
    if project:
        for h in PublicHoliday.query.filter(
                PublicHoliday.date >= date_from, PublicHoliday.date <= date_to).all():
            if 'ALL' in h.states_list() or (project.state and project.state in h.states_list()):
                non_charge_dates.add(h.date)
                non_charge_reasons[h.date] = f'PH: {h.name}'
        if project.is_cfmeu:
            for c in CFMEUDate.query.filter(
                    CFMEUDate.date >= date_from, CFMEUDate.date <= date_to).all():
                if 'ALL' in c.states_list() or (project.state and project.state in c.states_list()):
                    non_charge_dates.add(c.date)
                    non_charge_reasons[c.date] = f'CFMEU: {c.name}'

    days = []
    current = date_from
    while current <= date_to:
        weekday = current.weekday()
        is_sunday = weekday == 6
        is_saturday = weekday == 5

        if is_sunday or (is_saturday and not count_saturdays):
            status = 'non_working'
            reason = ''
        elif hm.delivery_date and current < hm.delivery_date:
            status = 'not_delivered'
            reason = ''
        elif hm.return_date and current > hm.return_date:
            status = 'returned'
            reason = ''
        elif current in non_charge_dates:
            status = 'non_working'
            reason = non_charge_reasons.get(current, 'Public Holiday / RDO')
        elif current in sd_map:
            status = 'stood_down'
            reason = sd_map[current]
        else:
            status = 'on_site'
            reason = ''

        days.append({
            'date': current,
            'day_name': current.strftime('%A'),
            'status': status,
            'reason': reason or sd_map.get(current, ''),
        })
        current += timedelta(days=1)

    on_site    = sum(1 for d in days if d['status'] == 'on_site')
    stood_down = sum(1 for d in days if d['status'] == 'stood_down')
    non_working = sum(1 for d in days if d['status'] == 'non_working')
    working_days = on_site + stood_down
    days_pw = 6 if count_saturdays else 5
    cost_per_day_derived = hm.cost_per_week / days_pw if hm.cost_per_week else None
    summary = {
        'on_site': on_site,
        'stood_down': stood_down,
        'non_working': non_working,
        'working_days': working_days,
        'total_days': len(days),
        'cost_day': round(on_site * cost_per_day_derived, 2) if cost_per_day_derived else None,
        'cost_per_day_derived': round(cost_per_day_derived, 2) if cost_per_day_derived else None,
        'cost_week': hm.cost_per_week,
        'count_saturdays': count_saturdays,
    }
    return days, summary


# Home base values that map to office scheduling (weekday default = office instead of available)
_OFFICE_BASES = {
    'office_sydney': 'Office (SYD)',
    'office_melbourne': 'Office (MEL)',
}


def build_schedule_grid(employees, date_list):
    """
    Build a status grid for the given employees over the given dates.
    Returns: grid[employee_id][date_iso_str] = {status, label, project_name}
    Status priority: leave > rdo > assigned > available
    """
    if not employees or not date_list:
        return {}

    emp_ids = [e.id for e in employees]
    min_date = min(date_list)
    max_date = max(date_list)

    assignments = ProjectAssignment.query.filter(
        ProjectAssignment.employee_id.in_(emp_ids),
        ProjectAssignment.date_from <= max_date,
        db.or_(ProjectAssignment.date_to.is_(None), ProjectAssignment.date_to >= min_date)
    ).all()

    leaves = EmployeeLeave.query.filter(
        EmployeeLeave.employee_id.in_(emp_ids),
        EmployeeLeave.date_from <= max_date,
        EmployeeLeave.date_to >= min_date
    ).all()

    swings = EmployeeSwing.query.filter(
        EmployeeSwing.employee_id.in_(emp_ids),
        EmployeeSwing.start_date <= max_date
    ).order_by(EmployeeSwing.employee_id, EmployeeSwing.start_date).all()

    assign_by_emp = defaultdict(list)
    for a in assignments:
        assign_by_emp[a.employee_id].append(a)

    leave_by_emp = defaultdict(list)
    for lv in leaves:
        leave_by_emp[lv.employee_id].append(lv)

    swing_by_emp = defaultdict(list)
    for s in swings:
        swing_by_emp[s.employee_id].append(s)

    overrides = ScheduleDayOverride.query.filter(
        ScheduleDayOverride.employee_id.in_(emp_ids),
        ScheduleDayOverride.date >= min_date,
        ScheduleDayOverride.date <= max_date
    ).all()
    override_by_emp = defaultdict(dict)
    for o in overrides:
        override_by_emp[o.employee_id][o.date] = o

    proj_ids = {a.project_id for a in assignments}
    project_info = {}
    if proj_ids:
        for p in Project.query.filter(Project.id.in_(proj_ids)).all():
            project_info[p.id] = p

    holidays_by_state = defaultdict(set)
    for h in PublicHoliday.query.filter(
            PublicHoliday.date >= min_date, PublicHoliday.date <= max_date).all():
        for s in h.states_list():
            holidays_by_state[s].add(h.date)
    cfmeu_by_state = defaultdict(set)
    for c in CFMEUDate.query.filter(
            CFMEUDate.date >= min_date, CFMEUDate.date <= max_date).all():
        for s in c.states_list():
            cfmeu_by_state[s].add(c.date)

    # Worked Sundays by project
    worked_sundays_by_project = defaultdict(set)
    for ws in ProjectWorkedSunday.query.filter(
            ProjectWorkedSunday.date >= min_date,
            ProjectWorkedSunday.date <= max_date).all():
        worked_sundays_by_project[ws.project_id].add(ws.date)

    # Flight bookings by (employee_id, date)
    flight_dates = defaultdict(set)
    for fb in FlightBooking.query.filter(
            FlightBooking.employee_id.in_(emp_ids),
            FlightBooking.date >= min_date,
            FlightBooking.date <= max_date).all():
        flight_dates[fb.employee_id].add(fb.date)

    # Accommodation bookings by employee — list of (date_from, date_to, property_name)
    accom_by_emp = defaultdict(list)
    for ab in AccommodationBooking.query.filter(
            AccommodationBooking.employee_id.in_(emp_ids),
            AccommodationBooking.date_from <= max_date,
            AccommodationBooking.date_to >= min_date).all():
        accom_by_emp[ab.employee_id].append(ab)

    # Actual work: which employees appear in daily entries for the date range
    # Returns set of (employee_id, entry_date, project_id)
    actual_work = defaultdict(dict)  # actual_work[emp_id][date] = project_name
    work_rows = (db.session.query(
        entry_employees.c.employee_id,
        DailyEntry.entry_date,
        Project.name
    ).join(DailyEntry, DailyEntry.id == entry_employees.c.entry_id)
     .join(Project, Project.id == DailyEntry.project_id)
     .filter(
        entry_employees.c.employee_id.in_(emp_ids),
        DailyEntry.entry_date >= min_date,
        DailyEntry.entry_date <= max_date,
    ).all())
    for emp_id, edate, pname in work_rows:
        actual_work[emp_id][edate] = pname

    grid = {}
    for emp in employees:
        grid[emp.id] = {}
        emp_swings = swing_by_emp.get(emp.id, [])
        emp_leaves = leave_by_emp.get(emp.id, [])
        emp_assigns = assign_by_emp.get(emp.id, [])

        for d in date_list:
            date_str = d.isoformat()

            # Priority 0: Terminated — employee is gone after termination_date
            if emp.termination_date and d > emp.termination_date:
                grid[emp.id][date_str] = {
                    'status': 'terminated',
                    'label': '',
                    'project_name': ''
                }
                continue

            # Priority 1: Single-day override (explicit manual entry)
            override = override_by_emp.get(emp.id, {}).get(d)
            if override:
                _OV_LABELS = {
                    'available': 'Available', 'annual': 'Annual Leave', 'sick': 'Sick',
                    'personal': 'Personal', 'r_and_r': 'R&R', 'travel': 'Travel',
                    'rdo': 'RDO', 'other': 'Leave',
                    'office_sydney': 'Office (SYD)', 'office_melbourne': 'Office (MEL)',
                }
                is_half = bool(override.is_half_day) if override.is_half_day is not None else False
                if override.status == 'project' and override.project:
                    grid[emp.id][date_str] = {
                        'status': 'assigned',
                        'label': override.project.name[:16],
                        'project_name': override.project.name,
                        'override_id': override.id,
                        'override_status': override.status,
                        'override_project_id': override.project_id or '',
                    }
                elif override.status == 'travel' and is_half and override.project:
                    # Half-day travel + half-day on site
                    grid[emp.id][date_str] = {
                        'status': 'travel_half',
                        'label': override.project.name[:8],
                        'project_name': override.project.name,
                        'override_id': override.id,
                        'override_status': override.status,
                        'override_project_id': override.project_id or '',
                        'is_half_day': True,
                        'project_id': override.project_id,
                    }
                elif override.status in ('office_sydney', 'office_melbourne'):
                    grid[emp.id][date_str] = {
                        'status': 'office',
                        'label': _OV_LABELS.get(override.status, 'Office'),
                        'project_name': '',
                        'override_id': override.id,
                        'override_status': override.status,
                        'override_project_id': '',
                    }
                    continue
                else:
                    css = override.status if override.status in (
                        'r_and_r', 'travel', 'rdo', 'available') else 'leave'
                    grid[emp.id][date_str] = {
                        'status': css,
                        'label': _OV_LABELS.get(override.status, override.status.replace('_', ' ').title()),
                        'project_name': '',
                        'override_id': override.id,
                        'override_status': override.status,
                        'override_project_id': '',
                    }
                continue

            # Priority 2: Leave (r_and_r and travel get distinct visual status)
            _LEAVE_LABELS = {
                'annual': 'Annual Leave', 'sick': 'Sick', 'personal': 'Personal',
                'r_and_r': 'R&R', 'travel': 'Travel', 'other': 'Leave'
            }
            leave = next((lv for lv in emp_leaves if lv.date_from <= d <= lv.date_to), None)
            if leave:
                lt = leave.leave_type
                grid[emp.id][date_str] = {
                    'status': lt if lt in ('r_and_r', 'travel') else 'leave',
                    'label': _LEAVE_LABELS.get(lt, lt.title()),
                    'project_name': ''
                }
                continue

            # Priority 3: RDO — find the most recent swing whose start_date <= d
            applicable_swing = None
            for s in emp_swings:
                if s.start_date <= d:
                    applicable_swing = s
                # swings are ordered ASC so keep going to find latest
            if applicable_swing and applicable_swing.is_rdo(d):
                grid[emp.id][date_str] = {
                    'status': 'r_and_r',
                    'label': 'R&R',
                    'project_name': ''
                }
                continue

            # Priority 4: Project-based non-work day (public holiday or CFMEU date)
            active_assign = next(
                (a for a in emp_assigns
                 if a.date_from <= d and (a.date_to is None or a.date_to >= d)),
                None
            )
            if active_assign:
                proj = project_info.get(active_assign.project_id)
                if proj:
                    is_pub_holiday = bool(
                        d in holidays_by_state.get('ALL', set()) or
                        (proj.state and d in holidays_by_state.get(proj.state, set())))
                    is_cfmeu_day = bool(proj.is_cfmeu and (
                        d in cfmeu_by_state.get('ALL', set()) or
                        (proj.state and d in cfmeu_by_state.get(proj.state, set()))))
                    if is_pub_holiday or is_cfmeu_day:
                        grid[emp.id][date_str] = {
                            'status': 'rdo',
                            'label': 'PH' if is_pub_holiday else 'CFMEU',
                            'project_name': '',
                            'nwd_reason': 'Public Holiday' if is_pub_holiday else 'CFMEU RDO',
                        }
                        continue

            # Priority 5: Sunday check — off unless it's a worked Sunday for that project
            if d.weekday() == 6:
                is_worked_sunday = (
                    active_assign and
                    d in worked_sundays_by_project.get(active_assign.project_id, set())
                )
                if not is_worked_sunday:
                    grid[emp.id][date_str] = {
                        'status': 'sunday',
                        'label': 'Sun',
                        'project_name': ''
                    }
                    continue

            # Priority 6: Project assignment
            if active_assign:
                grid[emp.id][date_str] = {
                    'status': 'assigned',
                    'label': active_assign.project.name[:16],
                    'project_name': active_assign.project.name,
                    'project_id': active_assign.project_id,
                }
                continue

            # Default: office (if home_base is an office location) or available
            if d.weekday() == 6:
                grid[emp.id][date_str] = {
                    'status': 'sunday',
                    'label': 'Sun',
                    'project_name': ''
                }
            elif d.weekday() == 5:
                # Saturday — default off unless assigned
                grid[emp.id][date_str] = {
                    'status': 'available',
                    'label': 'Available',
                    'project_name': ''
                }
            elif emp.home_base in _OFFICE_BASES:
                grid[emp.id][date_str] = {
                    'status': 'office',
                    'label': _OFFICE_BASES[emp.home_base],
                    'project_name': '',
                    'override_status': f'office_{emp.home_base}',
                }
            else:
                grid[emp.id][date_str] = {
                    'status': 'available',
                    'label': 'Available',
                    'project_name': ''
                }

    # Post-process: enrich cells with flight and accommodation indicators
    for emp in employees:
        emp_flights = flight_dates.get(emp.id, set())
        emp_accoms = accom_by_emp.get(emp.id, [])
        for d in date_list:
            date_str = d.isoformat()
            cell = grid.get(emp.id, {}).get(date_str)
            if not cell:
                continue
            cell['has_flight'] = d in emp_flights
            accom = next((a for a in emp_accoms if a.date_from <= d <= a.date_to), None)
            cell['has_accommodation'] = accom is not None
            cell['accommodation_name'] = accom.property_name if accom else ''
            # Actual work indicator — did this employee appear in a daily entry for this date?
            emp_actual = actual_work.get(emp.id, {})
            cell['worked'] = d in emp_actual
            cell['worked_project'] = emp_actual.get(d, '')

    return grid


# ---------------------------------------------------------------------------
# Home-base → city name mapping
# ---------------------------------------------------------------------------
def _get_base_city_map():
    """Build home_base value → display city name mapping dynamically from settings."""
    from utils.settings import get_locations
    mapping = {
        'office_sydney': 'Sydney',
        'office_melbourne': 'Melbourne',
    }
    for loc in get_locations():
        mapping[loc.lower()] = loc
    return mapping


def _location_for_cell(cell, project_cities, base_city_map):
    """Determine the city/location an employee is at based on a grid cell.
    Returns (city_name, location_type) or (None, None).
    location_type is 'project', 'office', 'home', or None.
    """
    status = cell.get('status', '')
    if status == 'assigned' or status == 'travel_half':
        pid = cell.get('project_id')
        city = project_cities.get(pid) if pid else None
        return (city, 'project') if city else (None, 'project')
    if status == 'office':
        ov = cell.get('override_status', '')
        if ov in base_city_map:
            return base_city_map[ov], 'office'
        return None, 'office'
    if status in ('r_and_r', 'leave', 'annual', 'sick', 'personal', 'available', 'rdo'):
        return None, 'home'  # at home base
    return None, None


def detect_travel_needs(employees, date_list, grid=None, look_ahead_days=90):
    """Scan the schedule for location transitions that indicate travel.

    Returns a list of dicts:
      {employee, date, from_location, to_location, from_type, to_type,
       has_flight, has_accommodation, needs_accommodation, transport_suggestion}

    The logic:
      - Walk each employee's schedule day by day
      - When their location changes from one day to the next, that's a travel event
      - The travel happens on the day they arrive at the new location
      - Compare from/to cities to suggest transport mode
    """
    if not employees or not date_list:
        return []

    today = date.today()
    cutoff = today + timedelta(days=look_ahead_days)
    base_city_map = _get_base_city_map()

    # Build grid if not provided
    if grid is None:
        grid = build_schedule_grid(employees, date_list)

    # Build project city and airport lookup
    project_ids = set()
    for emp in employees:
        for d in date_list:
            cell = grid.get(emp.id, {}).get(d.isoformat(), {})
            pid = cell.get('project_id')
            if pid:
                project_ids.add(pid)
    project_cities = {}
    project_airports = {}
    if project_ids:
        for p in Project.query.filter(Project.id.in_(project_ids)).all():
            if p.city:
                project_cities[p.id] = p.city
            if p.nearest_airport:
                project_airports[p.id] = p.nearest_airport

    # Flight lookup
    emp_ids = [e.id for e in employees]
    min_date = min(date_list)
    max_date = max(date_list)
    flight_set = set()
    for fb in FlightBooking.query.filter(
            FlightBooking.employee_id.in_(emp_ids),
            FlightBooking.date >= min_date,
            FlightBooking.date <= max_date).all():
        flight_set.add((fb.employee_id, fb.date))

    # Accommodation lookup
    accom_dates = defaultdict(set)
    for ab in AccommodationBooking.query.filter(
            AccommodationBooking.employee_id.in_(emp_ids),
            AccommodationBooking.date_from <= max_date,
            AccommodationBooking.date_to >= min_date).all():
        d = ab.date_from
        while d <= ab.date_to:
            accom_dates[ab.employee_id].add(d)
            d += timedelta(days=1)

    # Driveable city pairs from settings
    from utils.settings import get_drive_pairs
    _DRIVE_PAIRS = {frozenset(pair) for pair in get_drive_pairs()}

    def _suggest_transport(from_city, to_city, emp):
        """Suggest transport mode: 'drives', 'local', 'drive', 'fly', or 'unknown'."""
        if emp.home_airport and emp.home_airport.upper() == 'DRIVES':
            if not from_city or not to_city:
                return 'drives'
            if from_city.lower() == to_city.lower():
                return 'local'
            return 'drives'
        if not from_city or not to_city:
            return 'unknown'
        if from_city.lower() == to_city.lower():
            return 'local'
        pair = frozenset({from_city, to_city})
        if pair in _DRIVE_PAIRS:
            return 'drive'
        return 'fly'

    travel_needs = []
    for emp in employees:
        emp_home = base_city_map.get(emp.home_base)
        prev_location = emp_home  # assume starting at home
        prev_type = 'home'
        prev_project_id = None

        for i, d in enumerate(date_list):
            if d < today or d > cutoff:
                continue

            date_str = d.isoformat()
            cell = grid.get(emp.id, {}).get(date_str, {})
            status = cell.get('status', '')

            # Skip non-working days
            if status in ('sunday', 'terminated', ''):
                continue

            curr_location, curr_type = _location_for_cell(cell, project_cities, base_city_map)

            # If at home (R&R, leave, available), location = home base
            if curr_type == 'home':
                curr_location = emp_home

            curr_project_id = cell.get('project_id')

            # Detect transition
            if (curr_location and prev_location and
                    curr_location != prev_location and
                    curr_type != 'home'):  # don't flag going home as needing travel *to* home
                has_flight = (emp.id, d) in flight_set
                has_accom = d in accom_dates.get(emp.id, set())
                needs_accom = emp.requires_accommodation if emp.requires_accommodation is not None else True
                suggestion = _suggest_transport(prev_location, curr_location, emp)

                # Determine airports for the route
                from_airport = emp.home_airport if prev_type == 'home' and emp.home_airport != 'DRIVES' else (
                    project_airports.get(prev_project_id) if prev_project_id else None)
                to_airport = project_airports.get(curr_project_id) if curr_project_id else None

                travel_needs.append({
                    'employee_id': emp.id,
                    'employee_name': emp.name,
                    'employee_role': emp.role,
                    'home_airport': emp.home_airport,
                    'date': d,
                    'from_location': prev_location,
                    'to_location': curr_location,
                    'from_airport': from_airport,
                    'to_airport': to_airport,
                    'from_type': prev_type,
                    'to_type': curr_type,
                    'has_flight': has_flight,
                    'has_accommodation': has_accom,
                    'needs_accommodation': needs_accom,
                    'transport_suggestion': suggestion,
                    'project_name': cell.get('project_name', ''),
                })

            # Also detect going home — flag as return travel
            if (curr_type == 'home' and prev_type == 'project' and
                    prev_location and emp_home and prev_location != emp_home):
                has_flight = (emp.id, d) in flight_set
                suggestion = _suggest_transport(prev_location, emp_home, emp)
                from_airport = project_airports.get(prev_project_id) if prev_project_id else None
                to_airport = emp.home_airport if emp.home_airport != 'DRIVES' else None

                travel_needs.append({
                    'employee_id': emp.id,
                    'employee_name': emp.name,
                    'employee_role': emp.role,
                    'home_airport': emp.home_airport,
                    'date': d,
                    'from_location': prev_location,
                    'to_location': emp_home,
                    'from_airport': from_airport,
                    'to_airport': to_airport,
                    'from_type': prev_type,
                    'to_type': 'home',
                    'has_flight': has_flight,
                    'has_accommodation': False,
                    'needs_accommodation': False,
                    'transport_suggestion': suggestion,
                    'project_name': '',
                })

            if curr_location:
                prev_location = curr_location
                prev_type = curr_type
                prev_project_id = curr_project_id

    # Sort by date then employee name
    travel_needs.sort(key=lambda t: (t['date'], t['employee_name']))
    return travel_needs


def _swing_status(transport_to, transport_from, flights_to, flights_from,
                   needs_accom, has_accom, accom_gap_days, is_ongoing, issues):
    """Determine overall swing status: 'sorted', 'upcoming', or 'urgent'."""
    # Check if everything that needs booking is booked
    needs_flight_to = transport_to == 'fly'
    needs_flight_from = not is_ongoing and transport_from == 'fly'

    flight_to_ok = not needs_flight_to or len(flights_to) > 0
    flight_from_ok = not needs_flight_from or len(flights_from) > 0
    accom_ok = not needs_accom or (has_accom and accom_gap_days == 0)

    all_booked = flight_to_ok and flight_from_ok and accom_ok

    if all_booked:
        return 'sorted'
    if issues:
        return 'urgent'
    return 'upcoming'


def build_swing_planner(employees, look_ahead_days=90, **_ignored):
    """Build a per-employee swing planner from ProjectAssignment records.

    Each assignment = one row (one stint on site).  We look at:
    - Travel TO site around the assignment start
    - Accommodation for the full assignment duration
    - Travel FROM site around the assignment end
    - Flags: missing flights, missing accommodation, expiring properties

    Returns dict with 'swings' list and 'expiring_properties' list.
    """
    if not employees:
        return {'swings': [], 'expiring_properties': []}

    today = date.today()
    cutoff = today + timedelta(days=look_ahead_days)
    base_city_map = _get_base_city_map()

    emp_ids = [e.id for e in employees]

    # Get all assignments that overlap with the look-ahead window
    assignments = ProjectAssignment.query.filter(
        ProjectAssignment.employee_id.in_(emp_ids),
        ProjectAssignment.date_from <= cutoff,
        db.or_(ProjectAssignment.date_to.is_(None), ProjectAssignment.date_to >= today),
    ).order_by(ProjectAssignment.date_from).all()

    # Build project lookup
    project_ids = {a.project_id for a in assignments}
    project_map = {}
    if project_ids:
        for p in Project.query.filter(Project.id.in_(project_ids)).all():
            project_map[p.id] = p

    # Flight bookings indexed by (emp_id, date) — wide window around assignments
    earliest = min((a.date_from for a in assignments), default=today) - timedelta(days=2)
    latest = max((a.date_to or cutoff for a in assignments), default=cutoff) + timedelta(days=2)
    flight_map = defaultdict(list)
    for fb in FlightBooking.query.filter(
            FlightBooking.employee_id.in_(emp_ids),
            FlightBooking.date >= earliest,
            FlightBooking.date <= latest).all():
        flight_map[(fb.employee_id, fb.date)].append(fb)

    # Accommodation bookings by employee
    accom_by_emp = defaultdict(list)
    for ab in AccommodationBooking.query.filter(
            AccommodationBooking.employee_id.in_(emp_ids),
            AccommodationBooking.date_from <= latest,
            AccommodationBooking.date_to >= earliest).all():
        accom_by_emp[ab.employee_id].append(ab)

    # Expiring properties — 14 days for house/apartment, 2 days for hotel/motel
    expiring_properties = []
    for prop in AccommodationProperty.query.filter_by(active=True).all():
        if not prop.date_to or prop.date_to < today:
            continue
        days_left = (prop.date_to - today).days
        ptype = (prop.property_type or '').lower()
        threshold = 2 if ptype in ('hotel', 'motel') else 14
        if days_left <= threshold:
            prop._days_left = days_left  # attach for template use
            expiring_properties.append(prop)
    expiring_properties.sort(key=lambda p: p._days_left)

    # Driveable city pairs from settings
    from utils.settings import get_drive_pairs
    _DRIVE_PAIRS = {frozenset(pair) for pair in get_drive_pairs()}

    def _transport(from_city, to_city, emp):
        if emp.home_airport and emp.home_airport.upper() == 'DRIVES':
            if not from_city or not to_city:
                return 'drives'
            return 'local' if from_city.lower() == to_city.lower() else 'drives'
        if not from_city or not to_city:
            return 'unknown'
        if from_city.lower() == to_city.lower():
            return 'local'
        if frozenset({from_city, to_city}) in _DRIVE_PAIRS:
            return 'drive'
        return 'fly'

    def _fmt_flight(f):
        parts = []
        if f.airline:
            parts.append(f.airline)
        if f.flight_number:
            parts.append(f.flight_number)
        if f.departure_airport and f.arrival_airport:
            parts.append(f'{f.departure_airport}\u2192{f.arrival_airport}')
        if f.departure_time:
            parts.append(f.departure_time)
        return ' '.join(parts) if parts else 'Flight booked'

    # Build employee lookup and find previous assignments for project-to-project travel
    emp_map = {e.id: e for e in employees}

    # Group assignments by employee and sort by date to detect project-to-project transfers
    assigns_by_emp = defaultdict(list)
    for a in assignments:
        assigns_by_emp[a.employee_id].append(a)
    for emp_id in assigns_by_emp:
        assigns_by_emp[emp_id].sort(key=lambda a: a.date_from)

    # Map assignment_id -> previous assignment (for project-to-project travel)
    prev_assignment_map = {}
    for emp_id, emp_assigns in assigns_by_emp.items():
        for i in range(1, len(emp_assigns)):
            curr = emp_assigns[i]
            prev = emp_assigns[i - 1]
            if prev.date_to:
                gap_days = (curr.date_from - prev.date_to).days
                if gap_days <= 3:  # 0-3 day gap = travelling between projects
                    prev_assignment_map[curr.id] = prev

    # Compute projected finish dates from Gantt for each project with ongoing assignments
    projected_finish_dates = {}
    ongoing_project_ids = {a.project_id for a in assignments if a.date_to is None}
    if ongoing_project_ids:
        from utils.gantt import compute_gantt_data
        for pid in ongoing_project_ids:
            proj = project_map.get(pid)
            if proj and proj.start_date:
                try:
                    gantt = compute_gantt_data(proj)
                    if gantt and gantt.get('est_finish_date'):
                        projected_finish_dates[pid] = gantt['est_finish_date']
                except Exception:
                    pass  # Gantt may fail if no planned data — fall back to planned_end_date

    swings = []
    for assign in assignments:
        emp = emp_map.get(assign.employee_id)
        if not emp:
            continue
        proj = project_map.get(assign.project_id)
        if not proj:
            continue

        emp_home = base_city_map.get(emp.home_base)
        proj_city = proj.city
        proj_airport = proj.nearest_airport
        start = assign.date_from
        is_ongoing = assign.date_to is None
        # For ongoing assignments, use Gantt projected finish date, then planned_end_date, then cutoff
        if is_ongoing:
            proj_finish = projected_finish_dates.get(proj.id)
            end = proj_finish or proj.planned_end_date or cutoff
        else:
            end = assign.date_to

        # Total calendar days on site (includes weekends — they stay on site)
        num_days = (end - start).days + 1

        # Check for project-to-project transfer
        prev_assign = prev_assignment_map.get(assign.id)
        if prev_assign:
            prev_proj = project_map.get(prev_assign.project_id)
            from_location = prev_proj.city if prev_proj else emp_home
            from_airport = prev_proj.nearest_airport if prev_proj else (
                emp.home_airport if emp.home_airport != 'DRIVES' else None)
            from_project_name = prev_proj.name if prev_proj else None
        else:
            from_location = emp_home
            from_airport = emp.home_airport if emp.home_airport and emp.home_airport != 'DRIVES' else None
            from_project_name = None

        # Travel TO — look for flights on start date or day before
        travel_to_date = start
        flights_to = flight_map.get((emp.id, start), [])
        if not flights_to:
            day_before = start - timedelta(days=1)
            flights_to = flight_map.get((emp.id, day_before), [])
            if flights_to:
                travel_to_date = day_before
        # Transport mode — use override if set, otherwise auto-detect
        transport_to = assign.transport_to_mode or _transport(from_location, proj_city, emp)
        from utils.settings import get_drive_time
        drive_time_to = get_drive_time(from_location, proj_city) if transport_to in ('drive', 'drives') else None

        # Travel FROM — look for flights on end date or day after
        travel_from_date = end
        flights_from = []
        if not is_ongoing:
            flights_from = flight_map.get((emp.id, end), [])
            if not flights_from:
                day_after = end + timedelta(days=1)
                flights_from = flight_map.get((emp.id, day_after), [])
                if flights_from:
                    travel_from_date = day_after
        transport_from = assign.transport_from_mode or _transport(proj_city, emp_home, emp)
        drive_time_from = get_drive_time(proj_city, emp_home) if transport_from in ('drive', 'drives') else None

        # Accommodation
        emp_accoms = accom_by_emp.get(emp.id, [])
        accom_bookings = [a for a in emp_accoms if a.date_from <= end and a.date_to >= start]
        # Accommodation need: assignment override > employee default > True
        if assign.needs_accommodation is not None:
            needs_accom = assign.needs_accommodation
        elif emp.requires_accommodation is not None:
            needs_accom = emp.requires_accommodation
        else:
            needs_accom = True
        has_accom = len(accom_bookings) > 0

        # Accommodation gap check
        accom_gap_days = 0
        if needs_accom:
            covered = set()
            for a in accom_bookings:
                d = max(a.date_from, start)
                while d <= min(a.date_to, end):
                    covered.add(d)
                    d += timedelta(days=1)
            total_days = (end - start).days + 1
            accom_gap_days = total_days - len(covered)

        # Expiry check
        accom_expiring = any(
            a.property and a.property.date_to and a.property.date_to < end
            for a in accom_bookings
        )

        # Housemates
        housemates = set()
        for a in accom_bookings:
            if a.property_id:
                for hm in AccommodationBooking.query.filter(
                        AccommodationBooking.property_id == a.property_id,
                        AccommodationBooking.id != a.id,
                        AccommodationBooking.date_from <= end,
                        AccommodationBooking.date_to >= start).all():
                    if hm.employee:
                        housemates.add(hm.employee.name)

        # Issues — urgency-based thresholds
        issues = []
        days_to_start = (start - today).days
        days_to_end = (end - today).days if not is_ongoing else 999

        # Flights: flag within 5 days
        if transport_to == 'fly' and not flights_to and days_to_start <= 5:
            issues.append({'text': 'No flight booked TO site', 'days': days_to_start})
        if not is_ongoing and transport_from == 'fly' and not flights_from and days_to_end <= 5:
            issues.append({'text': 'No flight booked FROM site', 'days': days_to_end})
        # Accommodation: flag within 5 days
        if needs_accom and not has_accom and days_to_start <= 5:
            issues.append({'text': 'No accommodation booked', 'days': days_to_start})
        elif needs_accom and accom_gap_days > 0 and days_to_start <= 5:
            issues.append({'text': f'Accommodation gap: {accom_gap_days} day(s) uncovered', 'days': days_to_start})
        # Property expiry: 14 days for house/apartment, 2 days for hotel/motel
        for a in accom_bookings:
            if a.property and a.property.date_to:
                prop_days = (a.property.date_to - today).days
                ptype = (a.property.property_type or '').lower()
                threshold = 2 if ptype in ('hotel', 'motel') else 14
                if prop_days <= threshold:
                    issues.append({'text': f'{a.property.name} ({ptype}) expires in {prop_days} day{"s" if prop_days != 1 else ""}',
                                   'days': prop_days})

        # Earliest action date for sorting
        action_dates = []
        if transport_to == 'fly' and not flights_to:
            action_dates.append(days_to_start)
        if not is_ongoing and transport_from == 'fly' and not flights_from:
            action_dates.append(days_to_end)
        if needs_accom and not has_accom:
            action_dates.append(days_to_start)
        earliest_action_days = min(action_dates) if action_dates else 999

        swings.append({
            'assignment_id': assign.id,
            'employee_id': emp.id,
            'employee_name': emp.name,
            'employee_role': emp.role,
            'home_airport': emp.home_airport,
            'home_location': emp_home,
            'project_id': proj.id,
            'project_name': proj.name,
            'project_city': proj_city,
            'project_airport': proj_airport,
            'start_date': start,
            'end_date': end,
            'is_ongoing': is_ongoing,
            'num_days': num_days,
            # Travel TO
            'travel_to_date': travel_to_date,
            'transport_to': transport_to,
            'drive_time_to': drive_time_to,
            'from_location': from_location,
            'from_airport': from_airport,
            'from_project_name': from_project_name,
            'flights_to': [_fmt_flight(f) for f in flights_to],
            'flights_to_raw': flights_to,
            'has_flight_to': len(flights_to) > 0,
            # Travel FROM
            'travel_from_date': travel_from_date,
            'transport_from': transport_from,
            'drive_time_from': drive_time_from,
            'flights_from': [_fmt_flight(f) for f in flights_from],
            'flights_from_raw': flights_from,
            'has_flight_from': len(flights_from) > 0,
            # Accommodation
            'needs_accommodation': needs_accom,
            'has_accommodation': has_accom,
            'accom_bookings': accom_bookings,
            'accom_gap_days': accom_gap_days,
            'accom_expiring': accom_expiring,
            'housemates': sorted(housemates),
            # Issues & urgency
            'issues': issues,
            'has_issues': len(issues) > 0,
            'earliest_action_days': earliest_action_days,
            'days_to_start': days_to_start,
            'status': _swing_status(
                transport_to, transport_from, flights_to, flights_from,
                needs_accom, has_accom, accom_gap_days, is_ongoing, issues),
        })

    # Sort: urgent first (by earliest_action_days), then upcoming, then sorted
    _STATUS_ORDER = {'urgent': 0, 'upcoming': 1, 'sorted': 2}
    swings.sort(key=lambda s: (_STATUS_ORDER.get(s['status'], 2), s['earliest_action_days'], s['employee_name']))
    return {'swings': swings, 'expiring_properties': expiring_properties}
