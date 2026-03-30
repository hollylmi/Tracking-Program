import os
from datetime import date, datetime, timedelta

from flask import Blueprint, make_response, request, url_for
from sqlalchemy import or_
from flask_jwt_extended import jwt_required, get_jwt_identity

import uuid
from werkzeug.utils import secure_filename

from models import (
    db, User, Project, DailyEntry, EntryProductionLine, EntryVariationLine, EntryDelayLine, EntryOtherActivityLine,
    Employee, Machine, MachineGroup, HiredMachine, StandDown,
    MachineBreakdown, BreakdownPhoto, ProjectDocument, ProjectMachine, ProjectAssignment,
    PlannedData, Role, DeviceToken, EntryPhoto,
    ProjectBudgetedRole, ProjectNonWorkDate, PublicHoliday, CFMEUDate,
    EmployeeLeave, ScheduleDayOverride,
    MachineTransfer, SiteEquipmentChecklist, SiteEquipmentChecklistItem, MachineDailyCheck,
    MachineDocument, MachineHoursLog, ProjectDailyTaskAssignment,
    ScheduledEquipmentCheck, ScheduledCheckCompletion,
)
from utils.files import allowed_photo
import storage
from utils.gantt import compute_gantt_data
from utils.progress import compute_project_progress, compute_delay_summary, build_delay_report, compute_material_productivity
from utils.reports import generate_project_report_pdf, generate_weekly_report_pdf, generate_delay_pdf, generate_pdf
from utils.schedule import build_schedule_grid, build_day_summary
from utils.settings import load_settings

api_data_bp = Blueprint('api_data', __name__)

UPLOAD_FOLDER = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    'instance', 'uploads'
)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_user():
    """Load and validate the JWT user. Returns (user, error_response)."""
    user = User.query.get(int(get_jwt_identity()))
    if not user or not user.active:
        return None, ({'error': 'User not found or inactive'}, 401)
    return user, None


def _accessible_ids(user):
    """Return set of accessible project IDs, or None if admin (no restriction)."""
    if user.role == 'admin':
        return None
    return {p.id for p in user.accessible_projects()}


def _has_project_access(user, project_id, allowed_ids):
    """Return True if user can access the given project_id."""
    return allowed_ids is None or project_id in allowed_ids


def _parse_dt(value):
    """Parse an ISO datetime string from the app. Returns datetime or None."""
    if not value:
        return None
    s = str(value).strip().rstrip('Z')
    for fmt in ('%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S'):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _format_entry(entry, include_detail=False):
    """Serialise a DailyEntry. List view omits detail fields."""
    submitted_by = None
    if entry.submitted_by_user:
        submitted_by = (entry.submitted_by_user.display_name
                        or entry.submitted_by_user.username)

    base = {
        'id': entry.id,
        'date': entry.entry_date.isoformat() if entry.entry_date else None,
        'project_id': entry.project_id,
        'project_name': entry.project.name if entry.project else None,
        'lot_number': entry.lot_number,
        'material': entry.material,
        'install_hours': entry.install_hours,
        'install_sqm': entry.install_sqm,
        'num_people': entry.num_people,
        'delay_hours': entry.delay_hours,
        'delay_reason': entry.delay_reason,
        'delay_billable': entry.delay_billable,
        'notes': entry.notes,
        'submitted_by': submitted_by,
        'submitted_by_user_id': entry.user_id,
        'photo_count': len(entry.photos),
        'created_at': entry.created_at.isoformat() if entry.created_at else None,
    }

    if include_detail:
        base['delay_description'] = entry.delay_description
        base['other_work_description'] = entry.other_work_description
        base['location'] = entry.location
        base['machines_stood_down'] = entry.machines_stood_down
        base['weather'] = entry.weather
        base['photos'] = [
            {
                'id': p.id,
                'url': url_for(
                    'api_data.serve_photo',
                    filename=p.filename,
                    _external=True,
                ),
                'filename': p.original_name or p.filename,
            }
            for p in entry.photos
        ]
        base['employees'] = [
            {'id': e.id, 'name': e.name, 'role': e.role or ''}
            for e in entry.employees
        ]
        base['machines'] = [
            {'id': m.id, 'name': m.name, 'type': m.machine_type or ''}
            for m in entry.machines
        ]
        base['production_lines'] = [
            {'lot_number': pl.lot_number, 'material': pl.material,
             'install_hours': pl.install_hours, 'install_sqm': pl.install_sqm,
             'activity_type': pl.activity_type or 'deploy',
             'weld_metres': pl.weld_metres or 0,
             'employee_ids_json': pl.employee_ids_json or '[]'}
            for pl in entry.production_lines
        ]
        base['delay_lines'] = [
            {'reason': dl.reason, 'hours': dl.hours, 'description': dl.description}
            for dl in entry.delay_lines
        ]
        base['variation_lines'] = [
            {'variation_number': vl.variation_number, 'description': vl.description, 'hours': vl.hours,
             'employee_ids_json': vl.employee_ids_json or '[]', 'machine_ids_json': vl.machine_ids_json or '[]'}
            for vl in entry.variation_lines
        ]
        base['other_activity_lines'] = [
            {'description': ol.description, 'hours': ol.hours or 0, 'employee_ids_json': ol.employee_ids_json or '[]'}
            for ol in entry.other_activity_lines
        ] if hasattr(entry, 'other_activity_lines') else []
        base['own_delay_hours'] = entry.own_delay_hours
        base['own_delay_description'] = entry.own_delay_description
        sd_ids = [sd.hired_machine_id for sd in entry.stand_downs if sd.hired_machine_id]
        if sd_ids:
            hm_map = {
                hm.id: hm.machine_name
                for hm in HiredMachine.query.filter(HiredMachine.id.in_(sd_ids)).all()
            }
            base['standdown_machines'] = [
                {'id': hm_id, 'machine_name': hm_map[hm_id]}
                for hm_id in sd_ids
                if hm_id in hm_map
            ]
        else:
            base['standdown_machines'] = []

    return base


# ─────────────────────────────────────────────────────────────────────────────
# PHOTOS
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/photos/<filename>')
@jwt_required()
def serve_photo(filename):
    local_path = os.path.join(UPLOAD_FOLDER, filename)
    return storage.serve_file(f'photos/{filename}', local_path)


@api_data_bp.route('/equipment/breakdowns/photos/<filename>')
def serve_breakdown_photo_api(filename):
    # No JWT required — filenames are UUID-based so effectively private by obscurity,
    # matching the same behaviour as the web app's breakdown photo serving route.
    local_path = os.path.join(UPLOAD_FOLDER, 'breakdowns', filename)
    return storage.serve_file(f'breakdowns/{filename}', local_path)


@api_data_bp.route('/entries/<int:entry_id>/photos', methods=['POST'])
@jwt_required()
def upload_entry_photo(entry_id):
    user, err = _get_user()
    if err:
        return err

    entry = DailyEntry.query.get(entry_id)
    if not entry:
        return {'error': 'Entry not found'}, 404

    allowed_ids = _accessible_ids(user)
    if not _has_project_access(user, entry.project_id, allowed_ids):
        return {'error': 'Access denied'}, 403

    if 'photo' not in request.files:
        return {'error': 'No photo provided'}, 400

    photo = request.files['photo']
    if not photo or not photo.filename:
        return {'error': 'Invalid photo'}, 400

    if not allowed_photo(photo.filename):
        return {'error': 'File type not allowed'}, 400

    ext = photo.filename.rsplit('.', 1)[1].lower()
    stored_name = f"photo_{uuid.uuid4().hex}.{ext}"
    local_path = os.path.join(UPLOAD_FOLDER, stored_name)
    storage.upload_file(photo, f'photos/{stored_name}', local_path)

    entry_photo = EntryPhoto(
        entry_id=entry_id,
        filename=stored_name,
        original_name=secure_filename(photo.filename),
    )
    db.session.add(entry_photo)
    db.session.commit()

    return {
        'id': entry_photo.id,
        'url': url_for('api_data.serve_photo', filename=stored_name, _external=True),
        'filename': secure_filename(photo.filename),
    }, 201


# ─────────────────────────────────────────────────────────────────────────────
# PROJECTS
# ─────────────────────────────────────────────────────────────────────────────

def _project_base(project):
    return {
        'id': project.id,
        'name': project.name,
        'start_date': project.start_date.isoformat() if project.start_date else None,
        'active': project.active,
        'quoted_days': project.quoted_days,
        'hours_per_day': project.hours_per_day,
        'site_address': project.site_address,
        'site_contact': project.site_contact,
        'track_by_lot': project.track_by_lot if project.track_by_lot is not None else True,
    }


@api_data_bp.route('/projects', methods=['GET'])
@jwt_required()
def get_projects():
    user, err = _get_user()
    if err:
        return err

    return {'projects': [_project_base(p) for p in user.accessible_projects()]}, 200


@api_data_bp.route('/projects/<int:project_id>', methods=['GET'])
@jwt_required()
def get_project(project_id):
    user, err = _get_user()
    if err:
        return err

    project = Project.query.get(project_id)
    if not project:
        return {'error': 'Project not found'}, 404

    allowed_ids = _accessible_ids(user)
    if not _has_project_access(user, project_id, allowed_ids):
        return {'error': 'Access denied'}, 403

    data = _project_base(project)

    progress = compute_project_progress(project_id)
    if progress:
        data['progress'] = {
            'overall_pct': progress['overall_pct'],
            'should_be_pct': progress.get('should_be_pct'),
            'total_planned': progress['total_planned'],
            'total_actual': progress['total_actual'],
            'total_remaining': progress['total_remaining'],
            'planned_crew': progress.get('planned_crew'),
            'current_crew': progress.get('current_crew'),
            'total_delay_hours': progress.get('total_delay_hours'),
            'total_variation_hours': progress.get('total_variation_hours'),
            'delay_impact_days': progress.get('delay_impact_days'),
            'total_available_hours': progress.get('total_available_hours'),
            'total_lost_hours': progress.get('total_lost_hours'),
            'total_install_hours': progress.get('total_install_hours'),
            'non_deploy_hours': progress.get('non_deploy_hours'),
            'hours_per_day': progress.get('hours_per_day'),
            'delay_events': [
                {
                    'date': evt['date'],
                    'day': evt.get('day', ''),
                    'reason': evt['reason'],
                    'hours': evt['hours'],
                    'description': evt.get('description', ''),
                    'type': evt.get('type', 'delay'),
                }
                for evt in progress.get('delay_events', [])
            ],
            'tasks': [
                {
                    'lot': t['lot'],
                    'material': t['material'],
                    'planned_sqm': t['planned_sqm'],
                    'actual_sqm': t['actual_sqm'],
                    'pct_complete': t['pct_complete'],
                }
                for t in progress['tasks']
            ],
        }

    # Gantt schedule summary for mobile
    gantt_data = compute_gantt_data(project_id)
    if gantt_data:
        gantt_tasks = []
        for row in gantt_data.get('rows', []):
            planned_count = len(row.get('planned_days', []))
            actual_count = len(row.get('actual_days', []))
            forecast_count = len(row.get('forecast_days', []))
            total_bars = planned_count or 1
            pct_c = round(actual_count / total_bars * 100) if total_bars > 0 else 0
            gantt_tasks.append({
                'label': row['label'],
                'pct_complete': min(pct_c, 100),
                'variance_days': row.get('variance_days'),
            })
        data['gantt'] = {
            'target_finish': gantt_data.get('target_finish'),
            'est_finish': gantt_data.get('est_finish'),
            'variance_days': gantt_data.get('variance_days'),
            'tasks': gantt_tasks,
        }

    productivity = compute_material_productivity(project_id)
    if productivity:
        data['productivity'] = productivity

    if user.role == 'admin':
        data['planned_crew'] = project.planned_crew
        data['state'] = project.state
        data['is_cfmeu'] = project.is_cfmeu

    return data, 200


@api_data_bp.route('/projects/<int:project_id>/costs', methods=['GET'])
@jwt_required()
def get_project_costs(project_id):
    user, err = _get_user()
    if err:
        return err

    project = Project.query.get(project_id)
    if not project:
        return {'error': 'Project not found'}, 404

    allowed_ids = _accessible_ids(user)
    if not _has_project_access(user, project_id, allowed_ids):
        return {'error': 'Access denied'}, 403

    # ── Daily cost rate (mirrors web project dashboard) ──────────────────────
    all_roles = Role.query.order_by(Role.name).all()
    role_rate_map = {r.name: (r.delay_rate or 0) for r in all_roles}
    hours_pd = project.hours_per_day or 8
    budgeted_roles = ProjectBudgetedRole.query.filter_by(project_id=project_id).all()
    labour_daily = sum(
        br.budgeted_count * role_rate_map.get(br.role_name, 0) * hours_pd
        for br in budgeted_roles
    )
    hired_machines_list = HiredMachine.query.filter_by(project_id=project_id, active=True).all()
    hired_machine_daily = sum(
        (hm.cost_per_week / (6 if hm.count_saturdays else 5))
        for hm in hired_machines_list if hm.cost_per_week
    )
    owned_assignments = (ProjectMachine.query.filter_by(project_id=project_id)
                         .join(Machine).filter(Machine.active == True).all())
    owned_machine_daily = sum(
        pm.machine.delay_rate * hours_pd
        for pm in owned_assignments if pm.machine and pm.machine.delay_rate
    )
    daily_cost = labour_daily + hired_machine_daily + owned_machine_daily
    target_cost = (round(daily_cost * project.quoted_days, 2)
                   if project.quoted_days and daily_cost > 0 else None)

    # ── Forecast cost (uses gantt est_finish) ────────────────────────────────
    gantt_data = compute_gantt_data(project_id)
    est_finish_date = None
    if gantt_data and gantt_data.get('est_finish'):
        try:
            from datetime import datetime as _dt
            est_finish_date = _dt.strptime(gantt_data['est_finish'], '%d/%m/%Y').date()
        except Exception:
            pass

    forecast_cost = None
    forecast_working_days = None
    if est_finish_date and project.start_date and daily_cost > 0:
        non_work_dates = ProjectNonWorkDate.query.filter_by(project_id=project_id).all()
        holiday_dates = set()
        if project.state:
            for h in PublicHoliday.query.all():
                if project.state in h.states_list():
                    holiday_dates.add(h.date)
            if project.is_cfmeu:
                for c in CFMEUDate.query.all():
                    if 'ALL' in c.states_list() or project.state in c.states_list():
                        holiday_dates.add(c.date)
        non_work_set = {nwd.date for nwd in non_work_dates} | holiday_dates
        forecast_working_days = sum(
            1 for i in range((est_finish_date - project.start_date).days + 1)
            if (project.start_date + timedelta(days=i)).weekday() != 6
            and (project.start_date + timedelta(days=i)) not in non_work_set
        )
        forecast_cost = round(daily_cost * forecast_working_days, 2)

    cost_variance = (round(forecast_cost - target_cost, 2)
                     if forecast_cost is not None and target_cost is not None else None)

    # ── Schedule variance (days) ─────────────────────────────────────────────
    variance_days = gantt_data.get('variance_days') if gantt_data else None
    est_finish = gantt_data.get('est_finish') if gantt_data else None      # 'DD/MM/YYYY'
    target_finish = gantt_data.get('target_finish') if gantt_data else None  # 'DD/MM/YYYY'

    return {
        'has_rates': daily_cost > 0,
        'daily_cost': round(daily_cost, 2),
        'target_cost': target_cost,
        'forecast_cost': forecast_cost,
        'cost_variance': cost_variance,
        'forecast_working_days': forecast_working_days,
        'variance_days': variance_days,
        'est_finish': est_finish,
        'target_finish': target_finish,
    }, 200


# ─────────────────────────────────────────────────────────────────────────────
# DAILY ENTRIES
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/entries', methods=['GET'])
@jwt_required()
def get_entries():
    user, err = _get_user()
    if err:
        return err

    allowed_ids = _accessible_ids(user)
    project_id = request.args.get('project_id', type=int)
    date_from_str = request.args.get('date_from', '').strip()
    date_to_str = request.args.get('date_to', '').strip()
    lot_number = request.args.get('lot_number', '').strip() or None
    material = request.args.get('material', '').strip() or None
    page = max(1, request.args.get('page', 1, type=int))
    per_page = min(100, max(1, request.args.get('per_page', 20, type=int)))

    query = DailyEntry.query.order_by(
        DailyEntry.entry_date.desc(), DailyEntry.created_at.desc()
    )

    if allowed_ids is not None:
        if project_id:
            if project_id not in allowed_ids:
                return {'error': 'Access denied'}, 403
            query = query.filter(DailyEntry.project_id == project_id)
        else:
            query = query.filter(DailyEntry.project_id.in_(allowed_ids))
    elif project_id:
        query = query.filter(DailyEntry.project_id == project_id)

    if date_from_str:
        try:
            query = query.filter(
                DailyEntry.entry_date >= datetime.strptime(date_from_str, '%Y-%m-%d').date()
            )
        except ValueError:
            return {'error': 'Invalid date_from. Use YYYY-MM-DD.'}, 400

    if date_to_str:
        try:
            query = query.filter(
                DailyEntry.entry_date <= datetime.strptime(date_to_str, '%Y-%m-%d').date()
            )
        except ValueError:
            return {'error': 'Invalid date_to. Use YYYY-MM-DD.'}, 400

    if lot_number:
        query = query.filter(DailyEntry.lot_number == lot_number)

    if material:
        query = query.filter(DailyEntry.material == material)

    total = query.count()
    entries = query.offset((page - 1) * per_page).limit(per_page).all()

    return {
        'entries': [_format_entry(e) for e in entries],
        'total': total,
        'page': page,
        'pages': (total + per_page - 1) // per_page,
        'per_page': per_page,
    }, 200


@api_data_bp.route('/entries/<int:entry_id>', methods=['GET'])
@jwt_required()
def get_entry(entry_id):
    user, err = _get_user()
    if err:
        return err

    entry = DailyEntry.query.get(entry_id)
    if not entry:
        return {'error': 'Entry not found'}, 404

    allowed_ids = _accessible_ids(user)
    if not _has_project_access(user, entry.project_id, allowed_ids):
        return {'error': 'Access denied'}, 403

    return _format_entry(entry, include_detail=True), 200


@api_data_bp.route('/entries', methods=['POST'])
@jwt_required()
def create_entry():
    user, err = _get_user()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    project_id = data.get('project_id')
    entry_date_str = (data.get('entry_date') or '').strip()

    if not project_id or not entry_date_str:
        return {'error': 'project_id and entry_date are required'}, 400

    try:
        entry_date = datetime.strptime(entry_date_str, '%Y-%m-%d').date()
    except ValueError:
        return {'error': 'Invalid entry_date. Use YYYY-MM-DD.'}, 400

    allowed_ids = _accessible_ids(user)
    if not _has_project_access(user, int(project_id), allowed_ids):
        return {'error': 'Access denied'}, 403

    if not Project.query.get(int(project_id)):
        return {'error': 'Project not found'}, 404

    local_id = (data.get('local_id') or '').strip() or None
    if local_id:
        existing = DailyEntry.query.filter_by(local_id=local_id).first()
        if existing:
            return {'error': 'duplicate', 'entry_id': existing.id}, 409

    delay_hours = float(data.get('delay_hours') or 0)

    entry = DailyEntry(
        project_id=int(project_id),
        entry_date=entry_date,
        lot_number=data.get('lot_number') or None,
        location=data.get('location') or None,
        material=data.get('material') or None,
        num_people=int(data['num_people']) if data.get('num_people') is not None else None,
        install_hours=float(data.get('install_hours') or 0),
        install_sqm=float(data.get('install_sqm') or 0),
        delay_hours=delay_hours,
        delay_billable=bool(data.get('delay_billable', True)),
        delay_reason=(data.get('delay_reason') or None) if delay_hours > 0 else None,
        delay_description=data.get('delay_description') or None,
        machines_stood_down=bool(data.get('machines_stood_down', False)),
        weather=data.get('weather') or None,
        notes=data.get('notes') or None,
        other_work_description=data.get('other_work_description') or None,
        user_id=user.id,
        local_id=local_id,
        form_opened_at=_parse_dt(data.get('form_opened_at')),
    )

    db.session.add(entry)
    db.session.flush()  # get entry.id before adding associations

    # ── Employee associations ─────────────────────────────────────────────
    employee_ids = data.get('employee_ids') or []
    if employee_ids:
        employees = Employee.query.filter(Employee.id.in_(employee_ids)).all()
        entry.employees = employees

    # ── Machine associations ──────────────────────────────────────────────
    machine_ids = data.get('machine_ids') or []
    if machine_ids:
        machines = Machine.query.filter(Machine.id.in_(machine_ids)).all()
        entry.machines = machines

    # ── Standdown hired machines ──────────────────────────────────────────
    standdown_ids = data.get('standdown_machine_ids') or []
    for hm_id in standdown_ids:
        sd = StandDown(
            hired_machine_id=hm_id,
            entry_id=entry.id,
            stand_down_date=entry_date,
            reason=data.get('delay_reason') or 'Wet Weather',
        )
        db.session.add(sd)

    # ── Production lines ───────────────────────────────────────────────
    prod_lines = data.get('production_lines') or []
    if prod_lines:
        total_sqm = 0
        total_hrs = 0
        for pl in prod_lines:
            sqm = float(pl.get('install_sqm') or 0)
            hrs = float(pl.get('install_hours') or 0)
            db.session.add(EntryProductionLine(
                entry_id=entry.id,
                lot_number=pl.get('lot_number') or None,
                material=pl.get('material') or None,
                activity_type=pl.get('activity_type') or 'deploy',
                install_hours=hrs,
                install_sqm=sqm,
                weld_metres=float(pl.get('weld_metres') or 0),
                employee_ids_json=pl.get('employee_ids_json') or None))
            total_sqm += sqm
            total_hrs += hrs
        entry.install_sqm = total_sqm
        entry.install_hours = total_hrs
        if prod_lines[0].get('lot_number'):
            entry.lot_number = prod_lines[0]['lot_number']
        if prod_lines[0].get('material'):
            entry.material = prod_lines[0]['material']

    # ── Delay lines ────────────────────────────────────────────────────
    delay_lines = data.get('delay_lines') or []
    for dl in delay_lines:
        db.session.add(EntryDelayLine(
            entry_id=entry.id,
            reason=dl.get('reason') or None,
            hours=float(dl.get('hours') or 0),
            description=dl.get('description') or None))

    # ── Variation lines ────────────────────────────────────────────────
    var_lines = data.get('variation_lines') or []
    for vl in var_lines:
        db.session.add(EntryVariationLine(
            entry_id=entry.id,
            variation_number=vl.get('variation_number') or None,
            description=vl.get('description') or None,
            hours=float(vl.get('hours') or 0),
            employee_ids_json=vl.get('employee_ids_json') or None,
            machine_ids_json=vl.get('machine_ids_json') or None))

    # ── Other activity lines ──────────────────────────────────────────
    other_lines = data.get('other_activity_lines') or []
    for ol in other_lines:
        db.session.add(EntryOtherActivityLine(
            entry_id=entry.id,
            description=ol.get('description') or None,
            hours=float(ol.get('hours') or 0),
            employee_ids_json=ol.get('employee_ids_json') or None))

    # ── Own delays ─────────────────────────────────────────────────────
    if 'own_delay_hours' in data:
        entry.own_delay_hours = float(data.get('own_delay_hours') or 0)
    if 'own_delay_description' in data:
        entry.own_delay_description = data.get('own_delay_description') or None

    db.session.commit()

    return _format_entry(entry, include_detail=True), 201


@api_data_bp.route('/entries/<int:entry_id>', methods=['PATCH'])
@jwt_required()
def update_entry(entry_id):
    user, err = _get_user()
    if err:
        return err

    entry = DailyEntry.query.get(entry_id)
    if not entry:
        return {'error': 'Entry not found'}, 404

    allowed_ids = _accessible_ids(user)
    if not _has_project_access(user, entry.project_id, allowed_ids):
        return {'error': 'Access denied'}, 403

    if user.role == 'site' and entry.user_id != user.id:
        return {'error': 'You can only edit your own entries'}, 403

    data = request.get_json(silent=True) or {}

    def _str(k):
        return data[k] or None

    def _float(k, default=0):
        return float(data[k] or default)

    if 'lot_number' in data:
        entry.lot_number = _str('lot_number')
    if 'location' in data:
        entry.location = _str('location')
    if 'material' in data:
        entry.material = _str('material')
    if 'num_people' in data:
        entry.num_people = int(data['num_people']) if data['num_people'] is not None else None
    if 'install_hours' in data:
        entry.install_hours = _float('install_hours')
    if 'install_sqm' in data:
        entry.install_sqm = _float('install_sqm')
    if 'delay_hours' in data:
        entry.delay_hours = _float('delay_hours')
    if 'delay_billable' in data:
        entry.delay_billable = bool(data['delay_billable'])
    if 'delay_reason' in data:
        entry.delay_reason = _str('delay_reason')
    if 'delay_description' in data:
        entry.delay_description = _str('delay_description')
    if 'machines_stood_down' in data:
        entry.machines_stood_down = bool(data['machines_stood_down'])
    if 'weather' in data:
        entry.weather = _str('weather')
    if 'notes' in data:
        entry.notes = _str('notes')
    if 'other_work_description' in data:
        entry.other_work_description = _str('other_work_description')

    # Update many-to-many relationships
    if 'employee_ids' in data:
        emp_ids = data['employee_ids'] or []
        entry.employees = Employee.query.filter(Employee.id.in_(emp_ids)).all() if emp_ids else []
        entry.num_people = len(entry.employees) if entry.employees else entry.num_people

    if 'machine_ids' in data:
        mach_ids = data['machine_ids'] or []
        entry.machines = Machine.query.filter(Machine.id.in_(mach_ids)).all() if mach_ids else []

    if 'standdown_machine_ids' in data:
        sd_ids = data['standdown_machine_ids'] or []
        entry.machines_stood_down = len(sd_ids) > 0
        # Create stand-down records for newly selected hired machines
        if sd_ids and entry.delay_hours and entry.delay_hours > 0:
            sd_reason = entry.delay_description or entry.delay_reason or 'Delay'
            for hm_id in sd_ids:
                hm_obj = HiredMachine.query.get(int(hm_id))
                if hm_obj:
                    existing = StandDown.query.filter_by(
                        hired_machine_id=hm_obj.id, stand_down_date=entry.entry_date).first()
                    if not existing:
                        db.session.add(StandDown(
                            hired_machine_id=hm_obj.id,
                            entry_id=entry.id,
                            stand_down_date=entry.entry_date,
                            reason=sd_reason))

    # Production lines
    if 'production_lines' in data:
        EntryProductionLine.query.filter_by(entry_id=entry.id).delete()
        prod_lines = data['production_lines'] or []
        total_sqm = 0
        total_hrs = 0
        first_lot = None
        first_material = None
        for pl in prod_lines:
            sqm = float(pl.get('install_sqm') or 0)
            hrs = float(pl.get('install_hours') or 0)
            lot = pl.get('lot_number') or None
            mat = pl.get('material') or None
            db.session.add(EntryProductionLine(
                entry_id=entry.id, lot_number=lot, material=mat,
                activity_type=pl.get('activity_type') or 'deploy',
                install_hours=hrs, install_sqm=sqm,
                weld_metres=float(pl.get('weld_metres') or 0),
                employee_ids_json=pl.get('employee_ids_json') or None))
            total_sqm += sqm
            total_hrs += hrs
            if first_lot is None and lot:
                first_lot = lot
            if first_material is None and mat:
                first_material = mat
        entry.install_sqm = total_sqm
        entry.install_hours = total_hrs
        entry.lot_number = first_lot
        entry.material = first_material

    # Delay lines
    if 'delay_lines' in data:
        EntryDelayLine.query.filter_by(entry_id=entry.id).delete()
        for dl in (data['delay_lines'] or []):
            db.session.add(EntryDelayLine(
                entry_id=entry.id,
                reason=dl.get('reason') or None,
                hours=float(dl.get('hours') or 0),
                description=dl.get('description') or None))

    # Variation lines
    if 'variation_lines' in data:
        EntryVariationLine.query.filter_by(entry_id=entry.id).delete()
        for vl in (data['variation_lines'] or []):
            db.session.add(EntryVariationLine(
                entry_id=entry.id,
                variation_number=vl.get('variation_number') or None,
                description=vl.get('description') or None,
                hours=float(vl.get('hours') or 0),
                employee_ids_json=vl.get('employee_ids_json') or None,
                machine_ids_json=vl.get('machine_ids_json') or None))

    # Other activity lines
    if 'other_activity_lines' in data:
        EntryOtherActivityLine.query.filter_by(entry_id=entry.id).delete()
        for ol in (data['other_activity_lines'] or []):
            db.session.add(EntryOtherActivityLine(
                entry_id=entry.id,
                description=ol.get('description') or None,
                hours=float(ol.get('hours') or 0),
                employee_ids_json=ol.get('employee_ids_json') or None))

    # Own delays
    if 'own_delay_hours' in data:
        entry.own_delay_hours = float(data.get('own_delay_hours') or 0)
    if 'own_delay_description' in data:
        entry.own_delay_description = data.get('own_delay_description') or None

    entry.updated_at = datetime.utcnow()
    db.session.commit()

    return _format_entry(entry, include_detail=True), 200


@api_data_bp.route('/entries/<int:entry_id>', methods=['DELETE'])
@jwt_required()
def delete_entry(entry_id):
    user, err = _get_user()
    if err:
        return err

    if user.role != 'admin':
        return {'error': 'Only admins can delete entries'}, 403

    entry = DailyEntry.query.get(entry_id)
    if not entry:
        return {'error': 'Entry not found'}, 404

    allowed_ids = _accessible_ids(user)
    if not _has_project_access(user, entry.project_id, allowed_ids):
        return {'error': 'Access denied'}, 403

    # Remove associated photos from storage
    for photo in entry.photos:
        try:
            photo_path = os.path.join('uploads', photo.filename)
            if os.path.exists(photo_path):
                os.remove(photo_path)
        except Exception:
            pass

    db.session.delete(entry)
    db.session.commit()

    return {'message': 'Entry deleted'}, 200


# ─────────────────────────────────────────────────────────────────────────────
# EMPLOYEES
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/employees', methods=['GET'])
@jwt_required()
def get_employees():
    user, err = _get_user()
    if err:
        return err

    if user.role == 'admin':
        employees = Employee.query.filter_by(active=True).order_by(Employee.name).all()
    else:
        allowed_ids = _accessible_ids(user)
        if not allowed_ids:
            return {'employees': []}, 200
        assigned_emp_ids = {
            row.employee_id
            for row in (ProjectAssignment.query
                        .filter(ProjectAssignment.project_id.in_(allowed_ids))
                        .with_entities(ProjectAssignment.employee_id)
                        .distinct().all())
        }
        if not assigned_emp_ids:
            return {'employees': []}, 200
        employees = (Employee.query
                     .filter(Employee.id.in_(assigned_emp_ids), Employee.active == True)
                     .order_by(Employee.name).all())

    return {
        'employees': [
            {'id': e.id, 'name': e.name, 'role': e.role, 'active': e.active}
            for e in employees
        ]
    }, 200


# ─────────────────────────────────────────────────────────────────────────────
# EQUIPMENT (owned machines)
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/equipment', methods=['GET'])
@jwt_required()
def get_equipment():
    user, err = _get_user()
    if err:
        return err

    project_id_filter = request.args.get('project_id', type=int)
    allowed_ids = _accessible_ids(user)

    # Determine which project IDs to scope equipment to
    if project_id_filter and (allowed_ids is None or project_id_filter in allowed_ids):
        scope_ids = {project_id_filter}
    elif user.role == 'admin' and not project_id_filter:
        scope_ids = None  # admin with no filter sees everything
    else:
        scope_ids = allowed_ids

    if scope_ids is None:
        machines = Machine.query.filter_by(active=True).order_by(Machine.name).all()
    else:
        assigned_ids = {
            row.machine_id
            for row in (ProjectMachine.query
                        .filter(ProjectMachine.project_id.in_(scope_ids))
                        .with_entities(ProjectMachine.machine_id)
                        .distinct().all())
        }
        if not assigned_ids:
            return {'machines': []}, 200
        machines = (Machine.query
                    .filter(Machine.id.in_(assigned_ids), Machine.active == True)
                    .order_by(Machine.name).all())

    return {
        'machines': [
            {
                'id': m.id,
                'name': m.name,
                'type': m.machine_type,
                'active': m.active,
                'group_id': m.group_id,
                'group_name': m.group.name if m.group else None,
            }
            for m in machines
        ]
    }, 200


@api_data_bp.route('/equipment/breakdowns', methods=['GET'])
@jwt_required()
def get_breakdowns():
    user, err = _get_user()
    if err:
        return err

    project_id_filter = request.args.get('project_id', type=int)
    query = MachineBreakdown.query.order_by(MachineBreakdown.incident_date.desc())

    allowed_ids = _accessible_ids(user)
    if project_id_filter and (allowed_ids is None or project_id_filter in allowed_ids):
        scope_ids = {project_id_filter}
    elif user.role == 'admin' and not project_id_filter:
        scope_ids = None
    else:
        scope_ids = allowed_ids

    if scope_ids is not None:
        if not scope_ids:
            return {'breakdowns': []}, 200

        own_ids = {
            row.machine_id
            for row in (ProjectMachine.query
                        .filter(ProjectMachine.project_id.in_(scope_ids))
                        .with_entities(ProjectMachine.machine_id)
                        .distinct().all())
        }
        hired_ids = {
            row.id
            for row in (HiredMachine.query
                        .filter(HiredMachine.project_id.in_(scope_ids))
                        .with_entities(HiredMachine.id).all())
        }

        filters = []
        if own_ids:
            filters.append(MachineBreakdown.machine_id.in_(own_ids))
        if hired_ids:
            filters.append(MachineBreakdown.hired_machine_id.in_(hired_ids))
        if not filters:
            return {'breakdowns': []}, 200
        query = query.filter(db.or_(*filters))

    breakdowns = query.limit(50).all()

    def _machine_name(bd):
        if bd.machine:
            return bd.machine.name
        if bd.hired_machine:
            return bd.hired_machine.machine_name
        return None

    return {
        'breakdowns': [
            {
                'id': bd.id,
                'machine_id': bd.machine_id,
                'machine_name': _machine_name(bd),
                'date': bd.incident_date.isoformat() if bd.incident_date else None,
                'description': bd.description,
                'resolved': bd.repair_status == 'completed',
            }
            for bd in breakdowns
        ]
    }, 200


@api_data_bp.route('/equipment/breakdowns', methods=['POST'])
@jwt_required()
def create_breakdown():
    user, err = _get_user()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    machine_id = data.get('machine_id')
    breakdown_date_str = (data.get('breakdown_date') or '').strip()
    description = (data.get('description') or '').strip()

    if not machine_id or not breakdown_date_str or not description:
        return {'error': 'machine_id, breakdown_date, and description are required'}, 400

    try:
        breakdown_date = datetime.strptime(breakdown_date_str, '%Y-%m-%d').date()
    except ValueError:
        return {'error': 'Invalid breakdown_date. Use YYYY-MM-DD.'}, 400

    machine = Machine.query.get(int(machine_id))
    if not machine:
        return {'error': 'Machine not found'}, 404

    if user.role != 'admin':
        allowed_ids = _accessible_ids(user)
        accessible = ProjectMachine.query.filter(
            ProjectMachine.machine_id == machine.id,
            ProjectMachine.project_id.in_(allowed_ids)
        ).first()
        if not accessible:
            return {'error': 'Access denied'}, 403

    repair_status = data.get('repair_status', 'pending')
    if repair_status not in ('pending', 'in_progress', 'completed'):
        repair_status = 'pending'

    anticipated_return = None
    ar_str = (data.get('anticipated_return') or '').strip()
    if ar_str:
        try:
            anticipated_return = datetime.strptime(ar_str, '%Y-%m-%d').date()
        except ValueError:
            pass

    bd = MachineBreakdown(
        machine_id=machine.id,
        incident_date=breakdown_date,
        incident_time=(data.get('incident_time') or '').strip() or None,
        description=description,
        repairing_by=(data.get('repairing_by') or '').strip() or None,
        repair_status=repair_status,
        anticipated_return=anticipated_return,
    )
    db.session.add(bd)
    db.session.commit()

    return {
        'id': bd.id,
        'machine_id': bd.machine_id,
        'machine_name': machine.name,
        'date': bd.incident_date.isoformat(),
        'description': bd.description,
        'repair_status': bd.repair_status,
        'repairing_by': bd.repairing_by,
        'anticipated_return': bd.anticipated_return.isoformat() if bd.anticipated_return else None,
        'resolved': bd.repair_status == 'completed',
    }, 201


@api_data_bp.route('/equipment/<int:machine_id>', methods=['GET'])
@jwt_required()
def get_machine(machine_id):
    user, err = _get_user()
    if err:
        return err

    machine = Machine.query.get(machine_id)
    if not machine:
        return {'error': 'Machine not found'}, 404

    if user.role != 'admin':
        allowed_ids = _accessible_ids(user)
        accessible = ProjectMachine.query.filter(
            ProjectMachine.machine_id == machine.id,
            ProjectMachine.project_id.in_(allowed_ids or set())
        ).first()
        if not accessible:
            return {'error': 'Access denied'}, 403

    breakdowns = (MachineBreakdown.query
                  .filter_by(machine_id=machine_id)
                  .order_by(MachineBreakdown.incident_date.desc())
                  .all())

    return {
        'id': machine.id,
        'name': machine.name,
        'plant_id': machine.plant_id,
        'type': machine.machine_type,
        'description': machine.description,
        'delay_rate': machine.delay_rate,
        'active': machine.active,
        'breakdowns': [
            {
                'id': bd.id,
                'machine_id': bd.machine_id,
                'date': bd.incident_date.isoformat() if bd.incident_date else None,
                'incident_time': bd.incident_time,
                'description': bd.description,
                'repair_status': bd.repair_status or 'pending',
                'repairing_by': bd.repairing_by,
                'anticipated_return': bd.anticipated_return.isoformat() if bd.anticipated_return else None,
                'resolved_date': bd.resolved_date.isoformat() if bd.resolved_date else None,
                'photos': [
                    {
                        'id': p.id,
                        'url': url_for('api_data.serve_breakdown_photo_api', filename=p.filename, _external=True),
                        'filename': p.original_name or p.filename,
                    }
                    for p in bd.photos
                ],
            }
            for bd in breakdowns
        ],
    }, 200


@api_data_bp.route('/equipment/<int:machine_id>', methods=['PATCH'])
@jwt_required()
def update_machine(machine_id):
    user, err = _get_user()
    if err:
        return err

    if user.role not in ('admin', 'supervisor'):
        return {'error': 'Admin or supervisor access required'}, 403

    machine = Machine.query.get(machine_id)
    if not machine:
        return {'error': 'Machine not found'}, 404

    data = request.get_json(silent=True) or {}

    if 'name' in data:
        name = (data['name'] or '').strip()
        if not name:
            return {'error': 'Name cannot be empty'}, 400
        machine.name = name
    if 'plant_id' in data:
        machine.plant_id = (data['plant_id'] or '').strip() or None
    if 'type' in data:
        machine.machine_type = (data['type'] or '').strip() or None
    if 'description' in data:
        machine.description = (data['description'] or '').strip() or None
    if 'delay_rate' in data:
        try:
            machine.delay_rate = float(data['delay_rate']) if data['delay_rate'] not in (None, '') else None
        except (ValueError, TypeError):
            return {'error': 'Invalid delay_rate'}, 400

    db.session.commit()

    return {
        'id': machine.id,
        'name': machine.name,
        'plant_id': machine.plant_id,
        'type': machine.machine_type,
        'description': machine.description,
        'delay_rate': machine.delay_rate,
        'active': machine.active,
    }, 200


@api_data_bp.route('/equipment/breakdowns/<int:bd_id>', methods=['PATCH'])
@jwt_required()
def update_breakdown(bd_id):
    user, err = _get_user()
    if err:
        return err

    if user.role not in ('admin', 'supervisor'):
        return {'error': 'Admin or supervisor access required'}, 403

    bd = MachineBreakdown.query.get(bd_id)
    if not bd:
        return {'error': 'Breakdown not found'}, 404

    data = request.get_json(silent=True) or {}

    if 'repair_status' in data:
        status = data['repair_status']
        if status not in ('pending', 'in_progress', 'completed'):
            return {'error': 'Invalid repair_status'}, 400
        bd.repair_status = status
        if status == 'completed' and not bd.resolved_date:
            bd.resolved_date = date.today()
        elif status != 'completed':
            bd.resolved_date = None
    if 'repairing_by' in data:
        bd.repairing_by = (data['repairing_by'] or '').strip() or None
    if 'anticipated_return' in data:
        ar = (data['anticipated_return'] or '').strip()
        if ar:
            try:
                bd.anticipated_return = datetime.strptime(ar, '%Y-%m-%d').date()
            except ValueError:
                return {'error': 'Invalid anticipated_return. Use YYYY-MM-DD.'}, 400
        else:
            bd.anticipated_return = None
    if 'description' in data:
        desc = (data['description'] or '').strip()
        if desc:
            bd.description = desc

    db.session.commit()

    return {
        'id': bd.id,
        'machine_id': bd.machine_id,
        'date': bd.incident_date.isoformat() if bd.incident_date else None,
        'description': bd.description,
        'repair_status': bd.repair_status,
        'repairing_by': bd.repairing_by,
        'anticipated_return': bd.anticipated_return.isoformat() if bd.anticipated_return else None,
        'resolved_date': bd.resolved_date.isoformat() if bd.resolved_date else None,
    }, 200


@api_data_bp.route('/equipment/breakdowns/<int:bd_id>', methods=['DELETE'])
@jwt_required()
def delete_breakdown(bd_id):
    user, err = _get_user()
    if err:
        return err

    if user.role not in ('admin', 'supervisor'):
        return {'error': 'Admin or supervisor access required'}, 403

    bd = MachineBreakdown.query.get(bd_id)
    if not bd:
        return {'error': 'Breakdown not found'}, 404

    db.session.delete(bd)
    db.session.commit()
    return {}, 204


@api_data_bp.route('/equipment/breakdowns/<int:bd_id>/photos', methods=['POST'])
@jwt_required()
def upload_breakdown_photo(bd_id):
    user, err = _get_user()
    if err:
        return err

    bd = MachineBreakdown.query.get(bd_id)
    if not bd:
        return {'error': 'Breakdown not found'}, 404

    if 'photo' not in request.files:
        return {'error': 'No photo provided'}, 400

    photo = request.files['photo']
    if not photo or not photo.filename:
        return {'error': 'Invalid photo'}, 400

    if not allowed_photo(photo.filename):
        return {'error': 'File type not allowed'}, 400

    ext = photo.filename.rsplit('.', 1)[1].lower()
    stored_name = f"bd_{uuid.uuid4().hex}.{ext}"
    local_path = os.path.join(UPLOAD_FOLDER, 'breakdowns', stored_name)
    storage.upload_file(photo, f'breakdowns/{stored_name}', local_path)

    bp = BreakdownPhoto(
        breakdown_id=bd_id,
        filename=stored_name,
        original_name=secure_filename(photo.filename),
    )
    db.session.add(bp)
    db.session.commit()

    return {'id': bp.id, 'filename': stored_name}, 201


# ─────────────────────────────────────────────────────────────────────────────
# HIRED EQUIPMENT
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/hire', methods=['GET'])
@jwt_required()
def get_hire():
    user, err = _get_user()
    if err:
        return err

    project_id_filter = request.args.get('project_id', type=int)
    allowed_ids = _accessible_ids(user)

    if user.role == 'admin':
        q = HiredMachine.query
    else:
        if not allowed_ids:
            return {'hired_machines': []}, 200
        q = HiredMachine.query.filter(HiredMachine.project_id.in_(allowed_ids))

    if project_id_filter:
        if allowed_ids is not None and project_id_filter not in allowed_ids:
            return {'hired_machines': []}, 200
        q = q.filter(HiredMachine.project_id == project_id_filter)

    hired = q.order_by(HiredMachine.machine_name).all()

    return {
        'hired_machines': [
            {
                'id': hm.id,
                'machine_name': hm.machine_name,
                'machine_type': hm.machine_type,
                'hire_company': hm.hire_company,
                'plant_id': hm.plant_id,
                'delivery_date': hm.delivery_date.isoformat() if hm.delivery_date else None,
                'return_date': hm.return_date.isoformat() if hm.return_date else None,
                'cost_per_day': hm.cost_per_day,
                'cost_per_week': hm.cost_per_week,
                'project_id': hm.project_id,
                'project_name': hm.project.name if hm.project else None,
                'active': hm.active,
                'stand_downs': [
                    {
                        'id': sd.id,
                        'date': sd.stand_down_date.isoformat(),
                        'reason': sd.reason,
                    }
                    for sd in (hm.stand_downs or [])
                ],
            }
            for hm in hired
        ]
    }, 200


# ─────────────────────────────────────────────────────────────────────────────
# DOCUMENTS
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/documents/<int:doc_id>/file', methods=['GET'])
@jwt_required()
def download_document_api(doc_id):
    """Serve document file with JWT auth (for mobile in-app viewing).
    Accepts token via Authorization header OR ?token= query param."""
    user, err = _get_user()
    if err:
        return err

    doc = ProjectDocument.query.get(doc_id)
    if not doc:
        return {'error': 'Not found'}, 404

    allowed_ids = _accessible_ids(user)
    if allowed_ids is not None and doc.project_id not in allowed_ids:
        return {'error': 'Access denied'}, 403

    proj_upload_dir = os.path.join(UPLOAD_FOLDER, 'projects', str(doc.project_id))
    return storage.serve_file(
        f'docs/{doc.filename}',
        os.path.join(proj_upload_dir, doc.filename),
        as_attachment=False,
        download_name=doc.original_name or doc.filename,
    )


@api_data_bp.route('/documents', methods=['GET'])
@jwt_required()
def get_documents():
    user, err = _get_user()
    if err:
        return err

    allowed_ids = _accessible_ids(user)
    project_id = request.args.get('project_id', type=int)

    query = ProjectDocument.query.order_by(ProjectDocument.uploaded_at.desc())

    if allowed_ids is not None:
        if project_id:
            if project_id not in allowed_ids:
                return {'error': 'Access denied'}, 403
            query = query.filter(ProjectDocument.project_id == project_id)
        else:
            query = query.filter(ProjectDocument.project_id.in_(allowed_ids))
    elif project_id:
        query = query.filter(ProjectDocument.project_id == project_id)

    documents = query.all()

    return {
        'documents': [
            {
                'id': doc.id,
                'project_id': doc.project_id,
                'project_name': doc.project.name if doc.project else None,
                'filename': doc.original_name or doc.filename,
                'doc_type': doc.doc_type,
                'uploaded_at': doc.uploaded_at.date().isoformat() if doc.uploaded_at else None,
                'download_url': url_for(
                    'documents.project_document_download',
                    project_id=doc.project_id,
                    doc_id=doc.id,
                    _external=True,
                ),
            }
            for doc in documents
        ]
    }, 200


# ─────────────────────────────────────────────────────────────────────────────
# SCHEDULING / ROSTER
# ─────────────────────────────────────────────────────────────────────────────

def _build_employee_schedule(employee, date_list):
    """Return 14-day schedule list for a single employee."""
    grid = build_schedule_grid([employee], date_list)
    emp_grid = grid.get(employee.id, {})

    assignments = ProjectAssignment.query.filter(
        ProjectAssignment.employee_id == employee.id,
        ProjectAssignment.date_from <= date_list[-1],
        db.or_(
            ProjectAssignment.date_to.is_(None),
            ProjectAssignment.date_to >= date_list[0],
        )
    ).all()

    def _project_for_date(d):
        for a in assignments:
            if a.date_from <= d and (a.date_to is None or a.date_to >= d):
                return a.project
        return None

    schedule = []
    for d in date_list:
        ds = d.isoformat()
        cell = emp_grid.get(ds, {})
        status = cell.get('status', 'available')
        project_name = None
        if status == 'assigned':
            proj = _project_for_date(d)
            if proj:
                project_name = proj.name
        label = project_name if project_name else status.replace('_', ' ').title()
        schedule.append({
            'date': ds,
            'status': status,
            'project_name': project_name,
            'label': label,
        })
    return schedule


@api_data_bp.route('/roster/my', methods=['GET'])
@jwt_required()
def get_my_roster():
    user, err = _get_user()
    if err:
        return err

    if user.employee_id is None:
        return {'employee': None, 'schedule': [], 'no_employee': True}, 200

    employee = Employee.query.get(user.employee_id)
    if not employee:
        return {'employee': None, 'schedule': [], 'no_employee': True}, 200

    today = date.today()
    date_list = [today + timedelta(days=i) for i in range(14)]

    return {
        'employee': {'id': employee.id, 'name': employee.name},
        'schedule': _build_employee_schedule(employee, date_list),
    }, 200


@api_data_bp.route('/roster/team', methods=['GET'])
@jwt_required()
def get_team_roster():
    user, err = _get_user()
    if err:
        return err

    if user.role not in ('admin', 'supervisor'):
        return {'error': 'Admin or supervisor access required'}, 403

    # Optional start date — defaults to Monday of current week
    start_str = request.args.get('start')
    try:
        start = datetime.strptime(start_str, '%Y-%m-%d').date() if start_str else None
    except ValueError:
        start = None
    if start is None:
        today = date.today()
        start = today - timedelta(days=today.weekday())
    days = min(120, max(7, request.args.get('days', 28, type=int)))
    date_list = [start + timedelta(days=i) for i in range(days)]

    if user.role == 'admin':
        employees = (Employee.query
                     .filter_by(active=True)
                     .order_by(Employee.role, Employee.name)
                     .all())
    else:
        allowed_ids = _accessible_ids(user) or set()
        if allowed_ids:
            emp_ids = {a.employee_id for a in ProjectAssignment.query.filter(
                ProjectAssignment.project_id.in_(allowed_ids),
                ProjectAssignment.date_from <= date_list[-1],
                db.or_(ProjectAssignment.date_to.is_(None),
                       ProjectAssignment.date_to >= date_list[0])
            ).all()}
            employees = (Employee.query
                         .filter(Employee.id.in_(emp_ids), Employee.active == True)
                         .order_by(Employee.name)
                         .all()) if emp_ids else []
        else:
            employees = []

    raw_grid = build_schedule_grid(employees, date_list)
    grid_out = {}
    for emp_id, emp_dates in raw_grid.items():
        grid_out[str(emp_id)] = {}
        for ds, cell in emp_dates.items():
            grid_out[str(emp_id)][ds] = {
                'status': cell.get('status', 'available'),
                'label': cell.get('label', ''),
                'project_name': cell.get('project_name') or '',
                'override_id': cell.get('override_id'),
                'override_status': cell.get('override_status', ''),
                'project_id': cell.get('project_id'),
            }

    projects = Project.query.filter_by(active=True).order_by(Project.name).all()
    return {
        'employees': [{'id': emp.id, 'name': emp.name, 'role': emp.role or ''} for emp in employees],
        'dates': [d.isoformat() for d in date_list],
        'grid': grid_out,
        'projects': [{'id': p.id, 'name': p.name} for p in projects],
    }, 200


@api_data_bp.route('/scheduling/override', methods=['POST'])
@jwt_required()
def api_schedule_override():
    user, err = _get_user()
    if err:
        return err
    if user.role != 'admin':
        return {'error': 'Admin access required'}, 403

    data = request.get_json() or {}
    employee_id = data.get('employee_id')
    date_str = data.get('date', '')
    action = data.get('action', 'set')

    try:
        override_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return {'error': 'Invalid date'}, 400

    existing = ScheduleDayOverride.query.filter_by(
        employee_id=employee_id, date=override_date
    ).first()

    if action == 'clear':
        if existing:
            db.session.delete(existing)
            db.session.commit()
        return {}, 200

    status = data.get('status', 'available')
    project_id = data.get('project_id') or None
    notes = (data.get('notes') or '').strip() or None
    if existing:
        existing.status = status
        existing.project_id = project_id if status == 'project' else None
        existing.notes = notes
    else:
        db.session.add(ScheduleDayOverride(
            employee_id=employee_id,
            date=override_date,
            status=status,
            project_id=project_id if status == 'project' else None,
            notes=notes,
        ))
    db.session.commit()
    return {'ok': True}, 200


@api_data_bp.route('/scheduling/assign', methods=['POST'])
@jwt_required()
def api_scheduling_assign():
    user, err = _get_user()
    if err:
        return err
    if user.role != 'admin':
        return {'error': 'Admin access required'}, 403

    data = request.get_json() or {}
    employee_id = data.get('employee_id')
    project_id = data.get('project_id')
    date_from_str = (data.get('date_from') or '').strip()
    date_to_str = (data.get('date_to') or '').strip()
    notes = (data.get('notes') or '').strip() or None

    try:
        date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date() if date_to_str else None
    except ValueError:
        return {'error': 'Invalid date format'}, 400

    if not employee_id or not project_id:
        return {'error': 'employee_id and project_id required'}, 400

    pa = ProjectAssignment(
        employee_id=employee_id,
        project_id=project_id,
        date_from=date_from,
        date_to=date_to,
        notes=notes,
    )
    db.session.add(pa)
    db.session.commit()
    return {'id': pa.id}, 201


@api_data_bp.route('/scheduling/assign/<int:pa_id>', methods=['DELETE'])
@jwt_required()
def api_scheduling_assign_delete(pa_id):
    user, err = _get_user()
    if err:
        return err
    if user.role != 'admin':
        return {'error': 'Admin access required'}, 403
    pa = ProjectAssignment.query.get(pa_id)
    if not pa:
        return {'error': 'Not found'}, 404
    db.session.delete(pa)
    db.session.commit()
    return {}, 204


@api_data_bp.route('/scheduling/leave', methods=['POST'])
@jwt_required()
def api_scheduling_leave():
    user, err = _get_user()
    if err:
        return err
    if user.role != 'admin':
        return {'error': 'Admin access required'}, 403

    data = request.get_json() or {}
    employee_id = data.get('employee_id')
    date_from_str = (data.get('date_from') or '').strip()
    date_to_str = (data.get('date_to') or '').strip()
    leave_type = data.get('leave_type', 'annual')
    notes = (data.get('notes') or '').strip() or None

    try:
        date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
    except ValueError:
        return {'error': 'Invalid date format'}, 400

    if not employee_id:
        return {'error': 'employee_id required'}, 400

    lv = EmployeeLeave(
        employee_id=employee_id,
        date_from=date_from,
        date_to=date_to,
        leave_type=leave_type,
        notes=notes,
    )
    db.session.add(lv)
    db.session.commit()
    return {'id': lv.id}, 201


@api_data_bp.route('/scheduling/leave/<int:leave_id>', methods=['DELETE'])
@jwt_required()
def api_scheduling_leave_delete(leave_id):
    user, err = _get_user()
    if err:
        return err
    if user.role != 'admin':
        return {'error': 'Admin access required'}, 403
    lv = EmployeeLeave.query.get(leave_id)
    if not lv:
        return {'error': 'Not found'}, 404
    db.session.delete(lv)
    db.session.commit()
    return {}, 204


# ─────────────────────────────────────────────────────────────────────────────
# EMPLOYEES / MACHINES / HIRE
# ─────────────────────────────────────────────────────────────────────────────

def _active_employees(allowed_ids):
    """Return active employees, scoped to accessible projects for non-admin users."""
    if allowed_ids is None:
        return (Employee.query
                .filter_by(active=True)
                .order_by(Employee.role, Employee.name)
                .all())
    return (Employee.query
            .join(ProjectAssignment, ProjectAssignment.employee_id == Employee.id)
            .filter(
                Employee.active == True,
                ProjectAssignment.project_id.in_(allowed_ids),
            )
            .order_by(Employee.role, Employee.name)
            .distinct()
            .all())


def _active_hire(allowed_ids):
    """Return hired machines currently on site (delivery ≤ today ≤ return), scoped for non-admin."""
    today = date.today()
    query = HiredMachine.query.filter(
        HiredMachine.active == True,
        or_(HiredMachine.delivery_date == None, HiredMachine.delivery_date <= today),
        or_(HiredMachine.return_date == None,   HiredMachine.return_date >= today),
    )
    if allowed_ids is not None:
        query = query.filter(HiredMachine.project_id.in_(allowed_ids))
    return query.order_by(HiredMachine.machine_name).all()


@api_data_bp.route('/employees/active', methods=['GET'])
@jwt_required()
def get_active_employees():
    user, err = _get_user()
    if err:
        return err

    employees = _active_employees(_accessible_ids(user))
    return {
        'employees': [
            {'id': e.id, 'name': e.name, 'role': e.role or ''}
            for e in employees
        ]
    }, 200


@api_data_bp.route('/machines/active', methods=['GET'])
@jwt_required()
def get_active_machines():
    user, err = _get_user()
    if err:
        return err

    machines = Machine.query.filter_by(active=True).order_by(Machine.name).all()
    return {
        'machines': [
            {'id': m.id, 'name': m.name, 'type': m.machine_type or ''}
            for m in machines
        ]
    }, 200


@api_data_bp.route('/hire/active', methods=['GET'])
@jwt_required()
def get_active_hire():
    user, err = _get_user()
    if err:
        return err

    hired = _active_hire(_accessible_ids(user))
    return {
        'hired_machines': [
            {'id': h.id, 'machine_name': h.machine_name, 'hire_company': h.hire_company or ''}
            for h in hired
        ]
    }, 200


# ─────────────────────────────────────────────────────────────────────────────
# REFERENCE DATA
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/reference', methods=['GET'])
@jwt_required()
def get_reference():
    user, err = _get_user()
    if err:
        return err

    allowed_ids = _accessible_ids(user)

    # Scope everything to the requested project when provided
    prog_pid = request.args.get('project_id', type=int)
    if prog_pid and not (allowed_ids is None or prog_pid in allowed_ids):
        prog_pid = None  # caller doesn't have access to that project

    planned_q = PlannedData.query
    if prog_pid:
        planned_q = planned_q.filter(PlannedData.project_id == prog_pid)
    elif allowed_ids is not None:
        planned_q = planned_q.filter(PlannedData.project_id.in_(allowed_ids))
    planned_rows = planned_q.all()

    # If the specific project has no planned data, fall back to all accessible projects
    # so the lot/material dropdowns still populate from related projects
    if prog_pid and not planned_rows:
        fallback_q = PlannedData.query
        if allowed_ids is not None:
            fallback_q = fallback_q.filter(PlannedData.project_id.in_(allowed_ids))
        planned_rows = fallback_q.all()

    def _lot_sort_key(s):
        try:
            return (0, int(s), s)
        except (ValueError, TypeError):
            return (1, 0, s)

    lots = sorted({r.lot for r in planned_rows if r.lot}, key=_lot_sort_key)
    materials = sorted({r.material for r in planned_rows if r.material})

    lot_materials_raw: dict = {}
    for r in planned_rows:
        if r.lot and r.material:
            lot_materials_raw.setdefault(r.lot, set()).add(r.material)
    lot_materials = {lot: sorted(mats) for lot, mats in lot_materials_raw.items()}

    # ── Lot+material progress ─────────────────────────────────────────────────

    planned_totals: dict = {}
    for r in planned_rows:
        if prog_pid and r.project_id != prog_pid:
            continue
        if r.lot and r.material and r.planned_sqm:
            planned_totals.setdefault(r.lot, {}).setdefault(r.material, 0.0)
            planned_totals[r.lot][r.material] += r.planned_sqm

    lot_progress: dict = {}
    if planned_totals:
        # Query production lines for accurate per-lot/material actuals
        plq = (db.session.query(
            EntryProductionLine.lot_number,
            EntryProductionLine.material,
            db.func.sum(EntryProductionLine.install_sqm).label('actual'),
        ).join(DailyEntry, EntryProductionLine.entry_id == DailyEntry.id)
        .filter(
            EntryProductionLine.lot_number.isnot(None),
            EntryProductionLine.material.isnot(None),
        ))
        if prog_pid:
            plq = plq.filter(DailyEntry.project_id == prog_pid)
        elif allowed_ids is not None:
            plq = plq.filter(DailyEntry.project_id.in_(allowed_ids))
        actuals_from_lines = {
            (r.lot_number, r.material): float(r.actual or 0)
            for r in plq.group_by(EntryProductionLine.lot_number, EntryProductionLine.material).all()
        }

        # Also query legacy entries (no production lines) for backward compat
        legacy_q = (db.session.query(
            DailyEntry.lot_number,
            DailyEntry.material,
            db.func.sum(DailyEntry.install_sqm).label('actual'),
        ).filter(
            DailyEntry.lot_number.isnot(None),
            DailyEntry.material.isnot(None),
            DailyEntry.install_sqm.isnot(None),
            ~DailyEntry.id.in_(
                db.session.query(EntryProductionLine.entry_id).distinct()
            ),
        ))
        if prog_pid:
            legacy_q = legacy_q.filter(DailyEntry.project_id == prog_pid)
        elif allowed_ids is not None:
            legacy_q = legacy_q.filter(DailyEntry.project_id.in_(allowed_ids))
        actuals_legacy = {
            (r.lot_number, r.material): float(r.actual or 0)
            for r in legacy_q.group_by(DailyEntry.lot_number, DailyEntry.material).all()
        }

        # Merge both sources
        actuals = {}
        for key, val in actuals_from_lines.items():
            actuals[key] = actuals.get(key, 0) + val
        for key, val in actuals_legacy.items():
            actuals[key] = actuals.get(key, 0) + val
        for lot, mats in planned_totals.items():
            lot_progress[lot] = {}
            for mat, planned_sqm in mats.items():
                actual_sqm = actuals.get((lot, mat), 0.0)
                remaining_sqm = max(0.0, planned_sqm - actual_sqm)
                pct = round(actual_sqm / planned_sqm * 100, 1) if planned_sqm > 0 else 0.0
                lot_progress[lot][mat] = {
                    'planned_sqm': round(planned_sqm, 1),
                    'actual_sqm': round(actual_sqm, 1),
                    'remaining_sqm': round(remaining_sqm, 1),
                    'pct_complete': pct,
                }

    roles = [r.name for r in Role.query.order_by(Role.name).all()]
    projects = user.accessible_projects()

    # Scope employees, machines, hired machines to the active project if provided,
    # falling back to all accessible projects if the scoped query returns nothing.
    if prog_pid:
        employees = _active_employees({prog_pid})
        if not employees:
            employees = _active_employees(allowed_ids)

        assigned_machine_ids = {
            row.machine_id
            for row in (ProjectMachine.query
                        .filter_by(project_id=prog_pid)
                        .with_entities(ProjectMachine.machine_id).all())
        }
        machines = (Machine.query
                    .filter(Machine.id.in_(assigned_machine_ids), Machine.active == True)
                    .order_by(Machine.name).all()) if assigned_machine_ids else []
        if not machines:
            machines = Machine.query.filter_by(active=True).order_by(Machine.name).all()

        hired = _active_hire({prog_pid})
        if not hired:
            hired = _active_hire(allowed_ids)
    else:
        employees = _active_employees(allowed_ids)
        machines = Machine.query.filter_by(active=True).order_by(Machine.name).all()
        hired = _active_hire(allowed_ids)

    return {
        'lots': lots,
        'materials': materials,
        'lot_materials': lot_materials,
        'lot_progress': lot_progress,
        'roles': roles,
        'projects': [_project_base(p) for p in projects],
        'employees': [
            {'id': e.id, 'name': e.name, 'role': e.role or ''}
            for e in employees
        ],
        'machines': [
            {'id': m.id, 'name': m.name, 'type': m.machine_type or '',
             'group_id': m.group_id, 'group_name': m.group.name if m.group else None}
            for m in machines
        ],
        'hired_machines': [
            {'id': h.id, 'machine_name': h.machine_name, 'hire_company': h.hire_company or ''}
            for h in hired
        ],
        'machine_groups': [
            {'id': g.id, 'name': g.name, 'delay_rate': g.delay_rate,
             'machine_ids': [m.id for m in g.machines if m.active]}
            for g in MachineGroup.query.filter_by(active=True).order_by(MachineGroup.name).all()
        ],
    }, 200


# ─────────────────────────────────────────────────────────────────────────────
# SYNC (offline → online)
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/sync', methods=['POST'])
@jwt_required()
def sync():
    user, err = _get_user()
    if err:
        return err

    data = request.get_json(silent=True)
    if data is None:
        return {'success': False, 'error': 'Invalid request body'}, 400

    entries_in    = data.get('entries')    or []
    breakdowns_in = data.get('breakdowns') or []

    allowed_ids = _accessible_ids(user)

    entry_details     = []
    breakdown_details = []
    # (obj, detail_dict) pairs — server_id filled in after commit
    pending_entries    = []
    pending_breakdowns = []

    try:
        # ── Entries ──────────────────────────────────────────────────────────
        for item in entries_in:
            local_id = (item.get('local_id') or '').strip() or None

            # 1. Duplicate check
            if local_id:
                existing = DailyEntry.query.filter_by(local_id=local_id).first()
                if existing:
                    entry_details.append({
                        'local_id': local_id,
                        'status': 'skipped',
                        'reason': 'duplicate',
                        'server_id': existing.id,
                    })
                    continue

            # 2a. Project exists
            project_id = item.get('project_id')
            if not project_id:
                entry_details.append({
                    'local_id': local_id,
                    'status': 'failed',
                    'reason': 'project access denied',
                })
                continue

            project = Project.query.get(int(project_id))
            if not project:
                entry_details.append({
                    'local_id': local_id,
                    'status': 'failed',
                    'reason': 'project not found',
                })
                continue

            # 2b. Non-admin access check
            if allowed_ids is not None and int(project_id) not in allowed_ids:
                entry_details.append({
                    'local_id': local_id,
                    'status': 'failed',
                    'reason': 'project access denied',
                })
                continue

            # 3. Date validation
            try:
                entry_date = datetime.strptime(
                    (item.get('entry_date') or '').strip(), '%Y-%m-%d'
                ).date()
            except ValueError:
                entry_details.append({
                    'local_id': local_id,
                    'status': 'failed',
                    'reason': 'invalid date',
                })
                continue

            # 4. Create
            delay_hours = float(item.get('delay_hours') or 0)
            entry = DailyEntry(
                project_id=int(project_id),
                entry_date=entry_date,
                lot_number=item.get('lot_number') or None,
                location=item.get('location') or None,
                material=item.get('material') or None,
                num_people=(
                    int(item['num_people'])
                    if item.get('num_people') is not None else None
                ),
                install_hours=float(item.get('install_hours') or 0),
                install_sqm=float(item.get('install_sqm') or 0),
                delay_hours=delay_hours,
                delay_billable=bool(item.get('delay_billable', True)),
                delay_reason=(
                    (item.get('delay_reason') or None) if delay_hours > 0 else None
                ),
                delay_description=item.get('delay_description') or None,
                machines_stood_down=bool(item.get('machines_stood_down', False)),
                weather=item.get('weather') or None,
                notes=item.get('notes') or None,
                other_work_description=item.get('other_work_description') or None,
                user_id=user.id,
                local_id=local_id,
                form_opened_at=_parse_dt(item.get('form_opened_at')),
            )
            db.session.add(entry)
            detail = {'local_id': local_id, 'status': 'created', 'server_id': None}
            entry_details.append(detail)
            pending_entries.append((entry, detail))

        # ── Breakdowns ───────────────────────────────────────────────────────
        for item in breakdowns_in:
            local_id = (item.get('local_id') or '').strip() or None

            # 1. local_id is required
            if not local_id:
                breakdown_details.append({
                    'local_id': None,
                    'status': 'failed',
                    'reason': 'local_id is required',
                })
                continue

            # 2. Duplicate check
            existing = MachineBreakdown.query.filter_by(local_id=local_id).first()
            if existing:
                breakdown_details.append({
                    'local_id': local_id,
                    'status': 'skipped',
                    'reason': 'duplicate',
                    'server_id': existing.id,
                })
                continue

            # 3. Machine exists
            machine_id = item.get('machine_id')
            machine = Machine.query.get(int(machine_id)) if machine_id else None
            if not machine:
                breakdown_details.append({
                    'local_id': local_id,
                    'status': 'failed',
                    'reason': 'machine not found',
                })
                continue

            # 4. Date validation
            try:
                breakdown_date = datetime.strptime(
                    (item.get('breakdown_date') or '').strip(), '%Y-%m-%d'
                ).date()
            except ValueError:
                breakdown_details.append({
                    'local_id': local_id,
                    'status': 'failed',
                    'reason': 'invalid date',
                })
                continue

            # 5. Build description, appending resolution_notes if provided
            description = (item.get('description') or '').strip()
            resolution_notes = (item.get('resolution_notes') or '').strip()
            if resolution_notes:
                description = description + '\nResolution: ' + resolution_notes

            # 6. Create
            bd = MachineBreakdown(
                machine_id=machine.id,
                incident_date=breakdown_date,
                description=description,
                repair_status='completed' if item.get('resolved') else 'pending',
                local_id=local_id,
            )
            db.session.add(bd)
            detail = {'local_id': local_id, 'status': 'created', 'server_id': None}
            breakdown_details.append(detail)
            pending_breakdowns.append((bd, detail))

        # Single commit for all new records
        db.session.commit()

        # Fill in server-assigned IDs now that the commit has flushed them
        for obj, detail in pending_entries:
            detail['server_id'] = obj.id
        for obj, detail in pending_breakdowns:
            detail['server_id'] = obj.id

    except Exception as e:
        db.session.rollback()
        return {'success': False, 'error': 'Sync failed', 'detail': str(e)}, 500

    def _summary(received, details):
        return {
            'received': received,
            'created': sum(1 for d in details if d['status'] == 'created'),
            'skipped': sum(1 for d in details if d['status'] == 'skipped'),
            'failed':  sum(1 for d in details if d['status'] == 'failed'),
            'details': details,
        }

    return {
        'success': True,
        'entries':    _summary(len(entries_in),    entry_details),
        'breakdowns': _summary(len(breakdowns_in), breakdown_details),
        'synced_at':  datetime.utcnow().isoformat(),
    }, 200


# ─────────────────────────────────────────────────────────────────────────────
# PDF REPORT ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/reports/project/<int:project_id>/progress', methods=['GET'])
@jwt_required()
def report_project_progress(project_id):
    user, err = _get_user()
    if err:
        return err

    if user.role == 'site':
        return {'error': 'Access denied'}, 403

    allowed_ids = _accessible_ids(user)
    if not _has_project_access(user, project_id, allowed_ids):
        return {'error': 'Access denied'}, 403

    project = Project.query.get(project_id)
    if not project:
        return {'error': 'Project not found'}, 404

    date_from_str = request.args.get('date_from', '').strip()
    date_to_str = request.args.get('date_to', '').strip()
    date_from = None
    date_to = None
    if date_from_str:
        try:
            date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        except ValueError:
            return {'error': 'Invalid date_from. Use YYYY-MM-DD.'}, 400
    if date_to_str:
        try:
            date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
        except ValueError:
            return {'error': 'Invalid date_to. Use YYYY-MM-DD.'}, 400

    progress = compute_project_progress(project_id)
    delay_summary = compute_delay_summary(project_id)
    gantt_data = compute_gantt_data(project_id)
    settings = load_settings()

    try:
        pdf_bytes = generate_project_report_pdf(
            project=project,
            progress=progress,
            delay_summary=delay_summary,
            cost_estimate=None,
            settings=settings,
            date_from=date_from,
            date_to=date_to,
            gantt_data=gantt_data,
        )
    except Exception as e:
        return {'error': 'PDF generation failed', 'detail': str(e)}, 500

    filename = f"{project.name} Progress Report.pdf"
    response = make_response(pdf_bytes)
    response.headers['Content-Type'] = 'application/pdf'
    response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


@api_data_bp.route('/reports/project/<int:project_id>/weekly', methods=['GET'])
@jwt_required()
def report_project_weekly(project_id):
    user, err = _get_user()
    if err:
        return err

    if user.role == 'site':
        return {'error': 'Access denied'}, 403

    allowed_ids = _accessible_ids(user)
    if not _has_project_access(user, project_id, allowed_ids):
        return {'error': 'Access denied'}, 403

    project = Project.query.get(project_id)
    if not project:
        return {'error': 'Project not found'}, 404

    week_start_str = request.args.get('week_start', '').strip()
    week_end_str = request.args.get('week_end', '').strip()
    if not week_start_str or not week_end_str:
        return {'error': 'week_start and week_end are required'}, 400
    try:
        week_start = datetime.strptime(week_start_str, '%Y-%m-%d').date()
        week_end = datetime.strptime(week_end_str, '%Y-%m-%d').date()
    except ValueError:
        return {'error': 'Invalid date. Use YYYY-MM-DD.'}, 400

    entries = (DailyEntry.query
               .filter_by(project_id=project_id)
               .filter(DailyEntry.entry_date >= week_start)
               .filter(DailyEntry.entry_date <= week_end)
               .order_by(DailyEntry.entry_date)
               .all())

    settings = load_settings()

    try:
        pdf_bytes = generate_weekly_report_pdf(project, week_start, week_end, entries, settings)
    except Exception as e:
        return {'error': 'PDF generation failed', 'detail': str(e)}, 500

    filename = f"{project.name} Weekly {week_start_str}.pdf"
    response = make_response(pdf_bytes)
    response.headers['Content-Type'] = 'application/pdf'
    response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


@api_data_bp.route('/reports/delays', methods=['GET'])
@jwt_required()
def report_delays():
    user, err = _get_user()
    if err:
        return err

    if user.role == 'site':
        return {'error': 'Access denied'}, 403

    project_id = request.args.get('project_id', '').strip()
    billable_filter = request.args.get('billable_filter', 'all').strip()

    if project_id:
        try:
            project_id_int = int(project_id)
        except ValueError:
            return {'error': 'Invalid project_id'}, 400
        allowed_ids = _accessible_ids(user)
        if not _has_project_access(user, project_id_int, allowed_ids):
            return {'error': 'Access denied'}, 403

    date_from_str = request.args.get('date_from', '').strip()
    date_to_str = request.args.get('date_to', '').strip()
    if not date_from_str or not date_to_str:
        return {'error': 'date_from and date_to are required'}, 400
    try:
        date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
    except ValueError:
        return {'error': 'Invalid date. Use YYYY-MM-DD.'}, 400

    project_name = ''
    if project_id:
        p = Project.query.get(int(project_id))
        project_name = p.name if p else ''

    rows, summary = build_delay_report(project_id, date_from, date_to, billable_filter)
    settings = load_settings()

    try:
        pdf_bytes = generate_delay_pdf(rows, summary, date_from, date_to, project_name, settings)
    except Exception as e:
        return {'error': 'PDF generation failed', 'detail': str(e)}, 500

    filename = f"Delay Report {date_from_str} to {date_to_str}.pdf"
    response = make_response(pdf_bytes)
    response.headers['Content-Type'] = 'application/pdf'
    response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


@api_data_bp.route('/reports/hire/<int:hired_machine_id>', methods=['GET'])
@jwt_required()
def report_hire(hired_machine_id):
    user, err = _get_user()
    if err:
        return err

    if user.role == 'site':
        return {'error': 'Access denied'}, 403

    hm = HiredMachine.query.get(hired_machine_id)
    if not hm:
        return {'error': 'Hired machine not found'}, 404

    allowed_ids = _accessible_ids(user)
    if not _has_project_access(user, hm.project_id, allowed_ids):
        return {'error': 'Access denied'}, 403

    date_from_str = request.args.get('date_from', '').strip()
    date_to_str = request.args.get('date_to', '').strip()
    if not date_from_str or not date_to_str:
        return {'error': 'date_from and date_to are required'}, 400
    try:
        date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
        date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
    except ValueError:
        return {'error': 'Invalid date. Use YYYY-MM-DD.'}, 400

    days, summary = build_day_summary(hm, date_from, date_to)
    settings = load_settings()

    try:
        pdf_bytes = generate_pdf(hm, date_from, date_to, days, summary, settings)
    except Exception as e:
        return {'error': 'PDF generation failed', 'detail': str(e)}, 500

    filename = f"{hm.machine_name} Standdown {date_from_str}.pdf"
    response = make_response(pdf_bytes)
    response.headers['Content-Type'] = 'application/pdf'
    response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


# ─────────────────────────────────────────────────────────────────────────────
# DEVICE TOKENS (push notifications)
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/device-token', methods=['POST'])
@jwt_required()
def register_device_token():
    user, err = _get_user()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    token = (data.get('token') or '').strip()
    platform = (data.get('platform') or '').strip()

    if not token or not platform:
        return {'error': 'token and platform are required'}, 400
    if platform not in ('ios', 'android'):
        return {'error': 'platform must be ios or android'}, 400

    existing = DeviceToken.query.filter_by(user_id=user.id, token=token).first()
    if existing:
        existing.updated_at = datetime.utcnow()
    else:
        db.session.add(DeviceToken(user_id=user.id, token=token, platform=platform))
    db.session.commit()

    return {'message': 'Device token registered'}, 200


@api_data_bp.route('/device-token', methods=['DELETE'])
@jwt_required()
def remove_device_token():
    user, err = _get_user()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    token = (data.get('token') or '').strip()

    device = DeviceToken.query.filter_by(user_id=user.id, token=token).first()
    if not device:
        return {'error': 'Device token not found'}, 404

    db.session.delete(device)
    db.session.commit()

    return {'message': 'Device token removed'}, 200


# ─────────────────────────────────────────────────────────────────────────────
# ADMIN — scheduled job endpoints
# In production, POST /api/admin/send-reminders should be called by a
# scheduled job (Railway cron job or similar) at 4pm every weekday.
# This will be configured after beta launch.
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/admin/send-reminders', methods=['POST'])
def send_reminders():
    # Allow cron jobs to authenticate with CRON_SECRET bearer token
    # NOTE: no @jwt_required decorator — it rejects non-JWT bearer tokens
    # before the function body runs, so we handle auth manually here.
    auth_header = request.headers.get('Authorization', '')
    cron_secret = os.environ.get('CRON_SECRET')
    is_cron = (
        cron_secret
        and auth_header.startswith('Bearer ')
        and auth_header[7:] == cron_secret
    )

    if not is_cron:
        # Fall back to JWT admin auth
        from flask_jwt_extended import verify_jwt_in_request
        try:
            verify_jwt_in_request()
        except Exception:
            return {'error': 'Invalid token'}, 401
        user, err = _get_user()
        if err:
            return err
        if user.role != 'admin':
            return {'error': 'Access denied'}, 403

    from utils.notifications import (send_entry_reminders, send_daily_check_reminders,
                                      send_checklist_reminders, send_transfer_reminders,
                                      send_expiry_alerts)
    entry_count = send_entry_reminders()
    check_count = send_daily_check_reminders()
    checklist_count = send_checklist_reminders()
    transfer_count = send_transfer_reminders()
    expiry_count = send_expiry_alerts()

    return {
        'message': 'Reminders sent',
        'entry_reminders': entry_count,
        'daily_check_reminders': check_count,
        'checklist_reminders': checklist_count,
        'transfer_reminders': transfer_count,
        'expiry_alerts': expiry_count,
    }, 200


@api_data_bp.route('/admin/send-travel-reminders', methods=['POST'])
def send_travel_reminders():
    """Send upcoming flight and accommodation check-in reminders (24h before).
    Should be called by a daily cron job."""
    auth_header = request.headers.get('Authorization', '')
    cron_secret = os.environ.get('CRON_SECRET')
    is_cron = (
        cron_secret
        and auth_header.startswith('Bearer ')
        and auth_header[7:] == cron_secret
    )

    if not is_cron:
        from flask_jwt_extended import verify_jwt_in_request
        try:
            verify_jwt_in_request()
        except Exception:
            return {'error': 'Invalid token'}, 401
        user, err = _get_user()
        if err:
            return err
        if user.role != 'admin':
            return {'error': 'Access denied'}, 403

    from utils.notifications import send_upcoming_flight_reminders, send_upcoming_checkin_reminders
    flight_count = send_upcoming_flight_reminders()
    accom_count = send_upcoming_checkin_reminders()

    return {'message': 'Travel reminders sent', 'flights': flight_count, 'accommodations': accom_count}, 200


@api_data_bp.route('/admin/beta-metrics', methods=['GET'])
@jwt_required()
def beta_metrics():
    user, err = _get_user()
    if err:
        return err
    if user.role != 'admin':
        return {'error': 'Admin only'}, 403

    total_entries = DailyEntry.query.count()

    timed = DailyEntry.query.filter(
        DailyEntry.form_opened_at.isnot(None),
        DailyEntry.created_at.isnot(None),
    ).all()

    # form_opened_at is sent as local time from the mobile app — using abs() to
    # handle timezone offset differences until the mobile app sends UTC.
    # TODO: update React Native app to send form_opened_at as UTC in Phase 3.
    completion_seconds = [
        abs((e.created_at - e.form_opened_at).total_seconds())
        for e in timed
    ]

    avg = (sum(completion_seconds) / len(completion_seconds)
           if completion_seconds else None)

    return {
        'total_entries': total_entries,
        'entries_with_timing': len(timed),
        'avg_completion_seconds': round(avg, 1) if avg is not None else None,
    }, 200


# ─────────────────────────────────────────────────────────────────────────────
# EQUIPMENT — extended API endpoints for mobile
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/equipment/machine/<int:machine_id>', methods=['GET'])
@jwt_required()
def equipment_machine_detail(machine_id):
    """Full machine detail including new fields, daily checks, checklists, transfers."""
    user, err = _get_user()
    if err:
        return err

    from models import (MachineTransfer, SiteEquipmentChecklistItem,
                        MachineDailyCheck)

    m = Machine.query.get(machine_id)
    if not m:
        return {'error': 'Machine not found'}, 404

    # Last 7 days of daily checks
    seven_days_ago = date.today() - timedelta(days=7)
    daily_checks = MachineDailyCheck.query.filter(
        MachineDailyCheck.machine_id == machine_id,
        MachineDailyCheck.check_date >= seven_days_ago,
    ).order_by(MachineDailyCheck.check_date.desc()).all()

    # Open checklist items
    open_checklist_items = SiteEquipmentChecklistItem.query.filter_by(
        machine_id=machine_id, checked=False).all()

    # Pending transfer
    pending_transfer = MachineTransfer.query.filter(
        MachineTransfer.machine_id == machine_id,
        MachineTransfer.status.in_(['scheduled', 'in_transit']),
    ).first()

    # Breakdowns
    breakdowns = MachineBreakdown.query.filter_by(machine_id=machine_id).order_by(
        MachineBreakdown.incident_date.desc()).all()

    return {
        'id': m.id,
        'name': m.name,
        'plant_id': m.plant_id,
        'type': m.machine_type,
        'description': m.description,
        'delay_rate': m.delay_rate,
        'active': m.active,
        'serial_number': m.serial_number,
        'manufacturer': m.manufacturer,
        'model_number': m.model_number,
        'acquired_date': m.acquired_date.isoformat() if m.acquired_date else None,
        'dispose_by_date': m.dispose_by_date.isoformat() if m.dispose_by_date else None,
        'next_inspection_date': m.next_inspection_date.isoformat() if m.next_inspection_date else None,
        'inspection_interval_days': m.inspection_interval_days,
        'storage_instructions': m.storage_instructions,
        'service_instructions': m.service_instructions,
        'spare_parts_notes': m.spare_parts_notes,
        'disposal_procedure': m.disposal_procedure,
        'breakdowns': [{
            'id': b.id,
            'date': b.incident_date.isoformat() if b.incident_date else None,
            'incident_time': b.incident_time,
            'description': b.description,
            'repair_status': b.repair_status,
            'repairing_by': b.repairing_by,
            'anticipated_return': b.anticipated_return.isoformat() if b.anticipated_return else None,
            'resolved_date': b.resolved_date.isoformat() if b.resolved_date else None,
            'photos': [{'id': p.id, 'url': f'/api/equipment/breakdowns/photos/{p.filename}', 'filename': p.original_name}
                       for p in b.photos],
        } for b in breakdowns],
        'daily_checks': [{
            'id': dc.id,
            'check_date': dc.check_date.isoformat(),
            'condition': dc.condition,
            'hours_reading': dc.hours_reading,
            'notes': dc.notes,
            'checked_by': (dc.checked_by_user.display_name or dc.checked_by_user.username) if dc.checked_by_user else None,
            'photo_url': f'/api/equipment/daily-check-photo/{dc.photo_filename}' if dc.photo_filename else None,
        } for dc in daily_checks],
        'open_checklists': [{
            'checklist_id': item.checklist_id,
            'checklist_name': item.checklist.checklist_name if item.checklist else None,
            'item_id': item.id,
            'machine_label': item.machine_label,
        } for item in open_checklist_items],
        'pending_transfer': {
            'id': pending_transfer.id,
            'from_project': pending_transfer.from_project.name if pending_transfer.from_project else None,
            'to_project': pending_transfer.to_project.name if pending_transfer.to_project else None,
            'scheduled_date': pending_transfer.scheduled_date.isoformat(),
            'status': pending_transfer.status,
            'travel_notes': pending_transfer.travel_notes,
            'transport_contact': pending_transfer.transport_contact,
        } if pending_transfer else None,
    }, 200


@api_data_bp.route('/equipment/machine/<int:machine_id>', methods=['PATCH'])
@jwt_required()
def equipment_machine_update(machine_id):
    """Update machine fields. Admin only."""
    user, err = _get_user()
    if err:
        return err
    if user.role != 'admin':
        return {'error': 'Admin only'}, 403

    m = Machine.query.get(machine_id)
    if not m:
        return {'error': 'Machine not found'}, 404

    data = request.get_json(silent=True) or {}

    # Basic fields
    for field in ('name', 'plant_id', 'description', 'serial_number',
                  'manufacturer', 'model_number', 'storage_instructions',
                  'service_instructions', 'spare_parts_notes', 'disposal_procedure'):
        if field in data:
            setattr(m, field, data[field] or None)

    if 'type' in data:
        m.machine_type = data['type'] or None
    if 'delay_rate' in data:
        m.delay_rate = float(data['delay_rate']) if data['delay_rate'] is not None else None
    if 'active' in data:
        m.active = bool(data['active'])
    if 'inspection_interval_days' in data:
        m.inspection_interval_days = int(data['inspection_interval_days']) if data['inspection_interval_days'] else None

    for date_field in ('acquired_date', 'dispose_by_date', 'next_inspection_date'):
        if date_field in data:
            val = data[date_field]
            if val:
                try:
                    setattr(m, date_field, datetime.strptime(val, '%Y-%m-%d').date())
                except (ValueError, TypeError):
                    pass
            else:
                setattr(m, date_field, None)

    db.session.commit()
    return {'id': m.id, 'name': m.name}, 200


@api_data_bp.route('/equipment/checklist/<int:checklist_id>', methods=['GET'])
@jwt_required()
def equipment_checklist_detail(checklist_id):
    """Full checklist with all items for mobile."""
    user, err = _get_user()
    if err:
        return err

    from models import SiteEquipmentChecklist, SiteEquipmentChecklistItem

    cl = SiteEquipmentChecklist.query.get(checklist_id)
    if not cl:
        return {'error': 'Checklist not found'}, 404

    allowed = _accessible_ids(user)
    if not _has_project_access(user, cl.project_id, allowed):
        return {'error': 'Access denied'}, 403

    items = SiteEquipmentChecklistItem.query.filter_by(checklist_id=checklist_id).all()
    total = len(items)
    checked_count = sum(1 for i in items if i.checked)

    return {
        'id': cl.id,
        'checklist_name': cl.checklist_name,
        'project_id': cl.project_id,
        'project_name': cl.project.name if cl.project else None,
        'due_date': cl.due_date.isoformat(),
        'completed_at': cl.completed_at.isoformat() if cl.completed_at else None,
        'notes': cl.notes,
        'total': total,
        'checked': checked_count,
        'items': [{
            'id': item.id,
            'machine_id': item.machine_id,
            'hired_machine_id': item.hired_machine_id,
            'machine_label': item.machine_label,
            'checked': item.checked,
            'checked_by': (item.checked_by_user.display_name or item.checked_by_user.username) if item.checked_by_user else None,
            'checked_at': item.checked_at.isoformat() if item.checked_at else None,
            'condition': item.condition,
            'notes': item.notes,
            'photo_url': f'/api/equipment/checklist-photo/{item.photo_filename}' if item.photo_filename else None,
        } for item in items],
    }, 200


@api_data_bp.route('/equipment/checklist/<int:checklist_id>/item/<int:item_id>/check', methods=['POST'])
@jwt_required()
def equipment_checklist_item_check_api(checklist_id, item_id):
    """Mark a checklist item as checked (mobile API)."""
    user, err = _get_user()
    if err:
        return err

    from models import SiteEquipmentChecklist, SiteEquipmentChecklistItem

    item = SiteEquipmentChecklistItem.query.get(item_id)
    if not item or item.checklist_id != checklist_id:
        return {'error': 'Item not found'}, 404

    cl = SiteEquipmentChecklist.query.get(checklist_id)
    allowed = _accessible_ids(user)
    if cl and not _has_project_access(user, cl.project_id, allowed):
        return {'error': 'Access denied'}, 403

    condition = request.form.get('condition', 'good')
    notes = request.form.get('notes', '').strip() or None

    item.checked = True
    item.checked_by_user_id = user.id
    item.checked_at = datetime.utcnow()
    item.condition = condition
    item.notes = notes

    photo = request.files.get('photo')
    if photo and photo.filename:
        ext = os.path.splitext(photo.filename)[1].lower()
        stored = f"{uuid.uuid4()}{ext}"
        local_path = os.path.join(UPLOAD_FOLDER, 'checklists', stored)
        storage.upload_file(photo, f'checklists/{stored}', local_path)
        item.photo_filename = stored
        item.photo_original_name = photo.filename

    if condition in ('poor', 'broken_down'):
        bd = MachineBreakdown(
            machine_id=item.machine_id,
            hired_machine_id=item.hired_machine_id,
            incident_date=date.today(),
            description=f'Flagged during checklist: {cl.checklist_name}. Condition: {condition}. {notes or ""}',
            repair_status='pending',
        )
        db.session.add(bd)
        db.session.flush()

        try:
            from utils.notifications import notify_breakdown_to_admin
            notify_breakdown_to_admin(bd, item.machine_label, cl.project.name if cl.project else 'Unknown')
        except Exception:
            pass

    # Check if all items are now done
    unchecked = SiteEquipmentChecklistItem.query.filter_by(
        checklist_id=checklist_id, checked=False).count()
    if unchecked == 0 and cl:
        cl.completed_at = datetime.utcnow()

    db.session.commit()
    return {'message': 'Item checked', 'item_id': item.id}, 200


@api_data_bp.route('/equipment/project/<int:project_id>/daily-checks', methods=['GET'])
@jwt_required()
def equipment_project_daily_checks(project_id):
    """For a given project and date, returns every assigned machine with its daily check."""
    user, err = _get_user()
    if err:
        return err

    allowed = _accessible_ids(user)
    if not _has_project_access(user, project_id, allowed):
        return {'error': 'Access denied'}, 403

    from models import MachineDailyCheck

    check_date_str = request.args.get('date')
    if check_date_str:
        try:
            check_date = datetime.strptime(check_date_str, '%Y-%m-%d').date()
        except ValueError:
            check_date = date.today()
    else:
        check_date = date.today()

    # All machines assigned to this project
    own_assignments = ProjectMachine.query.filter_by(project_id=project_id).all()
    hired_machines = HiredMachine.query.filter_by(project_id=project_id, active=True).all()

    # Daily checks already done
    checks = MachineDailyCheck.query.filter_by(
        project_id=project_id, check_date=check_date).all()
    check_by_machine = {c.machine_id: c for c in checks if c.machine_id}
    check_by_hired = {c.hired_machine_id: c for c in checks if c.hired_machine_id}

    # Pending transfers for machines on this project
    pending_transfers = {t.machine_id: t for t in MachineTransfer.query.filter(
        MachineTransfer.status.in_(['scheduled', 'in_transit'])).all() if t.machine_id}

    machines_list = []
    for pm in own_assignments:
        m = pm.machine
        dc = check_by_machine.get(m.id)

        # Build alerts list
        alerts = []
        if m.next_inspection_date:
            days = (m.next_inspection_date - check_date).days
            if days <= 14:
                alerts.append({'type': 'inspection', 'message': f'Inspection due in {days} days' if days > 0 else 'Inspection overdue', 'days': days, 'urgency': 'danger' if days <= 3 else 'warning'})
        if m.dispose_by_date:
            days = (m.dispose_by_date - check_date).days
            if days <= 30:
                alerts.append({'type': 'disposal', 'message': f'Disposal in {days} days' if days > 0 else 'Disposal overdue', 'days': days, 'urgency': 'danger' if days <= 7 else 'warning'})
        if m.inspection_interval_days and m.next_inspection_date:
            alerts.append({'type': 'interval', 'message': f'Inspected every {m.inspection_interval_days} days'})

        # Pending transfer
        transfer = pending_transfers.get(m.id)
        transfer_info = None
        if transfer:
            transfer_info = {
                'to_project': transfer.to_project.name if transfer.to_project else 'Unassigned',
                'scheduled_date': transfer.scheduled_date.isoformat(),
                'status': transfer.status,
            }

        machines_list.append({
            'machine_id': m.id,
            'hired_machine_id': None,
            'name': m.name,
            'plant_id': m.plant_id,
            'type': m.machine_type,
            'source': 'fleet',
            'alerts': alerts,
            'pending_transfer': transfer_info,
            'check': {
                'id': dc.id,
                'condition': dc.condition,
                'hours_reading': dc.hours_reading,
                'notes': dc.notes,
                'checked_by': (dc.checked_by_user.display_name or dc.checked_by_user.username) if dc.checked_by_user else None,
                'photo_url': f'/api/equipment/daily-check-photo/{dc.photo_filename}' if dc.photo_filename else None,
            } if dc else None,
        })

    for hm in hired_machines:
        dc = check_by_hired.get(hm.id)
        machines_list.append({
            'machine_id': None,
            'hired_machine_id': hm.id,
            'name': hm.machine_name,
            'plant_id': hm.plant_id,
            'type': hm.machine_type,
            'source': 'hired',
            'alerts': [],
            'pending_transfer': None,
            'check': {
                'id': dc.id,
                'condition': dc.condition,
                'hours_reading': dc.hours_reading,
                'notes': dc.notes,
                'checked_by': (dc.checked_by_user.display_name or dc.checked_by_user.username) if dc.checked_by_user else None,
                'photo_url': f'/api/equipment/daily-check-photo/{dc.photo_filename}' if dc.photo_filename else None,
            } if dc else None,
        })

    total = len(machines_list)
    checked_count = sum(1 for m in machines_list if m['check'])

    return {
        'project_id': project_id,
        'date': check_date.isoformat(),
        'total': total,
        'checked': checked_count,
        'machines': machines_list,
    }, 200


@api_data_bp.route('/equipment/daily-check', methods=['POST'])
@jwt_required()
def equipment_daily_check_submit_api():
    """Submit a daily check from mobile."""
    user, err = _get_user()
    if err:
        return err

    from models import MachineDailyCheck

    machine_id = request.form.get('machine_id', type=int)
    hired_machine_id = request.form.get('hired_machine_id', type=int)
    project_id = request.form.get('project_id', type=int)
    condition = request.form.get('condition', 'good')
    notes = request.form.get('notes', '').strip() or None
    hours_reading_str = request.form.get('hours_reading', '').strip()
    hours_reading = float(hours_reading_str) if hours_reading_str else None

    if not project_id or (not machine_id and not hired_machine_id):
        return {'error': 'project_id and machine_id or hired_machine_id required'}, 400

    allowed = _accessible_ids(user)
    if not _has_project_access(user, project_id, allowed):
        return {'error': 'Access denied'}, 403

    check = MachineDailyCheck(
        machine_id=machine_id or None,
        hired_machine_id=hired_machine_id or None,
        project_id=project_id,
        check_date=date.today(),
        checked_by_user_id=user.id,
        condition=condition,
        hours_reading=hours_reading,
        notes=notes,
    )

    photo = request.files.get('photo')
    if photo and photo.filename:
        ext = os.path.splitext(photo.filename)[1].lower()
        stored = f"{uuid.uuid4()}{ext}"
        local_path = os.path.join(UPLOAD_FOLDER, 'daily_checks', stored)
        storage.upload_file(photo, f'daily_checks/{stored}', local_path)
        check.photo_filename = stored
        check.photo_original_name = photo.filename

    breakdown_id = None
    if condition == 'broken_down':
        machine_name = ''
        if machine_id:
            m = Machine.query.get(machine_id)
            machine_name = m.name if m else ''
        elif hired_machine_id:
            hm = HiredMachine.query.get(hired_machine_id)
            machine_name = hm.machine_name if hm else ''

        bd = MachineBreakdown(
            machine_id=machine_id or None,
            hired_machine_id=hired_machine_id or None,
            incident_date=date.today(),
            description=f'Flagged as broken down during daily check. {notes or ""}',
            repair_status='pending',
        )
        db.session.add(bd)
        db.session.flush()
        check.breakdown_id = bd.id
        breakdown_id = bd.id

        try:
            from utils.notifications import notify_breakdown_to_admin
            project = Project.query.get(project_id)
            notify_breakdown_to_admin(bd, machine_name, project.name if project else 'Unknown')
        except Exception:
            pass

    db.session.add(check)
    db.session.flush()

    # Auto-log machine hours if reading was provided
    if hours_reading is not None and machine_id:
        hours_log = MachineHoursLog(
            machine_id=machine_id,
            project_id=project_id,
            log_date=date.today(),
            hours_reading=hours_reading,
            recorded_by_user_id=user.id,
            daily_check_id=check.id,
        )
        db.session.add(hours_log)

    db.session.commit()

    result = {'message': 'Daily check recorded', 'check_id': check.id}
    if breakdown_id:
        result['breakdown_id'] = breakdown_id
    return result, 201


@api_data_bp.route('/equipment/daily-check-photo/<filename>')
def serve_daily_check_photo_api(filename):
    """Serve daily check photos (UUID-obscured, no JWT)."""
    return storage.serve_file(
        f'daily_checks/{filename}',
        os.path.join(UPLOAD_FOLDER, 'daily_checks', filename)
    )


@api_data_bp.route('/equipment/checklist-photo/<filename>')
def serve_checklist_photo_api(filename):
    """Serve checklist photos (UUID-obscured, no JWT)."""
    return storage.serve_file(
        f'checklists/{filename}',
        os.path.join(UPLOAD_FOLDER, 'checklists', filename)
    )


@api_data_bp.route('/equipment/admin/dashboard', methods=['GET'])
@jwt_required()
def equipment_admin_dashboard_api():
    """JSON version of admin dashboard data."""
    user, err = _get_user()
    if err:
        return err
    if user.role != 'admin':
        return {'error': 'Admin only'}, 403

    from models import (MachineTransfer, SiteEquipmentChecklist,
                        SiteEquipmentChecklistItem, MachineDailyCheck)
    from sqlalchemy import func

    today_date = date.today()
    projects = Project.query.filter_by(active=True).order_by(Project.name).all()

    project_data = []
    for p in projects:
        own_count = ProjectMachine.query.filter_by(project_id=p.id).count()
        hired_count = HiredMachine.query.filter_by(project_id=p.id, active=True).count()
        total_machines = own_count + hired_count
        checks_today = MachineDailyCheck.query.filter_by(
            project_id=p.id, check_date=today_date).count()
        entry_today = DailyEntry.query.filter_by(
            project_id=p.id).filter(
            func.date(DailyEntry.entry_date) == today_date).first()

        own_machine_ids = {pm.machine_id for pm in ProjectMachine.query.filter_by(project_id=p.id).all()}
        hired_ids = {hm.id for hm in HiredMachine.query.filter_by(project_id=p.id).all()}
        open_bds = MachineBreakdown.query.filter(
            MachineBreakdown.repair_status != 'completed',
            db.or_(
                MachineBreakdown.machine_id.in_(own_machine_ids) if own_machine_ids else db.false(),
                MachineBreakdown.hired_machine_id.in_(hired_ids) if hired_ids else db.false(),
            )
        ).count()

        project_data.append({
            'project_id': p.id,
            'project_name': p.name,
            'site_manager': (p.site_manager.display_name or p.site_manager.username) if p.site_manager else None,
            'total_machines': total_machines,
            'checks_today': checks_today,
            'entry_submitted': entry_today is not None,
            'open_breakdowns': open_bds,
        })

    alert_machines = Machine.query.filter(
        Machine.active == True,
        db.or_(
            db.and_(Machine.dispose_by_date.isnot(None),
                    Machine.dispose_by_date <= today_date + timedelta(days=30)),
            db.and_(Machine.next_inspection_date.isnot(None),
                    Machine.next_inspection_date <= today_date + timedelta(days=14)),
        )
    ).all()

    pending_transfers = MachineTransfer.query.filter(
        MachineTransfer.status.in_(['scheduled', 'in_transit'])
    ).order_by(MachineTransfer.scheduled_date).all()

    return {
        'projects': project_data,
        'alert_machines': [{
            'id': m.id,
            'name': m.name,
            'dispose_by_date': m.dispose_by_date.isoformat() if m.dispose_by_date else None,
            'next_inspection_date': m.next_inspection_date.isoformat() if m.next_inspection_date else None,
        } for m in alert_machines],
        'pending_transfers': [{
            'id': t.id,
            'machine_name': t.machine.name if t.machine else None,
            'from_project': t.from_project.name if t.from_project else None,
            'to_project': t.to_project.name if t.to_project else None,
            'scheduled_date': t.scheduled_date.isoformat(),
            'status': t.status,
        } for t in pending_transfers],
    }, 200


# ─────────────────────────────────────────────────────────────────────────────
# MACHINE DOCUMENTS API
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/equipment/machine/<int:machine_id>/documents', methods=['GET'])
@jwt_required()
def equipment_machine_documents(machine_id):
    """List documents for a machine."""
    user, err = _get_user()
    if err:
        return err
    docs = MachineDocument.query.filter_by(machine_id=machine_id).order_by(
        MachineDocument.uploaded_at.desc()).all()
    return {'documents': [{
        'id': d.id,
        'filename': d.filename,
        'original_name': d.original_name,
        'doc_type': d.doc_type,
        'title': d.title,
        'notes': d.notes,
        'uploaded_by': (d.uploaded_by.display_name or d.uploaded_by.username) if d.uploaded_by else None,
        'uploaded_at': d.uploaded_at.isoformat() if d.uploaded_at else None,
        'url': f'/api/equipment/machine-doc/{d.filename}',
    } for d in docs]}, 200


@api_data_bp.route('/equipment/machine/<int:machine_id>/documents', methods=['POST'])
@jwt_required()
def equipment_machine_document_upload(machine_id):
    """Upload a document to a machine."""
    user, err = _get_user()
    if err:
        return err
    if user.role not in ('admin', 'supervisor'):
        return {'error': 'Forbidden'}, 403

    file = request.files.get('file')
    if not file or not file.filename:
        return {'error': 'No file provided'}, 400

    doc_type = request.form.get('doc_type', 'other')
    title = request.form.get('title', '').strip() or file.filename
    notes = request.form.get('notes', '').strip() or None

    ext = os.path.splitext(file.filename)[1].lower()
    stored = f"{uuid.uuid4()}{ext}"
    local_path = os.path.join(UPLOAD_FOLDER, 'machine_docs', stored)
    storage.upload_file(file, f'machine_docs/{stored}', local_path)

    doc = MachineDocument(
        machine_id=machine_id, filename=stored, original_name=file.filename,
        doc_type=doc_type, title=title, notes=notes, uploaded_by_user_id=user.id,
    )
    db.session.add(doc)
    db.session.commit()
    return {'id': doc.id, 'message': 'Document uploaded'}, 201


@api_data_bp.route('/equipment/machine-doc/<filename>')
def serve_machine_doc_api(filename):
    """Serve machine documents (UUID-obscured, no JWT)."""
    return storage.serve_file(
        f'machine_docs/{filename}',
        os.path.join(UPLOAD_FOLDER, 'machine_docs', filename)
    )


# ─────────────────────────────────────────────────────────────────────────────
# MACHINE HOURS LOG API
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/equipment/machine/<int:machine_id>/hours', methods=['GET'])
@jwt_required()
def equipment_machine_hours(machine_id):
    """Get hours log for a machine."""
    user, err = _get_user()
    if err:
        return err
    logs = MachineHoursLog.query.filter_by(machine_id=machine_id).order_by(
        MachineHoursLog.log_date.desc()).limit(60).all()
    return {'hours_logs': [{
        'id': l.id,
        'log_date': l.log_date.isoformat(),
        'hours_reading': l.hours_reading,
        'recorded_by': (l.recorded_by.display_name or l.recorded_by.username) if l.recorded_by else None,
        'project_name': l.project.name if l.project else None,
    } for l in logs]}, 200


# ─────────────────────────────────────────────────────────────────────────────
# DAILY TASKS / TO-DO API
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/tasks/my-todos', methods=['GET'])
@jwt_required()
def my_todos():
    """Get the current user's to-do items for today."""
    user, err = _get_user()
    if err:
        return err

    from sqlalchemy import func
    today_date = date.today()
    todos = []

    # Find task assignments for this user
    assignments = ProjectDailyTaskAssignment.query.filter_by(
        assigned_user_id=user.id, active=True).all()

    for a in assignments:
        project = a.project
        if not project or not project.active:
            continue

        if a.task_type == 'daily_entry':
            entry_exists = DailyEntry.query.filter_by(
                project_id=project.id).filter(
                func.date(DailyEntry.entry_date) == today_date).first()
            todos.append({
                'project_id': project.id,
                'project_name': project.name,
                'task_type': 'daily_entry',
                'label': 'Submit daily entry',
                'completed': entry_exists is not None,
            })

        elif a.task_type == 'machine_startup':
            checks_done = MachineDailyCheck.query.filter_by(
                project_id=project.id, check_date=today_date).count()
            todos.append({
                'project_id': project.id,
                'project_name': project.name,
                'task_type': 'machine_startup',
                'label': 'Start machines for the day',
                'completed': checks_done > 0,
                'progress': {'done': checks_done, 'total': 0},
            })

    # Scheduled equipment checks assigned to this user
    my_scheduled = ScheduledEquipmentCheck.query.filter(
        ScheduledEquipmentCheck.assigned_user_id == user.id,
        ScheduledEquipmentCheck.active == True,
        ScheduledEquipmentCheck.next_due_date <= today_date,
    ).all()
    for sc in my_scheduled:
        already_done = any(c.completed_date == today_date for c in sc.completions)
        todos.append({
            'project_id': sc.project_id,
            'project_name': sc.project.name if sc.project else None,
            'task_type': 'scheduled_check',
            'label': sc.name,
            'completed': already_done,
            'check_id': sc.id,
            'machine_count': len(sc.machines),
        })

    return {'date': today_date.isoformat(), 'todos': todos}, 200


@api_data_bp.route('/tasks/admin-overview', methods=['GET'])
@jwt_required()
def admin_task_overview():
    """Admin overview: all projects, task assignments, completion status, standdown emails."""
    user, err = _get_user()
    if err:
        return err
    if user.role != 'admin':
        return {'error': 'Admin only'}, 403

    from sqlalchemy import func
    today_date = date.today()
    projects = Project.query.filter_by(active=True).order_by(Project.name).all()

    project_tasks = []
    for p in projects:
        # Task assignments
        assignments = ProjectDailyTaskAssignment.query.filter_by(
            project_id=p.id, active=True).all()

        entry_assignment = next((a for a in assignments if a.task_type == 'daily_entry'), None)
        startup_assignment = next((a for a in assignments if a.task_type == 'machine_startup'), None)

        # Daily entry status
        entry_today = DailyEntry.query.filter_by(
            project_id=p.id).filter(
            func.date(DailyEntry.entry_date) == today_date).first()

        # Machine startup status
        own_count = ProjectMachine.query.filter_by(project_id=p.id).count()
        hired_count = HiredMachine.query.filter_by(project_id=p.id, active=True).count()
        total_machines = own_count + hired_count
        checks_done = MachineDailyCheck.query.filter_by(
            project_id=p.id, check_date=today_date).count()

        # Standdown email needed: if today's entry has delays and hired machines exist
        standdown_needed = False
        if entry_today and hired_count > 0:
            has_delays = (entry_today.delay_hours or 0) > 0
            if not has_delays:
                from models import EntryDelayLine
                has_delays = EntryDelayLine.query.filter_by(entry_id=entry_today.id).count() > 0
            standdown_needed = has_delays

        # Open breakdowns
        own_machine_ids = {pm.machine_id for pm in ProjectMachine.query.filter_by(project_id=p.id).all()}
        hired_ids = {hm.id for hm in HiredMachine.query.filter_by(project_id=p.id).all()}
        open_breakdowns = MachineBreakdown.query.filter(
            MachineBreakdown.repair_status != 'completed',
            db.or_(
                MachineBreakdown.machine_id.in_(own_machine_ids) if own_machine_ids else db.false(),
                MachineBreakdown.hired_machine_id.in_(hired_ids) if hired_ids else db.false(),
            )
        ).count()

        project_tasks.append({
            'project_id': p.id,
            'project_name': p.name,
            'site_manager': (p.site_manager.display_name or p.site_manager.username) if p.site_manager else None,
            'daily_entry': {
                'assigned_to': (entry_assignment.assigned_user.display_name or entry_assignment.assigned_user.username) if entry_assignment else None,
                'completed': entry_today is not None,
            },
            'machine_startup': {
                'assigned_to': (startup_assignment.assigned_user.display_name or startup_assignment.assigned_user.username) if startup_assignment else None,
                'done': checks_done,
                'total': total_machines,
                'completed': checks_done >= total_machines and total_machines > 0,
            },
            'standdown_email_needed': standdown_needed,
            'open_breakdowns': open_breakdowns,
        })

    return {'date': today_date.isoformat(), 'projects': project_tasks}, 200


@api_data_bp.route('/tasks/assignments', methods=['GET'])
@jwt_required()
def task_assignments_list():
    """List all task assignments (admin)."""
    user, err = _get_user()
    if err:
        return err
    if user.role != 'admin':
        return {'error': 'Admin only'}, 403

    assignments = ProjectDailyTaskAssignment.query.filter_by(active=True).all()
    return {'assignments': [{
        'id': a.id,
        'project_id': a.project_id,
        'project_name': a.project.name if a.project else None,
        'task_type': a.task_type,
        'assigned_user_id': a.assigned_user_id,
        'assigned_user_name': (a.assigned_user.display_name or a.assigned_user.username) if a.assigned_user else None,
    } for a in assignments]}, 200


@api_data_bp.route('/tasks/assignments', methods=['POST'])
@jwt_required()
def task_assignment_save_api():
    """Save a task assignment (admin)."""
    user, err = _get_user()
    if err:
        return err
    if user.role != 'admin':
        return {'error': 'Admin only'}, 403

    data = request.get_json(silent=True) or {}
    project_id = data.get('project_id')
    task_type = data.get('task_type')
    assigned_user_id = data.get('assigned_user_id')

    if not project_id or not task_type or not assigned_user_id:
        return {'error': 'project_id, task_type, and assigned_user_id required'}, 400

    existing = ProjectDailyTaskAssignment.query.filter_by(
        project_id=project_id, task_type=task_type).first()
    if existing:
        existing.assigned_user_id = assigned_user_id
        existing.active = True
    else:
        db.session.add(ProjectDailyTaskAssignment(
            project_id=project_id, task_type=task_type, assigned_user_id=assigned_user_id))
    db.session.commit()
    return {'message': 'Assignment saved'}, 200


# ─────────────────────────────────────────────────────────────────────────────
# SCHEDULED EQUIPMENT CHECK — detail + per-machine check flow
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/tasks/scheduled-check/<int:check_id>', methods=['GET'])
@jwt_required()
def scheduled_check_detail(check_id):
    """Returns the scheduled check with its machines and today's check status per machine."""
    user, err = _get_user()
    if err:
        return err

    sc = ScheduledEquipmentCheck.query.get(check_id)
    if not sc:
        return {'error': 'Not found'}, 404

    today_date = date.today()

    # Get today's daily checks for these machines on this project
    machine_ids = [m.id for m in sc.machines]
    existing_checks = {}
    if machine_ids:
        checks = MachineDailyCheck.query.filter(
            MachineDailyCheck.machine_id.in_(machine_ids),
            MachineDailyCheck.project_id == sc.project_id,
            MachineDailyCheck.check_date == today_date,
        ).all()
        existing_checks = {c.machine_id: c for c in checks}

    machines_list = []
    for m in sc.machines:
        dc = existing_checks.get(m.id)

        # Alerts for this machine
        alerts = []
        if m.next_inspection_date:
            days = (m.next_inspection_date - today_date).days
            if days <= 14:
                alerts.append({'type': 'inspection', 'message': f'Inspection due in {days} days' if days > 0 else 'Inspection overdue', 'urgency': 'danger' if days <= 3 else 'warning'})
        if m.dispose_by_date:
            days = (m.dispose_by_date - today_date).days
            if days <= 30:
                alerts.append({'type': 'disposal', 'message': f'Disposal in {days} days' if days > 0 else 'Disposal overdue', 'urgency': 'danger' if days <= 7 else 'warning'})

        # Pending transfer
        transfer = MachineTransfer.query.filter(
            MachineTransfer.machine_id == m.id,
            MachineTransfer.status.in_(['scheduled', 'in_transit']),
        ).first()

        machines_list.append({
            'machine_id': m.id,
            'name': m.name,
            'plant_id': m.plant_id,
            'type': m.machine_type,
            'alerts': alerts,
            'pending_transfer': {
                'to_project': transfer.to_project.name if transfer and transfer.to_project else None,
                'scheduled_date': transfer.scheduled_date.isoformat() if transfer else None,
                'status': transfer.status if transfer else None,
            } if transfer else None,
            'check': {
                'id': dc.id,
                'condition': dc.condition,
                'hours_reading': dc.hours_reading,
                'notes': dc.notes,
                'checked_by': (dc.checked_by_user.display_name or dc.checked_by_user.username) if dc.checked_by_user else None,
                'photo_url': f'/api/equipment/daily-check-photo/{dc.photo_filename}' if dc.photo_filename else None,
            } if dc else None,
        })

    total = len(machines_list)
    checked = sum(1 for m in machines_list if m['check'])
    already_completed = any(c.completed_date == today_date for c in sc.completions)

    return {
        'id': sc.id,
        'name': sc.name,
        'project_id': sc.project_id,
        'project_name': sc.project.name if sc.project else None,
        'frequency': sc.frequency,
        'next_due_date': sc.next_due_date.isoformat(),
        'notes': sc.notes,
        'total': total,
        'checked': checked,
        'completed_today': already_completed,
        'machines': machines_list,
    }, 200


@api_data_bp.route('/tasks/scheduled-check/<int:check_id>/complete', methods=['POST'])
@jwt_required()
def scheduled_check_complete_api(check_id):
    """Mark a scheduled check as completed."""
    user, err = _get_user()
    if err:
        return err

    sc = ScheduledEquipmentCheck.query.get(check_id)
    if not sc:
        return {'error': 'Not found'}, 404

    today_date = date.today()

    # Check if already completed today
    already = any(c.completed_date == today_date for c in sc.completions)
    if already:
        return {'error': 'Already completed today'}, 400

    notes = request.form.get('notes', '').strip() or (request.get_json(silent=True) or {}).get('notes')

    completion = ScheduledCheckCompletion(
        scheduled_check_id=sc.id,
        completed_date=today_date,
        completed_by_user_id=user.id,
        notes=notes,
    )
    db.session.add(completion)
    sc.advance_due_date()
    db.session.commit()

    return {'message': 'Check completed', 'next_due_date': sc.next_due_date.isoformat() if sc.active else None}, 200
