from models import DailyEntry, EntryProductionLine, PlannedData, Project
from utils.helpers import _natural_key


def compute_project_progress(project_id):
    """Return planned vs actual progress data for a project."""
    project = Project.query.get(project_id)
    if not project:
        return None

    planned = PlannedData.query.filter_by(project_id=project_id).all()
    if not planned:
        return None

    by_lot = project.track_by_lot if project.track_by_lot is not None else True

    entries = (DailyEntry.query
               .filter_by(project_id=project_id)
               .filter(DailyEntry.install_sqm > 0)
               .all())

    planned_by_task = {}
    for p in planned:
        key = (p.lot or '', p.material or '') if by_lot else ('', p.material or '')
        if key not in planned_by_task:
            planned_by_task[key] = {
                'lot': p.lot if by_lot else '',
                'location': p.location,
                'material': p.material,
                'planned_sqm': 0, 'min_day': float('inf'), 'max_day': 0,
            }
        planned_by_task[key]['planned_sqm'] += p.planned_sqm or 0
        planned_by_task[key]['min_day'] = min(planned_by_task[key]['min_day'], p.day_number or 0)
        planned_by_task[key]['max_day'] = max(planned_by_task[key]['max_day'], p.day_number or 0)

    actual_by_task = {}
    total_install_hours = 0.0
    for e in entries:
        if e.production_lines:
            for pl in e.production_lines:
                key = (pl.lot_number or '', pl.material or '') if by_lot else ('', pl.material or '')
                actual_by_task[key] = actual_by_task.get(key, 0.0) + (pl.install_sqm or 0)
                total_install_hours += (pl.install_hours or 0)
        else:
            key = (e.lot_number or '', e.material or '') if by_lot else ('', e.material or '')
            actual_by_task[key] = actual_by_task.get(key, 0.0) + (e.install_sqm or 0)
            total_install_hours += (e.install_hours or 0)

    tasks = []
    total_planned = 0.0
    total_actual = 0.0
    sorted_items = sorted(planned_by_task.items(),
                          key=lambda x: (_natural_key(x[1]['lot']), _natural_key(x[1]['material'])))
    for key, data in sorted_items:
        actual = actual_by_task.get(key, 0.0)
        planned_sqm = data['planned_sqm']
        pct = round(actual / planned_sqm * 100, 1) if planned_sqm > 0 else 0
        total_planned += planned_sqm
        total_actual += actual
        tasks.append({
            'lot': data['lot'],
            'location': data['location'],
            'material': data['material'],
            'planned_sqm': round(planned_sqm, 2),
            'actual_sqm': round(actual, 2),
            'remaining': round(max(0, planned_sqm - actual), 2),
            'pct_complete': min(pct, 100),
            'min_day': data['min_day'],
            'max_day': data['max_day'],
        })

    overall_pct = round(total_actual / total_planned * 100, 1) if total_planned > 0 else 0
    install_rate = round(total_actual / total_install_hours, 2) if total_install_hours > 0 else None

    all_entries = DailyEntry.query.filter_by(project_id=project_id).order_by(DailyEntry.entry_date.desc()).first()
    current_crew = all_entries.num_people if all_entries and all_entries.num_people else None

    # Calculate "where should we be" — working days elapsed excluding delays
    from models import ProjectNonWorkDate, ProjectWorkedSunday, PublicHoliday, CFMEUDate
    from datetime import date as _date, timedelta as _td
    from collections import defaultdict

    all_entries = DailyEntry.query.filter_by(project_id=project_id).all()
    today = _date.today()
    total_planned_days = max((p.day_number or 0) for p in planned) if planned else 0

    should_be_pct = None
    total_weather_days = 0
    total_variation_days = 0
    weather_delay_impact = 0
    variation_delay_impact = 0

    if project.start_date and total_planned_days > 0:
        # Build non-work date set
        non_work = {nwd.date for nwd in ProjectNonWorkDate.query.filter_by(project_id=project_id).all()}
        for h in PublicHoliday.query.all():
            if 'ALL' in h.states_list() or (project.state and project.state in h.states_list()):
                non_work.add(h.date)
        if project.is_cfmeu:
            for c in CFMEUDate.query.all():
                if 'ALL' in c.states_list() or (project.state and project.state in c.states_list()):
                    non_work.add(c.date)
        worked_sundays = {ws.date for ws in ProjectWorkedSunday.query.filter_by(project_id=project_id).all()}

        # Count weather delay days and variation delay days
        weather_dates = set()
        variation_dates = set()
        for e in all_entries:
            if (e.delay_hours or 0) > 0 and e.delay_reason and 'weather' in (e.delay_reason or '').lower():
                weather_dates.add(e.entry_date)
            if e.variation_lines and sum(vl.hours or 0 for vl in e.variation_lines) > 0:
                variation_dates.add(e.entry_date)

        total_weather_days = len(weather_dates)
        total_variation_days = len(variation_dates)

        # Count working days from start to today (excluding Sundays, non-work, weather, variations)
        working_days_elapsed = 0
        d = project.start_date
        end = min(today, project.start_date + _td(days=total_planned_days * 2))  # safety cap
        while d <= end:
            is_sunday = d.weekday() == 6 and d not in worked_sundays
            is_nonwork = d in non_work
            is_weather = d in weather_dates
            is_variation = d in variation_dates
            if not is_sunday and not is_nonwork and not is_weather and not is_variation:
                working_days_elapsed += 1
            d += _td(days=1)

        should_be_pct = round(min(working_days_elapsed / total_planned_days * 100, 100), 1)

        # Delay impact on deadline (extra days added)
        weather_delay_impact = total_weather_days
        variation_delay_impact = total_variation_days

    return {
        'tasks': tasks,
        'total_planned': round(total_planned, 2),
        'total_actual': round(total_actual, 2),
        'total_remaining': round(max(0, total_planned - total_actual), 2),
        'overall_pct': min(overall_pct, 100),
        'should_be_pct': should_be_pct,
        'install_rate': install_rate,
        'planned_crew': project.planned_crew,
        'current_crew': current_crew,
        'total_planned_days': total_planned_days,
        'weather_delay_days': total_weather_days,
        'variation_delay_days': total_variation_days,
        'weather_delay_impact': weather_delay_impact,
        'variation_delay_impact': variation_delay_impact,
    }


def compute_material_productivity(project_id):
    """Return m²/hour productivity by material: planned rate vs actual rate.

    Planned rate = (planned_sqm / planned_days) / hours_per_day  → m²/hr
    Actual rate  = actual_sqm / actual_install_hours              → m²/hr
    """
    project = Project.query.get(project_id)
    if not project:
        return []

    hours_per_day = project.hours_per_day or 8

    planned = PlannedData.query.filter_by(project_id=project_id).all()
    if not planned:
        return []

    # Group planned by material
    mat_planned = {}
    for p in planned:
        mat = p.material or 'Unknown'
        if mat not in mat_planned:
            mat_planned[mat] = {'sqm': 0.0, 'day_numbers': set()}
        mat_planned[mat]['sqm'] += p.planned_sqm or 0
        if p.day_number:
            mat_planned[mat]['day_numbers'].add(p.day_number)

    entries = DailyEntry.query.filter_by(project_id=project_id).all()

    # Group actuals by material — use production lines for accurate per-material hours
    mat_actual = {}
    total_variation_hours = 0.0
    total_weather_hours = 0.0
    for e in entries:
        # Track delay hours
        total_variation_hours += e.total_variation_hours
        total_weather_hours += (e.delay_hours or 0)

        if e.production_lines:
            for pl in e.production_lines:
                mat = pl.material or 'Unknown'
                if mat not in mat_actual:
                    mat_actual[mat] = {'sqm': 0.0, 'hours': 0.0, 'dates': set()}
                mat_actual[mat]['sqm'] += pl.install_sqm or 0
                mat_actual[mat]['hours'] += pl.install_hours or 0
                if e.entry_date:
                    mat_actual[mat]['dates'].add(e.entry_date)
        else:
            mat = e.material or 'Unknown'
            if mat not in mat_actual:
                mat_actual[mat] = {'sqm': 0.0, 'hours': 0.0, 'dates': set()}
            mat_actual[mat]['sqm'] += e.install_sqm or 0
            mat_actual[mat]['hours'] += e.install_hours or 0
            if e.entry_date:
                mat_actual[mat]['dates'].add(e.entry_date)

    # Overall totals
    total_planned_sqm = sum(v['sqm'] for v in mat_planned.values())
    all_planned_days = len({dn for v in mat_planned.values() for dn in v['day_numbers']})
    overall_planned_rate = round(total_planned_sqm / (all_planned_days * hours_per_day), 1) if all_planned_days > 0 else None

    total_actual_sqm = sum(v['sqm'] for v in mat_actual.values())
    total_actual_hours = sum(v['hours'] for v in mat_actual.values())
    overall_actual_rate = round(total_actual_sqm / total_actual_hours, 1) if total_actual_hours > 0 else None

    overall_pct = None
    if overall_planned_rate and overall_actual_rate:
        overall_pct = round(overall_actual_rate / overall_planned_rate * 100, 0)

    overall = {
        'planned_sqm': round(total_planned_sqm, 0),
        'actual_sqm': round(total_actual_sqm, 0),
        'planned_days': all_planned_days,
        'actual_days': len({d for v in mat_actual.values() for d in v['dates']}),
        'actual_hours': round(total_actual_hours, 1),
        'planned_rate': overall_planned_rate,
        'actual_rate': overall_actual_rate,
        'pct_of_target': overall_pct,
        'hours_per_day': hours_per_day,
        'variation_hours': round(total_variation_hours, 1),
        'weather_hours': round(total_weather_hours, 1),
    }

    materials = []
    for mat in sorted(mat_planned.keys(), key=_natural_key):
        plan = mat_planned[mat]
        planned_sqm = plan['sqm']
        planned_days = len(plan['day_numbers'])
        # Planned rate: sqm per day ÷ hours per day = m²/hr
        planned_rate = round((planned_sqm / planned_days) / hours_per_day, 1) if planned_days > 0 else None

        act = mat_actual.get(mat, {'sqm': 0.0, 'hours': 0.0, 'dates': set()})
        actual_sqm = act['sqm']
        actual_hours = act['hours']
        # Actual rate: sqm ÷ hours = m²/hr
        actual_rate = round(actual_sqm / actual_hours, 1) if actual_hours > 0 else None

        pct_of_target = None
        if planned_rate and actual_rate:
            pct_of_target = round(actual_rate / planned_rate * 100, 0)

        materials.append({
            'material': mat,
            'planned_sqm': round(planned_sqm, 0),
            'actual_sqm': round(actual_sqm, 0),
            'planned_days': planned_days,
            'actual_days': len(act['dates']),
            'actual_hours': round(actual_hours, 1),
            'planned_rate': planned_rate,
            'actual_rate': actual_rate,
            'pct_of_target': pct_of_target,
        })

    return {'overall': overall, 'materials': materials}


def compute_delay_summary(project_id):
    """Return a delay summary grouped by (reason, billable) for the project dashboard."""
    entries = (DailyEntry.query
               .filter_by(project_id=project_id)
               .filter(DailyEntry.delay_hours > 0)
               .all())
    if not entries:
        return []

    categories = {}
    for e in entries:
        reason = e.delay_reason or 'Unspecified'
        is_billable = e.delay_billable if e.delay_billable is not None else True
        key = (reason, is_billable)
        if key not in categories:
            categories[key] = {'reason': reason, 'billable': is_billable, 'hours': 0.0, 'events': 0}
        categories[key]['hours'] += e.delay_hours or 0
        categories[key]['events'] += 1

    result = sorted(categories.values(), key=lambda x: (-x['hours'], x['reason']))
    for cat in result:
        cat['hours'] = round(cat['hours'], 1)
    return result


def _build_variation_billing(entry):
    """Build billing lines from per-variation employee/machine selections."""
    from models import Employee, Machine

    var_lines = []
    all_emp_ids = set()
    all_mach_ids = set()

    for vl in (entry.variation_lines or []):
        if not vl.hours or vl.hours <= 0:
            continue
        var_lines.append({
            'variation_number': vl.variation_number or '—',
            'description': vl.description or '',
            'hours': vl.hours,
        })
        for eid in vl.billed_employee_ids:
            all_emp_ids.add(eid)
        for mid in vl.billed_machine_ids:
            all_mach_ids.add(mid)

    total_var_hours = sum(v['hours'] for v in var_lines)

    # If no specific billing selections, fall back to entry's full crew
    if not all_emp_ids and not all_mach_ids:
        all_emp_ids = {e.id for e in entry.employees}
        all_mach_ids = {m.id for m in entry.machines}

    # Build employee cost lines
    emp_lines = []
    if all_emp_ids:
        role_counts = {}
        for emp in Employee.query.filter(Employee.id.in_(all_emp_ids)).all():
            if emp.delay_rate:
                label = emp.role or emp.name
                rate = emp.delay_rate
                key = (label, rate)
                role_counts[key] = role_counts.get(key, 0) + 1
        for (label, rate), count in sorted(role_counts.items()):
            cost = round(total_var_hours * rate * count, 2)
            people_str = f"{count} {'person' if count == 1 else 'people'}"
            emp_lines.append({
                'name': f"{label} ({people_str})",
                'rate': rate, 'count': count,
                'hours': total_var_hours, 'cost': cost,
            })

    # Build machine cost lines (grouped by MachineGroup)
    machine_lines = []
    if all_mach_ids:
        seen_groups = {}
        for m in Machine.query.filter(Machine.id.in_(all_mach_ids)).all():
            if m.group and m.group.delay_rate:
                if m.group.id not in seen_groups:
                    cost = round(total_var_hours * m.group.delay_rate, 2)
                    machine_lines.append({
                        'name': m.group.name,
                        'rate': m.group.delay_rate,
                        'hours': total_var_hours, 'cost': cost,
                        'is_group': True,
                    })
                    seen_groups[m.group.id] = True
            elif m.delay_rate:
                cost = round(total_var_hours * m.delay_rate, 2)
                machine_lines.append({
                    'name': f"{m.name}{' (' + m.plant_id + ')' if m.plant_id else ''}",
                    'rate': m.delay_rate,
                    'hours': total_var_hours, 'cost': cost,
                    'is_group': False,
                })

    return var_lines, emp_lines, machine_lines


def build_delay_report(project_id, date_from, date_to, billable_filter='all'):
    """Return per-entry delay breakdown grouped by role, with billable split.
    Includes weather delays, equipment costs (grouped by MachineGroup), and
    client variations as separate billable line items."""

    # Weather/standard delays
    delay_query = (DailyEntry.query
                   .filter(DailyEntry.delay_hours > 0)
                   .filter(DailyEntry.entry_date >= date_from)
                   .filter(DailyEntry.entry_date <= date_to)
                   .order_by(DailyEntry.entry_date))
    if project_id:
        delay_query = delay_query.filter_by(project_id=int(project_id))
    if billable_filter == 'billable':
        delay_query = delay_query.filter(DailyEntry.delay_billable == True)
    elif billable_filter == 'non_billable':
        delay_query = delay_query.filter(DailyEntry.delay_billable == False)

    # Also find entries with variations (always billable)
    var_query = (DailyEntry.query
                 .filter(DailyEntry.entry_date >= date_from)
                 .filter(DailyEntry.entry_date <= date_to)
                 .order_by(DailyEntry.entry_date))
    if project_id:
        var_query = var_query.filter_by(project_id=int(project_id))

    rows = []
    total_cost = 0.0
    total_hours_billable = 0.0
    total_hours_non_billable = 0.0
    total_variation_cost = 0.0
    total_variation_hours = 0.0
    seen_entry_ids = set()

    # Process delay entries
    for entry in delay_query.all():
        seen_entry_ids.add(entry.id)

        role_counts = {}
        for emp in entry.employees:
            if emp.delay_rate:
                label = emp.role if emp.role else emp.name
                rate = emp.delay_rate
                key = (label, rate)
                role_counts[key] = role_counts.get(key, 0) + 1

        emp_lines = []
        for (label, rate), count in sorted(role_counts.items()):
            cost = round(entry.delay_hours * rate * count, 2)
            people_str = f"{count} {'person' if count == 1 else 'people'}"
            emp_lines.append({
                'name': f"{label} ({people_str})",
                'rate': rate, 'count': count,
                'hours': entry.delay_hours, 'cost': cost,
            })

        # Equipment costs — group machines by MachineGroup
        machine_lines = []
        seen_groups = {}
        for m in entry.machines:
            if m.group and m.group.delay_rate:
                # Charge the group rate once per group, not per machine
                if m.group.id not in seen_groups:
                    cost = round(entry.delay_hours * m.group.delay_rate, 2)
                    machine_lines.append({
                        'name': m.group.name,
                        'rate': m.group.delay_rate,
                        'hours': entry.delay_hours, 'cost': cost,
                        'is_group': True,
                    })
                    seen_groups[m.group.id] = True
            elif m.delay_rate:
                # Individual machine (not in a group or group has no rate)
                cost = round(entry.delay_hours * m.delay_rate, 2)
                machine_lines.append({
                    'name': f"{m.name}{' (' + m.plant_id + ')' if m.plant_id else ''}",
                    'rate': m.delay_rate,
                    'hours': entry.delay_hours, 'cost': cost,
                    'is_group': False,
                })

        # Variation lines for this entry (if any) — with their own billing
        if entry.variation_lines:
            var_lines_data, var_emp_lines, var_machine_lines = _build_variation_billing(entry)
            var_lines = var_lines_data
            # Add variation-specific costs to the entry total
            var_cost = sum(r['cost'] for r in var_emp_lines) + sum(r['cost'] for r in var_machine_lines)
        else:
            var_lines = []
            var_emp_lines = []
            var_machine_lines = []
            var_cost = 0

        is_billable = entry.delay_billable if entry.delay_billable is not None else True
        delay_cost = sum(r['cost'] for r in emp_lines) + sum(r['cost'] for r in machine_lines)
        entry_cost = delay_cost + var_cost

        if is_billable:
            total_cost += entry_cost
            total_hours_billable += entry.delay_hours
        else:
            total_hours_non_billable += entry.delay_hours
        # Variations are always billable
        total_variation_cost += var_cost
        total_variation_hours += sum(v['hours'] for v in var_lines)

        rows.append({
            'entry': entry,
            'emp_lines': emp_lines,
            'machine_lines': machine_lines,
            'var_lines': var_lines,
            'var_emp_lines': var_emp_lines,
            'var_machine_lines': var_machine_lines,
            'entry_cost': entry_cost,
            'billable': is_billable,
            'type': 'delay',
        })

    # Process entries with variations that don't have weather delays
    if billable_filter != 'non_billable':
        for entry in var_query.all():
            if entry.id in seen_entry_ids:
                continue  # already included above
            if not entry.variation_lines:
                continue
            var_hours = sum(vl.hours or 0 for vl in entry.variation_lines)
            if var_hours <= 0:
                continue

            var_lines, emp_lines, machine_lines = _build_variation_billing(entry)

            entry_cost = sum(r['cost'] for r in emp_lines) + sum(r['cost'] for r in machine_lines)
            total_variation_cost += entry_cost
            total_variation_hours += var_hours

            rows.append({
                'entry': entry,
                'emp_lines': emp_lines,
                'machine_lines': machine_lines,
                'var_lines': var_lines,
                'entry_cost': entry_cost,
                'billable': True,
                'type': 'variation',
            })

    # Sort all rows by date
    rows.sort(key=lambda r: r['entry'].entry_date)

    billable_count = sum(1 for r in rows if r['billable'])
    summary = {
        'total_cost': round(total_cost + total_variation_cost, 2),
        'total_hours': total_hours_billable + total_hours_non_billable,
        'total_hours_billable': total_hours_billable,
        'total_hours_non_billable': total_hours_non_billable,
        'total_variation_hours': total_variation_hours,
        'total_variation_cost': round(total_variation_cost, 2),
        'entry_count': len(rows),
        'billable_count': billable_count,
        'non_billable_count': len(rows) - billable_count,
    }
    return rows, summary
