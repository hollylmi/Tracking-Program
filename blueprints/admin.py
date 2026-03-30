import os
import json
from datetime import datetime

from flask import (Blueprint, render_template, request, redirect, url_for,
                   flash, send_file, current_app)
from flask_login import current_user

from blueprints.auth import require_role

from models import (db, Project, Employee, Machine, MachineGroup, DailyEntry, HiredMachine,
                    StandDown, Role, PlannedData, ProjectNonWorkDate,
                    ProjectBudgetedRole, ProjectMachine, ProjectWorkedSunday,
                    PublicHoliday, CFMEUDate, AUSTRALIAN_STATES,
                    User, UserProjectAccess)
from utils.settings import load_settings, save_settings

admin_bp = Blueprint('admin', __name__)


@admin_bp.route('/admin/migrate-from-sqlite')
@require_role('admin')
def admin_migrate_sqlite():
    """One-time migration: read the old SQLite file on the volume and import into Postgres."""
    db_url = current_app.config['SQLALCHEMY_DATABASE_URI']
    if not db_url.startswith('postgresql'):
        flash('This tool only works when the app is using PostgreSQL. You are currently on SQLite.', 'warning')
        return redirect(url_for('admin.admin_settings'))

    # Find the SQLite file — try common Railway paths
    sqlite_candidates = [
        os.path.join(os.path.dirname(os.path.dirname(__file__)), 'instance', 'tracking.db'),
        '/app/instance/tracking.db',
        '/data/tracking.db',
        '/var/data/tracking.db',
    ]
    sqlite_path = next((p for p in sqlite_candidates if os.path.exists(p)), None)
    if not sqlite_path:
        flash('SQLite file not found. It may have already been cleaned up, or was never on this volume.', 'danger')
        return redirect(url_for('admin.admin_settings'))

    import sqlite3 as _sqlite3
    conn = _sqlite3.connect(sqlite_path)
    conn.row_factory = _sqlite3.Row

    def tbl(name):
        try:
            cur = conn.execute(f"SELECT * FROM {name}")
            return [dict(r) for r in cur.fetchall()]
        except Exception:
            return []

    def assoc(name):
        try:
            cur = conn.execute(f"SELECT * FROM {name}")
            return [list(r) for r in cur.fetchall()]
        except Exception:
            return []

    data = {
        'role':                  tbl('role'),
        'project':               tbl('project'),
        'employee':              tbl('employee'),
        'machine':               tbl('machine'),
        'daily_entry':           tbl('daily_entry'),
        'entry_employees':       assoc('entry_employees'),
        'entry_machines':        assoc('entry_machines'),
        'hired_machine':         tbl('hired_machine'),
        'stand_down':            tbl('stand_down'),
        'planned_data':          tbl('planned_data'),
        'project_non_work_date': tbl('project_non_work_date'),
        'project_budgeted_role': tbl('project_budgeted_role'),
        'project_machine':       tbl('project_machine'),
        'project_worked_sunday': tbl('project_worked_sunday'),
        'public_holiday':        tbl('public_holiday'),
        'cfmeu_date':            tbl('cfmeu_date'),
        'swing_pattern':         tbl('swing_pattern'),
        'employee_swing':        tbl('employee_swing'),
        'user':                  tbl('user'),
    }
    conn.close()

    total = sum(len(v) for v in data.values())
    if total == 0:
        flash('SQLite file exists but appears to be empty — nothing to migrate.', 'warning')
        return redirect(url_for('admin.admin_settings'))

    # Save as JSON and feed through the existing import route logic
    import io
    json_bytes = json.dumps(data, default=str).encode('utf-8')
    json_file = io.BytesIO(json_bytes)
    json_file.filename = 'export.json'

    # Store in session and redirect to import page with auto-trigger
    # Instead, redirect with the data available via a temp file
    tmp_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'instance', '_sqlite_migration.json')
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, default=str)

    flash(f'SQLite file found with {total} rows. Use the Import Data page to upload the migration file, '
          f'or visit /admin/migrate-from-sqlite/run to run it automatically.', 'info')
    return redirect(url_for('admin.admin_migrate_sqlite_run'))


# FRAGILE: complex ID-remapping across 15+ models.
# Do not modify without reading the full import sequence.
@admin_bp.route('/admin/migrate-from-sqlite/run')
@require_role('admin')
def admin_migrate_sqlite_run():
    """Actually perform the SQLite → Postgres migration using the temp JSON file."""
    tmp_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'instance', '_sqlite_migration.json')
    if not os.path.exists(tmp_path):
        flash('No migration file found. Visit /admin/migrate-from-sqlite first.', 'danger')
        return redirect(url_for('admin.admin_settings'))

    with open(tmp_path, encoding='utf-8') as f:
        data = json.load(f)

    from sqlalchemy import text as _text

    def _d(val):
        if not val:
            return None
        try:
            return datetime.strptime(str(val)[:10], '%Y-%m-%d').date()
        except Exception:
            return None

    counts = {}
    try:
        # Roles
        role_id_map = {}
        for r in data.get('role', []):
            existing = Role.query.filter_by(name=r['name']).first()
            if not existing:
                obj = Role(name=r['name'], delay_rate=r.get('delay_rate'), group_name=r.get('group_name'))
                db.session.add(obj)
                db.session.flush()
                role_id_map[r['id']] = obj.id
            else:
                role_id_map[r['id']] = existing.id
        counts['roles'] = len(role_id_map)

        # Projects
        proj_id_map = {}
        for p in data.get('project', []):
            existing = Project.query.filter_by(name=p['name']).first()
            if existing:
                proj_id_map[p['id']] = existing.id
                continue
            obj = Project(
                name=p['name'], description=p.get('description'),
                active=bool(p.get('active', True)),
                start_date=_d(p.get('start_date')),
                planned_crew=p.get('planned_crew'),
                hours_per_day=p.get('hours_per_day'),
                quoted_days=p.get('quoted_days'),
                state=p.get('state'), is_cfmeu=bool(p.get('is_cfmeu', False)),
            )
            db.session.add(obj)
            db.session.flush()
            proj_id_map[p['id']] = obj.id
        counts['projects'] = len(proj_id_map)

        # Employees
        emp_id_map = {}
        for e in data.get('employee', []):
            existing = Employee.query.filter_by(name=e['name']).first()
            if existing:
                emp_id_map[e['id']] = existing.id
                continue
            obj = Employee(
                name=e['name'], role=e.get('role'),
                role_id=role_id_map.get(e['role_id']) if e.get('role_id') else None,
                delay_rate=e.get('delay_rate'), active=bool(e.get('active', True)),
            )
            db.session.add(obj)
            db.session.flush()
            emp_id_map[e['id']] = obj.id
        counts['employees'] = len(emp_id_map)

        # Machines
        mach_id_map = {}
        for m in data.get('machine', []):
            existing = Machine.query.filter_by(name=m['name']).first()
            if existing:
                mach_id_map[m['id']] = existing.id
                continue
            obj = Machine(
                name=m['name'], machine_type=m.get('machine_type'),
                delay_rate=m.get('delay_rate'), active=bool(m.get('active', True)),
            )
            db.session.add(obj)
            db.session.flush()
            mach_id_map[m['id']] = obj.id
        counts['machines'] = len(mach_id_map)

        # Daily Entries
        entry_id_map = {}
        for e in data.get('daily_entry', []):
            new_proj_id = proj_id_map.get(e['project_id'])
            if not new_proj_id:
                continue
            obj = DailyEntry(
                project_id=new_proj_id, entry_date=_d(e['entry_date']),
                lot_number=e.get('lot_number'), location=e.get('location'),
                material=e.get('material'), num_people=e.get('num_people'),
                install_hours=e.get('install_hours') or 0,
                install_sqm=e.get('install_sqm') or 0,
                delay_hours=e.get('delay_hours') or 0,
                delay_billable=bool(e.get('delay_billable', True)),
                delay_reason=e.get('delay_reason'),
                delay_description=e.get('delay_description'),
                machines_stood_down=bool(e.get('machines_stood_down', False)),
                notes=e.get('notes'),
                other_work_description=e.get('other_work_description'),
                weather=e.get('weather'),
            )
            db.session.add(obj)
            db.session.flush()
            entry_id_map[e['id']] = obj.id
        counts['entries'] = len(entry_id_map)

        # Entry ↔ Employee
        assoc_e = 0
        for row in data.get('entry_employees', []):
            new_entry_id = entry_id_map.get(row[0])
            new_emp_id = emp_id_map.get(row[1])
            if new_entry_id and new_emp_id:
                db.session.execute(_text(
                    'INSERT INTO entry_employees (entry_id, employee_id) VALUES (:e, :m)'
                ), {'e': new_entry_id, 'm': new_emp_id})
                assoc_e += 1
        counts['entry_employees'] = assoc_e

        # Entry ↔ Machine
        assoc_m = 0
        for row in data.get('entry_machines', []):
            new_entry_id = entry_id_map.get(row[0])
            new_mach_id = mach_id_map.get(row[1])
            if new_entry_id and new_mach_id:
                db.session.execute(_text(
                    'INSERT INTO entry_machines (entry_id, machine_id) VALUES (:e, :m)'
                ), {'e': new_entry_id, 'm': new_mach_id})
                assoc_m += 1
        counts['entry_machines'] = assoc_m

        # Hired Machines
        hm_id_map = {}
        for h in data.get('hired_machine', []):
            new_proj_id = proj_id_map.get(h['project_id'])
            if not new_proj_id:
                continue
            obj = HiredMachine(
                project_id=new_proj_id, machine_name=h['machine_name'],
                machine_type=h.get('machine_type'), hire_company=h.get('hire_company'),
                delivery_date=_d(h.get('delivery_date')), return_date=_d(h.get('return_date')),
                cost_per_day=h.get('cost_per_day'), cost_per_week=h.get('cost_per_week'),
                active=bool(h.get('active', True)), notes=h.get('notes'),
            )
            db.session.add(obj)
            db.session.flush()
            hm_id_map[h['id']] = obj.id
        counts['hired_machines'] = len(hm_id_map)

        # Public Holidays
        ph_count = 0
        for h in data.get('public_holiday', []):
            existing = PublicHoliday.query.filter_by(date=_d(h['date']), name=h['name']).first()
            if not existing:
                db.session.add(PublicHoliday(
                    date=_d(h['date']), name=h['name'],
                    state=h.get('state', 'ALL'), recurring=bool(h.get('recurring', True)),
                ))
                ph_count += 1
        counts['public_holidays'] = ph_count

        # CFMEU Dates
        cfmeu_count = 0
        for c in data.get('cfmeu_date', []):
            existing = CFMEUDate.query.filter_by(date=_d(c['date'])).first()
            if not existing:
                db.session.add(CFMEUDate(
                    date=_d(c['date']), name=c.get('name', ''),
                    state=c.get('state', 'ALL'),
                ))
                cfmeu_count += 1
        counts['cfmeu_dates'] = cfmeu_count

        # Non-work dates, budgeted roles, worked sundays
        for n in data.get('project_non_work_date', []):
            new_proj_id = proj_id_map.get(n['project_id'])
            if new_proj_id:
                db.session.add(ProjectNonWorkDate(project_id=new_proj_id, date=_d(n['date']), reason=n.get('reason')))
        for b in data.get('project_budgeted_role', []):
            new_proj_id = proj_id_map.get(b['project_id'])
            if new_proj_id:
                db.session.add(ProjectBudgetedRole(project_id=new_proj_id, role_name=b['role_name'], budgeted_count=b.get('budgeted_count', 1)))
        for w in data.get('project_worked_sunday', []):
            new_proj_id = proj_id_map.get(w['project_id'])
            if new_proj_id:
                db.session.add(ProjectWorkedSunday(project_id=new_proj_id, date=_d(w['date']), reason=w.get('reason')))

        db.session.commit()
        os.remove(tmp_path)  # Clean up temp file

        summary = ', '.join(f'{v} {k}' for k, v in counts.items() if v)
        flash(f'Migration successful! {summary}', 'success')

    except Exception as e:
        db.session.rollback()
        flash(f'Migration failed: {e}', 'danger')

    return redirect(url_for('admin.admin_settings'))


# ---------------------------------------------------------------------------
# Admin — Data Import (migrate local data to production)
# ---------------------------------------------------------------------------

# FRAGILE: complex ID-remapping across 15+ models.
# Do not modify without reading the full import sequence.
@admin_bp.route('/admin/import-data', methods=['GET', 'POST'])
@require_role('admin')
def admin_import_data():
    if request.method == 'POST':
        f = request.files.get('export_file')
        if not f or not f.filename.endswith('.json'):
            flash('Please upload a valid export.json file.', 'danger')
            return redirect(url_for('admin.admin_import_data'))

        try:
            data = json.loads(f.read().decode('utf-8'))
        except Exception as e:
            flash(f'Could not read file: {e}', 'danger')
            return redirect(url_for('admin.admin_import_data'))

        from sqlalchemy import text as _text

        def _d(val):
            """Parse date string or return None."""
            if not val:
                return None
            try:
                return datetime.strptime(val[:10], '%Y-%m-%d').date()
            except Exception:
                return None

        def _dt(val):
            if not val:
                return None
            try:
                return datetime.strptime(val[:19], '%Y-%m-%d %H:%M:%S')
            except Exception:
                return None

        counts = {}
        try:
            # ── Roles ──────────────────────────────────────────────────────
            role_id_map = {}
            for r in data.get('role', []):
                existing = Role.query.filter_by(name=r['name']).first()
                if not existing:
                    obj = Role(name=r['name'], delay_rate=r.get('delay_rate'))
                    db.session.add(obj)
                    db.session.flush()
                    role_id_map[r['id']] = obj.id
                else:
                    role_id_map[r['id']] = existing.id
            counts['roles'] = len(role_id_map)

            # ── Projects ───────────────────────────────────────────────────
            proj_id_map = {}
            for p in data.get('project', []):
                obj = Project(
                    name=p['name'],
                    description=p.get('description'),
                    active=bool(p.get('active', True)),
                    start_date=_d(p.get('start_date')),
                    planned_crew=p.get('planned_crew'),
                    hours_per_day=p.get('hours_per_day'),
                    quoted_days=p.get('quoted_days'),
                )
                db.session.add(obj)
                db.session.flush()
                proj_id_map[p['id']] = obj.id
            counts['projects'] = len(proj_id_map)

            # ── Employees ──────────────────────────────────────────────────
            emp_id_map = {}
            for e in data.get('employee', []):
                old_role_id = e.get('role_id')
                obj = Employee(
                    name=e['name'],
                    role=e.get('role'),
                    role_id=role_id_map.get(old_role_id) if old_role_id else None,
                    delay_rate=e.get('delay_rate'),
                    active=bool(e.get('active', True)),
                )
                db.session.add(obj)
                db.session.flush()
                emp_id_map[e['id']] = obj.id
            counts['employees'] = len(emp_id_map)

            # ── Machines ───────────────────────────────────────────────────
            mach_id_map = {}
            for m in data.get('machine', []):
                obj = Machine(
                    name=m['name'],
                    machine_type=m.get('machine_type'),
                    delay_rate=m.get('delay_rate'),
                    active=bool(m.get('active', True)),
                )
                db.session.add(obj)
                db.session.flush()
                mach_id_map[m['id']] = obj.id
            counts['machines'] = len(mach_id_map)

            # ── Daily Entries ──────────────────────────────────────────────
            entry_id_map = {}
            for e in data.get('daily_entry', []):
                new_proj_id = proj_id_map.get(e['project_id'])
                if not new_proj_id:
                    continue
                obj = DailyEntry(
                    project_id=new_proj_id,
                    entry_date=_d(e['entry_date']),
                    lot_number=e.get('lot_number'),
                    location=e.get('location'),
                    material=e.get('material'),
                    num_people=e.get('num_people'),
                    install_hours=e.get('install_hours') or 0,
                    install_sqm=e.get('install_sqm') or 0,
                    delay_hours=e.get('delay_hours') or 0,
                    delay_billable=bool(e.get('delay_billable', True)),
                    delay_reason=e.get('delay_reason'),
                    delay_description=e.get('delay_description'),
                    machines_stood_down=bool(e.get('machines_stood_down', False)),
                    notes=e.get('notes'),
                    other_work_description=e.get('other_work_description'),
                )
                db.session.add(obj)
                db.session.flush()
                entry_id_map[e['id']] = obj.id
            counts['entries'] = len(entry_id_map)

            # ── Entry ↔ Employee associations ──────────────────────────────
            assoc_e_count = 0
            for row in data.get('entry_employees', []):
                new_entry_id = entry_id_map.get(row[0])
                new_emp_id = emp_id_map.get(row[1])
                if new_entry_id and new_emp_id:
                    db.session.execute(
                        _text('INSERT INTO entry_employees (entry_id, employee_id) VALUES (:e, :m)'),
                        {'e': new_entry_id, 'm': new_emp_id}
                    )
                    assoc_e_count += 1
            counts['entry_employees'] = assoc_e_count

            # ── Entry ↔ Machine associations ───────────────────────────────
            assoc_m_count = 0
            for row in data.get('entry_machines', []):
                new_entry_id = entry_id_map.get(row[0])
                new_mach_id = mach_id_map.get(row[1])
                if new_entry_id and new_mach_id:
                    db.session.execute(
                        _text('INSERT INTO entry_machines (entry_id, machine_id) VALUES (:e, :m)'),
                        {'e': new_entry_id, 'm': new_mach_id}
                    )
                    assoc_m_count += 1
            counts['entry_machines'] = assoc_m_count

            # ── Hired Machines ─────────────────────────────────────────────
            hm_id_map = {}
            for h in data.get('hired_machine', []):
                new_proj_id = proj_id_map.get(h['project_id'])
                if not new_proj_id:
                    continue
                obj = HiredMachine(
                    project_id=new_proj_id,
                    machine_name=h['machine_name'],
                    machine_type=h.get('machine_type'),
                    hire_company=h.get('hire_company'),
                    hire_company_email=h.get('hire_company_email'),
                    hire_company_phone=h.get('hire_company_phone'),
                    delivery_date=_d(h.get('delivery_date')),
                    return_date=_d(h.get('return_date')),
                    cost_per_day=h.get('cost_per_day'),
                    cost_per_week=h.get('cost_per_week'),
                    count_saturdays=bool(h.get('count_saturdays', True)),
                    notes=h.get('notes'),
                    active=bool(h.get('active', True)),
                )
                db.session.add(obj)
                db.session.flush()
                hm_id_map[h['id']] = obj.id
            counts['hired_machines'] = len(hm_id_map)

            # ── Stand Downs ────────────────────────────────────────────────
            sd_count = 0
            for s in data.get('stand_down', []):
                new_hm_id = hm_id_map.get(s['hired_machine_id'])
                if not new_hm_id:
                    continue
                new_entry_id = entry_id_map.get(s.get('entry_id')) if s.get('entry_id') else None
                obj = StandDown(
                    hired_machine_id=new_hm_id,
                    entry_id=new_entry_id,
                    stand_down_date=_d(s['stand_down_date']),
                    reason=s.get('reason', ''),
                )
                db.session.add(obj)
                sd_count += 1
            counts['stand_downs'] = sd_count

            # ── Planned Data ───────────────────────────────────────────────
            pd_count = 0
            for p in data.get('planned_data', []):
                new_proj_id = proj_id_map.get(p['project_id'])
                if not new_proj_id:
                    continue
                obj = PlannedData(
                    project_id=new_proj_id,
                    lot=p.get('lot'),
                    location=p.get('location'),
                    material=p.get('material'),
                    day_number=p.get('day_number'),
                    planned_sqm=p.get('planned_sqm'),
                )
                db.session.add(obj)
                pd_count += 1
            counts['planned_data'] = pd_count

            # ── Project Non-Work Dates ─────────────────────────────────────
            nwd_count = 0
            for n in data.get('project_non_work_date', []):
                new_proj_id = proj_id_map.get(n['project_id'])
                if not new_proj_id:
                    continue
                db.session.add(ProjectNonWorkDate(
                    project_id=new_proj_id,
                    date=_d(n['date']),
                    reason=n.get('reason'),
                ))
                nwd_count += 1
            counts['non_work_dates'] = nwd_count

            # ── Project Budgeted Roles ─────────────────────────────────────
            br_count = 0
            for b in data.get('project_budgeted_role', []):
                new_proj_id = proj_id_map.get(b['project_id'])
                if not new_proj_id:
                    continue
                db.session.add(ProjectBudgetedRole(
                    project_id=new_proj_id,
                    role_name=b['role_name'],
                    budgeted_count=b.get('budgeted_count', 1),
                ))
                br_count += 1
            counts['budgeted_roles'] = br_count

            # ── Project Machines (own fleet) ───────────────────────────────
            pm_count = 0
            for p in data.get('project_machine', []):
                new_proj_id = proj_id_map.get(p['project_id'])
                new_mach_id = mach_id_map.get(p['machine_id'])
                if not new_proj_id or not new_mach_id:
                    continue
                db.session.add(ProjectMachine(
                    project_id=new_proj_id,
                    machine_id=new_mach_id,
                    assigned_date=_d(p.get('assigned_date')),
                    notes=p.get('notes'),
                ))
                pm_count += 1
            counts['project_machines'] = pm_count

            # ── Worked Sundays ─────────────────────────────────────────────
            ws_count = 0
            for w in data.get('project_worked_sunday', []):
                new_proj_id = proj_id_map.get(w['project_id'])
                if not new_proj_id:
                    continue
                db.session.add(ProjectWorkedSunday(
                    project_id=new_proj_id,
                    date=_d(w['date']),
                    reason=w.get('reason'),
                ))
                ws_count += 1
            counts['worked_sundays'] = ws_count

            db.session.commit()

            summary = ', '.join(f'{v} {k}' for k, v in counts.items() if v)
            flash(f'Import successful! {summary}. Note: uploaded photos/documents need to be re-uploaded manually.', 'success')

        except Exception as e:
            db.session.rollback()
            flash(f'Import failed: {e}', 'danger')

        return redirect(url_for('admin.admin_import_data'))

    # GET — show the import page
    entry_count = DailyEntry.query.count()
    project_count = Project.query.count()
    return render_template('admin/import_data.html',
                           entry_count=entry_count,
                           project_count=project_count)


# ---------------------------------------------------------------------------
# Admin — Projects / Employees / Machines / Roles / Settings
# ---------------------------------------------------------------------------

@admin_bp.route('/admin/projects', methods=['GET', 'POST'])
@require_role('admin')
def admin_projects():
    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'add':
            name = request.form.get('name', '').strip()
            description = request.form.get('description', '').strip()
            if name:
                p = Project(name=name, description=description or None)
                start_str = request.form.get('start_date', '').strip()
                if start_str:
                    try:
                        p.start_date = datetime.strptime(start_str, '%Y-%m-%d').date()
                    except ValueError:
                        pass
                for attr, raw, cast in [
                    ('planned_crew', request.form.get('planned_crew', '').strip(), int),
                    ('hours_per_day', request.form.get('hours_per_day', '').strip(), float),
                    ('quoted_days', request.form.get('quoted_days', '').strip(), int),
                ]:
                    if raw:
                        try:
                            setattr(p, attr, cast(raw))
                        except ValueError:
                            pass
                p.site_address = request.form.get('site_address', '').strip() or None
                p.site_contact = request.form.get('site_contact', '').strip() or None
                db.session.add(p)
                db.session.commit()
                flash(f'Project "{name}" added.', 'success')
            else:
                flash('Project name is required.', 'danger')
        elif action == 'edit':
            project = Project.query.get_or_404(int(request.form.get('id')))
            project.name = request.form.get('name', '').strip()
            project.description = request.form.get('description', '').strip() or None
            start_str = request.form.get('start_date', '').strip()
            project.start_date = datetime.strptime(start_str, '%Y-%m-%d').date() if start_str else None
            planned_crew = request.form.get('planned_crew', '').strip()
            project.planned_crew = int(planned_crew) if planned_crew else None
            hours_per_day = request.form.get('hours_per_day', '').strip()
            project.hours_per_day = float(hours_per_day) if hours_per_day else None
            quoted_days = request.form.get('quoted_days', '').strip()
            project.quoted_days = int(quoted_days) if quoted_days else None
            project.site_address = request.form.get('site_address', '').strip() or None
            project.site_contact = request.form.get('site_contact', '').strip() or None
            db.session.commit()
            flash('Project updated.', 'success')
        elif action == 'toggle':
            project = Project.query.get_or_404(int(request.form.get('id')))
            project.active = not project.active
            db.session.commit()
            flash(f'Project "{project.name}" {"activated" if project.active else "deactivated"}.', 'info')
        elif action == 'delete':
            project = Project.query.get_or_404(int(request.form.get('id')))
            if project.entries:
                flash('Cannot delete — has existing entries. Deactivate instead.', 'danger')
            else:
                ProjectMachine.query.filter_by(project_id=project.id).delete()
                db.session.delete(project)
                db.session.commit()
                flash('Project deleted.', 'info')
        return redirect(url_for('admin.admin_projects'))

    projects = Project.query.order_by(Project.name).all()
    return render_template('admin/projects.html', projects=projects)


@admin_bp.route('/admin/users/<int:user_id>/projects', methods=['GET', 'POST'])
@require_role('admin')
def admin_user_projects(user_id):
    user = User.query.get_or_404(user_id)
    all_projects = Project.query.filter_by(active=True).order_by(Project.name).all()

    if request.method == 'POST':
        UserProjectAccess.query.filter_by(user_id=user_id).delete()
        for pid in request.form.getlist('project_ids'):
            try:
                db.session.add(UserProjectAccess(
                    user_id=user_id,
                    project_id=int(pid),
                    granted_by=current_user.id,
                ))
            except (ValueError, TypeError):
                pass
        db.session.commit()
        flash(f'Project access updated for "{user.username}".', 'success')
        return redirect(url_for('auth.admin_users'))

    access_ids = {a.project_id for a in UserProjectAccess.query.filter_by(user_id=user_id).all()}
    return render_template('admin/user_projects.html',
                           user=user, all_projects=all_projects, access_ids=access_ids)


@admin_bp.route('/admin/projects/<int:project_id>/users', methods=['GET', 'POST'])
@require_role('admin')
def admin_project_users(project_id):
    project = Project.query.get_or_404(project_id)
    all_users = (User.query
                 .filter(User.role.in_(['supervisor', 'site']), User.active == True)
                 .order_by(User.username).all())

    if request.method == 'POST':
        UserProjectAccess.query.filter_by(project_id=project_id).delete()
        for uid in request.form.getlist('user_ids'):
            try:
                db.session.add(UserProjectAccess(
                    user_id=int(uid),
                    project_id=project_id,
                    granted_by=current_user.id,
                ))
            except (ValueError, TypeError):
                pass
        db.session.commit()
        flash(f'User access updated for "{project.name}".', 'success')
        return redirect(url_for('admin.admin_projects'))

    access_ids = {a.user_id for a in UserProjectAccess.query.filter_by(project_id=project_id).all()}
    return render_template('admin/project_users.html',
                           project=project, all_users=all_users, access_ids=access_ids)


@admin_bp.route('/admin/employees', methods=['GET', 'POST'])
@require_role('admin')
def admin_employees():
    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'add':
            name = request.form.get('name', '').strip()
            role_ids = request.form.getlist('role_ids')
            delay_rate_raw = request.form.get('delay_rate', '').strip()
            if name:
                emp = Employee(name=name)
                emp.requires_accommodation = 'requires_accommodation' in request.form
                emp.home_base = request.form.get('home_base', '').strip() or None
                term_str = request.form.get('termination_date', '').strip()
                emp.termination_date = datetime.strptime(term_str, '%Y-%m-%d').date() if term_str else None
                db.session.add(emp)
                db.session.flush()  # get emp.id before setting m2m
                if role_ids:
                    role_objs = Role.query.filter(Role.id.in_([int(r) for r in role_ids])).all()
                    emp.roles = role_objs
                    emp.role = ', '.join(r.name for r in sorted(role_objs, key=lambda r: r.name))
                    emp.role_id = role_objs[0].id if len(role_objs) == 1 else None
                    if delay_rate_raw:
                        emp.delay_rate = float(delay_rate_raw)
                    else:
                        rates = [r.delay_rate for r in role_objs if r.delay_rate]
                        emp.delay_rate = max(rates) if rates else None
                else:
                    emp.delay_rate = float(delay_rate_raw) if delay_rate_raw else None
                db.session.commit()
                flash(f'Employee "{name}" added.', 'success')
            else:
                flash('Name is required.', 'danger')
        elif action == 'edit':
            emp = Employee.query.get_or_404(int(request.form.get('id')))
            emp.name = request.form.get('name', '').strip()
            emp.requires_accommodation = 'requires_accommodation' in request.form
            emp.home_base = request.form.get('home_base', '').strip() or None
            term_str = request.form.get('termination_date', '').strip()
            emp.termination_date = datetime.strptime(term_str, '%Y-%m-%d').date() if term_str else None
            role_ids = request.form.getlist('role_ids')
            delay_rate_raw = request.form.get('delay_rate', '').strip()
            if role_ids:
                role_objs = Role.query.filter(Role.id.in_([int(r) for r in role_ids])).all()
                emp.roles = role_objs
                emp.role = ', '.join(r.name for r in sorted(role_objs, key=lambda r: r.name))
                emp.role_id = role_objs[0].id if len(role_objs) == 1 else None
                if delay_rate_raw:
                    emp.delay_rate = float(delay_rate_raw)
                else:
                    rates = [r.delay_rate for r in role_objs if r.delay_rate]
                    emp.delay_rate = max(rates) if rates else None
            else:
                emp.roles = []
                emp.role_id = None
                emp.role = None
                emp.delay_rate = float(delay_rate_raw) if delay_rate_raw else None
            db.session.commit()
            flash('Employee updated.', 'success')
        elif action == 'toggle':
            emp = Employee.query.get_or_404(int(request.form.get('id')))
            emp.active = not emp.active
            db.session.commit()
            flash(f'"{emp.name}" {"activated" if emp.active else "deactivated"}.', 'info')
        elif action == 'delete':
            emp = Employee.query.get_or_404(int(request.form.get('id')))
            if emp.entries:
                flash('Cannot delete — has entries. Deactivate instead.', 'danger')
            else:
                db.session.delete(emp)
                db.session.commit()
                flash('Employee deleted.', 'info')
        return redirect(url_for('admin.admin_employees'))

    employees = Employee.query.order_by(Employee.name).all()
    roles = Role.query.order_by(Role.name).all()
    return render_template('admin/employees.html', employees=employees, roles=roles)


@admin_bp.route('/admin/machines', methods=['GET', 'POST'])
@require_role('admin')
def admin_machines():
    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'add':
            name = request.form.get('name', '').strip()
            machine_type = request.form.get('machine_type', '').strip()
            plant_id = request.form.get('plant_id', '').strip()
            description = request.form.get('description', '').strip()
            delay_rate = request.form.get('delay_rate', '').strip()
            group_id = request.form.get('group_id', '').strip()
            if name:
                db.session.add(Machine(name=name, plant_id=plant_id or None,
                                       machine_type=machine_type or None,
                                       description=description or None,
                                       delay_rate=float(delay_rate) if delay_rate else None,
                                       group_id=int(group_id) if group_id else None))
                db.session.commit()
                flash(f'Machine "{name}" added.', 'success')
            else:
                flash('Name is required.', 'danger')
        elif action == 'edit':
            machine = Machine.query.get_or_404(int(request.form.get('id')))
            machine.name = request.form.get('name', '').strip()
            machine.plant_id = request.form.get('plant_id', '').strip() or None
            machine.machine_type = request.form.get('machine_type', '').strip() or None
            machine.description = request.form.get('description', '').strip() or None
            delay_rate = request.form.get('delay_rate', '').strip()
            machine.delay_rate = float(delay_rate) if delay_rate else None
            group_id = request.form.get('group_id', '').strip()
            machine.group_id = int(group_id) if group_id else None
            db.session.commit()
            flash('Machine updated.', 'success')
        elif action == 'add_group':
            gname = request.form.get('group_name', '').strip()
            gdesc = request.form.get('group_description', '').strip()
            grate = request.form.get('group_delay_rate', '').strip()
            if gname:
                db.session.add(MachineGroup(name=gname, description=gdesc or None,
                                             delay_rate=float(grate) if grate else None))
                db.session.commit()
                flash(f'Group "{gname}" created.', 'success')
            else:
                flash('Group name is required.', 'danger')
        elif action == 'edit_group':
            grp = MachineGroup.query.get_or_404(int(request.form.get('group_id')))
            grp.name = request.form.get('group_name', '').strip()
            grp.description = request.form.get('group_description', '').strip() or None
            grate = request.form.get('group_delay_rate', '').strip()
            grp.delay_rate = float(grate) if grate else None
            db.session.commit()
            flash(f'Group "{grp.name}" updated.', 'success')
        elif action == 'delete_group':
            grp = MachineGroup.query.get_or_404(int(request.form.get('group_id')))
            # Unlink machines from this group (don't delete them)
            Machine.query.filter_by(group_id=grp.id).update({'group_id': None})
            db.session.delete(grp)
            db.session.commit()
            flash(f'Group deleted. Machines moved to ungrouped.', 'info')
        elif action == 'toggle':
            machine = Machine.query.get_or_404(int(request.form.get('id')))
            machine.active = not machine.active
            db.session.commit()
            flash(f'"{machine.name}" {"activated" if machine.active else "deactivated"}.', 'info')
        elif action == 'delete':
            machine = Machine.query.get_or_404(int(request.form.get('id')))
            if machine.entries:
                flash('Cannot delete — has entries. Deactivate instead.', 'danger')
            else:
                ProjectMachine.query.filter_by(machine_id=machine.id).delete()
                db.session.delete(machine)
                db.session.commit()
                flash('Machine deleted.', 'info')
        elif action == 'assign':
            machine_id = int(request.form.get('machine_id'))
            project_id = int(request.form.get('project_id'))
            if not ProjectMachine.query.filter_by(project_id=project_id, machine_id=machine_id).first():
                db.session.add(ProjectMachine(project_id=project_id, machine_id=machine_id))
                db.session.commit()
                flash('Machine assigned to project.', 'success')
            else:
                flash('Already assigned to that project.', 'warning')
        elif action == 'unassign':
            pm = ProjectMachine.query.get_or_404(int(request.form.get('pm_id')))
            db.session.delete(pm)
            db.session.commit()
            flash('Assignment removed.', 'info')
        return redirect(url_for('admin.admin_machines'))

    machines = Machine.query.order_by(Machine.name).all()
    groups = MachineGroup.query.order_by(MachineGroup.name).all()
    projects = Project.query.filter_by(active=True).order_by(Project.name).all()
    all_assignments = ProjectMachine.query.all()
    assignments_by_machine = {}
    for pm in all_assignments:
        assignments_by_machine.setdefault(pm.machine_id, []).append(pm)
    return render_template('admin/machines.html', machines=machines, groups=groups,
                           projects=projects, assignments_by_machine=assignments_by_machine)


@admin_bp.route('/admin/roles', methods=['GET', 'POST'])
@require_role('admin')
def admin_roles():
    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'add':
            name = request.form.get('name', '').strip()
            delay_rate = request.form.get('delay_rate', '').strip()
            if name:
                db.session.add(Role(name=name, delay_rate=float(delay_rate) if delay_rate else None))
                db.session.commit()
                flash(f'Role "{name}" added.', 'success')
            else:
                flash('Role name is required.', 'danger')
        elif action == 'edit':
            role = Role.query.get_or_404(int(request.form.get('id')))
            role.name = request.form.get('name', '').strip()
            delay_rate = request.form.get('delay_rate', '').strip()
            role.delay_rate = float(delay_rate) if delay_rate else None
            group_name = request.form.get('group_name', '').strip()
            role.group_name = group_name or None
            db.session.commit()
            flash('Role updated.', 'success')
        elif action == 'delete':
            role = Role.query.get_or_404(int(request.form.get('id')))
            if role.employees:
                flash('Cannot delete — employees assigned to this role. Reassign first.', 'danger')
            else:
                db.session.delete(role)
                db.session.commit()
                flash('Role deleted.', 'info')
        return redirect(url_for('admin.admin_roles'))

    roles = Role.query.order_by(Role.name).all()
    return render_template('admin/roles.html', roles=roles)


@admin_bp.route('/admin/holidays', methods=['GET', 'POST'])
@require_role('admin')
def admin_holidays():
    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'add':
            selected_states = request.form.getlist('states')
            date_str = request.form.get('date', '').strip()
            name = request.form.get('name', '').strip()
            if selected_states and date_str and name:
                try:
                    d = datetime.strptime(date_str, '%Y-%m-%d').date()
                    states_str = ','.join(selected_states)
                    db.session.add(PublicHoliday(state=selected_states[0], states=states_str, date=d, name=name))
                    db.session.commit()
                    flash(f'Added: {name} ({states_str} — {d.strftime("%d/%m/%Y")}).', 'success')
                except ValueError:
                    flash('Invalid date.', 'danger')
            else:
                flash('Select at least one state, a date, and a name.', 'danger')
        elif action == 'delete':
            h = PublicHoliday.query.get(int(request.form.get('id', 0)))
            if h:
                db.session.delete(h)
                db.session.commit()
                flash('Holiday deleted.', 'success')
        return redirect(url_for('admin.admin_holidays'))
    holidays = PublicHoliday.query.order_by(PublicHoliday.date).all()
    return render_template('admin/holidays.html', holidays=holidays, states=AUSTRALIAN_STATES)


@admin_bp.route('/admin/cfmeu', methods=['GET', 'POST'])
@require_role('admin')
def admin_cfmeu():
    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'add':
            date_str = request.form.get('date', '').strip()
            name = request.form.get('name', '').strip()
            selected_states = request.form.getlist('states')
            if date_str and name and selected_states:
                try:
                    d = datetime.strptime(date_str, '%Y-%m-%d').date()
                    states_str = ','.join(selected_states)
                    db.session.add(CFMEUDate(state=selected_states[0], states=states_str, date=d, name=name))
                    db.session.commit()
                    flash(f'Added: {name} ({states_str} — {d.strftime("%d/%m/%Y")}).', 'success')
                except ValueError:
                    flash('Invalid date.', 'danger')
            else:
                flash('Select at least one state, a date, and a name.', 'danger')
        elif action == 'delete':
            c = CFMEUDate.query.get(int(request.form.get('id', 0)))
            if c:
                db.session.delete(c)
                db.session.commit()
                flash('CFMEU date deleted.', 'success')
        return redirect(url_for('admin.admin_cfmeu'))
    cfmeu_dates = CFMEUDate.query.order_by(CFMEUDate.date).all()
    return render_template('admin/cfmeu.html', cfmeu_dates=cfmeu_dates, states=AUSTRALIAN_STATES)


@admin_bp.route('/admin/backup/download')
@require_role('admin')
def admin_backup_download():
    """Download a database backup. Admin only."""
    db_url = current_app.config['SQLALCHEMY_DATABASE_URI']
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    if db_url.startswith('postgresql'):
        # Postgres — use pg_dump
        import subprocess, tempfile
        from urllib.parse import urlparse
        parsed = urlparse(db_url)
        env = os.environ.copy()
        env['PGPASSWORD'] = parsed.password or ''
        dump_file = os.path.join(tempfile.gettempdir(), f'plytrack_backup_{timestamp}.sql')
        cmd = [
            'pg_dump',
            '-h', parsed.hostname,
            '-p', str(parsed.port or 5432),
            '-U', parsed.username,
            '-d', parsed.path.lstrip('/'),
            '-f', dump_file,
            '--no-password',
        ]
        result = subprocess.run(cmd, env=env, capture_output=True, text=True)
        if result.returncode != 0:
            flash(f'pg_dump failed: {result.stderr[:200]}', 'danger')
            return redirect(url_for('admin.admin_settings'))
        return send_file(
            dump_file,
            as_attachment=True,
            download_name=f'plytrack_backup_{timestamp}.sql',
            mimetype='application/sql',
        )
    else:
        # SQLite — send the .db file directly
        db_path = db_url.replace('sqlite:///', '')
        if not os.path.isabs(db_path):
            db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'instance', 'tracking.db')
        if not os.path.exists(db_path):
            flash('Database file not found.', 'danger')
            return redirect(url_for('admin.admin_settings'))
        return send_file(
            db_path,
            as_attachment=True,
            download_name=f'plytrack_backup_{timestamp}.db',
            mimetype='application/octet-stream',
        )


@admin_bp.route('/admin/settings', methods=['GET', 'POST'])
@require_role('admin')
def admin_settings():
    settings = load_settings()
    if request.method == 'POST':
        settings['company_name'] = request.form.get('company_name', '').strip()
        settings['smtp_server'] = request.form.get('smtp_server', '').strip()
        settings['smtp_port'] = int(request.form.get('smtp_port') or 587)
        settings['smtp_username'] = request.form.get('smtp_username', '').strip()
        new_pw = request.form.get('smtp_password', '').strip()
        if new_pw:
            settings['smtp_password'] = new_pw
        settings['from_name'] = request.form.get('from_name', '').strip()
        settings['from_email'] = request.form.get('from_email', '').strip()
        save_settings(settings)
        flash('Settings saved.', 'success')
        return redirect(url_for('admin.admin_settings'))
    return render_template('admin/settings.html', settings=settings)
