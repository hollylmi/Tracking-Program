from models import DailyEntry, PlannedData, Project
from utils.helpers import _natural_key


def compute_project_progress(project_id):
    """Return planned vs actual progress data for a project."""
    planned = PlannedData.query.filter_by(project_id=project_id).all()
    if not planned:
        return None

    entries = (DailyEntry.query
               .filter_by(project_id=project_id)
               .filter(DailyEntry.install_sqm > 0)
               .all())

    planned_by_task = {}
    for p in planned:
        key = (p.lot or '', p.material or '')
        if key not in planned_by_task:
            planned_by_task[key] = {
                'lot': p.lot, 'location': p.location, 'material': p.material,
                'planned_sqm': 0, 'min_day': float('inf'), 'max_day': 0,
            }
        planned_by_task[key]['planned_sqm'] += p.planned_sqm or 0
        planned_by_task[key]['min_day'] = min(planned_by_task[key]['min_day'], p.day_number or 0)
        planned_by_task[key]['max_day'] = max(planned_by_task[key]['max_day'], p.day_number or 0)

    actual_by_task = {}
    total_install_hours = 0.0
    for e in entries:
        key = (e.lot_number or '', e.material or '')
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

    project = Project.query.get(project_id)
    return {
        'tasks': tasks,
        'total_planned': round(total_planned, 2),
        'total_actual': round(total_actual, 2),
        'total_remaining': round(max(0, total_planned - total_actual), 2),
        'overall_pct': min(overall_pct, 100),
        'install_rate': install_rate,
        'planned_crew': project.planned_crew,
        'current_crew': current_crew,
    }


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


def build_delay_report(project_id, date_from, date_to, billable_filter='all'):
    """Return per-entry delay breakdown grouped by role, with billable split."""
    query = (DailyEntry.query
             .filter(DailyEntry.delay_hours > 0)
             .filter(DailyEntry.entry_date >= date_from)
             .filter(DailyEntry.entry_date <= date_to)
             .order_by(DailyEntry.entry_date))
    if project_id:
        query = query.filter_by(project_id=int(project_id))
    if billable_filter == 'billable':
        query = query.filter(DailyEntry.delay_billable == True)
    elif billable_filter == 'non_billable':
        query = query.filter(DailyEntry.delay_billable == False)

    rows = []
    total_cost = 0.0
    total_hours_billable = 0.0
    total_hours_non_billable = 0.0

    for entry in query.all():
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

        machine_lines = []
        for m in entry.machines:
            if m.delay_rate:
                cost = round(entry.delay_hours * m.delay_rate, 2)
                machine_lines.append({'name': m.name, 'rate': m.delay_rate,
                                      'hours': entry.delay_hours, 'cost': cost})

        is_billable = entry.delay_billable if entry.delay_billable is not None else True
        entry_cost = sum(r['cost'] for r in emp_lines) + sum(r['cost'] for r in machine_lines)

        if is_billable:
            total_cost += entry_cost
            total_hours_billable += entry.delay_hours
        else:
            total_hours_non_billable += entry.delay_hours

        rows.append({
            'entry': entry,
            'emp_lines': emp_lines,
            'machine_lines': machine_lines,
            'entry_cost': entry_cost,
            'billable': is_billable,
        })

    billable_count = sum(1 for r in rows if r['billable'])
    summary = {
        'total_cost': round(total_cost, 2),
        'total_hours': total_hours_billable + total_hours_non_billable,
        'total_hours_billable': total_hours_billable,
        'total_hours_non_billable': total_hours_non_billable,
        'entry_count': len(rows),
        'billable_count': billable_count,
        'non_billable_count': len(rows) - billable_count,
    }
    return rows, summary
