import os
from datetime import date, datetime, timedelta

from flask import Blueprint, make_response, request, url_for
from sqlalchemy import or_
from flask_jwt_extended import jwt_required, get_jwt_identity

from models import (
    db, User, Project, DailyEntry, Employee, Machine, HiredMachine,
    MachineBreakdown, ProjectDocument, ProjectMachine, ProjectAssignment,
    PlannedData, Role, DeviceToken,
)
import storage
from utils.gantt import compute_gantt_data
from utils.progress import compute_project_progress, compute_delay_summary, build_delay_report
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

    return base


# ─────────────────────────────────────────────────────────────────────────────
# PHOTOS
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/photos/<filename>')
@jwt_required()
def serve_photo(filename):
    local_path = os.path.join(UPLOAD_FOLDER, filename)
    return storage.serve_file(f'photos/{filename}', local_path)


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
            'total_planned': progress['total_planned'],
            'total_actual': progress['total_actual'],
            'total_remaining': progress['total_remaining'],
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

    if user.role == 'admin':
        data['planned_crew'] = project.planned_crew
        data['state'] = project.state
        data['is_cfmeu'] = project.is_cfmeu

    return data, 200


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
    page = max(1, request.args.get('page', 1, type=int))
    per_page = min(50, max(1, request.args.get('per_page', 20, type=int)))

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

    entry.updated_at = datetime.utcnow()
    db.session.commit()

    return _format_entry(entry, include_detail=True), 200


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

    if user.role == 'admin':
        machines = Machine.query.filter_by(active=True).order_by(Machine.name).all()
    else:
        allowed_ids = _accessible_ids(user)
        if not allowed_ids:
            return {'machines': []}, 200
        assigned_ids = {
            row.machine_id
            for row in (ProjectMachine.query
                        .filter(ProjectMachine.project_id.in_(allowed_ids))
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
            {'id': m.id, 'name': m.name, 'type': m.machine_type, 'active': m.active}
            for m in machines
        ]
    }, 200


@api_data_bp.route('/equipment/breakdowns', methods=['GET'])
@jwt_required()
def get_breakdowns():
    user, err = _get_user()
    if err:
        return err

    query = MachineBreakdown.query.order_by(MachineBreakdown.incident_date.desc())

    if user.role != 'admin':
        allowed_ids = _accessible_ids(user)
        if not allowed_ids:
            return {'breakdowns': []}, 200

        own_ids = {
            row.machine_id
            for row in (ProjectMachine.query
                        .filter(ProjectMachine.project_id.in_(allowed_ids))
                        .with_entities(ProjectMachine.machine_id)
                        .distinct().all())
        }
        hired_ids = {
            row.id
            for row in (HiredMachine.query
                        .filter(HiredMachine.project_id.in_(allowed_ids))
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

    bd = MachineBreakdown(
        machine_id=machine.id,
        incident_date=breakdown_date,
        description=description,
        repair_status='completed' if data.get('resolved') else 'pending',
    )
    db.session.add(bd)
    db.session.commit()

    return {
        'id': bd.id,
        'machine_id': bd.machine_id,
        'machine_name': machine.name,
        'date': bd.incident_date.isoformat(),
        'description': bd.description,
        'resolved': bd.repair_status == 'completed',
    }, 201


# ─────────────────────────────────────────────────────────────────────────────
# HIRED EQUIPMENT
# ─────────────────────────────────────────────────────────────────────────────

@api_data_bp.route('/hire', methods=['GET'])
@jwt_required()
def get_hire():
    user, err = _get_user()
    if err:
        return err

    if user.role == 'admin':
        hired = HiredMachine.query.order_by(HiredMachine.machine_name).all()
    else:
        allowed_ids = _accessible_ids(user)
        if not allowed_ids:
            return {'hired_machines': []}, 200
        hired = (HiredMachine.query
                 .filter(HiredMachine.project_id.in_(allowed_ids))
                 .order_by(HiredMachine.machine_name).all())

    return {
        'hired_machines': [
            {
                'id': hm.id,
                'machine_name': hm.machine_name,
                'machine_type': hm.machine_type,
                'hire_company': hm.hire_company,
                'delivery_date': hm.delivery_date.isoformat() if hm.delivery_date else None,
                'return_date': hm.return_date.isoformat() if hm.return_date else None,
                'project_id': hm.project_id,
                'project_name': hm.project.name if hm.project else None,
            }
            for hm in hired
        ]
    }, 200


# ─────────────────────────────────────────────────────────────────────────────
# DOCUMENTS
# ─────────────────────────────────────────────────────────────────────────────

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

@api_data_bp.route('/roster', methods=['GET'])
@jwt_required()
def get_roster():
    user, err = _get_user()
    if err:
        return err

    if user.employee_id is None:
        return {'error': 'Account not linked to employee'}, 200

    employee = Employee.query.get(user.employee_id)
    if not employee:
        return {'error': 'Employee record not found'}, 404

    today = date.today()
    date_list = [today + timedelta(days=i) for i in range(14)]
    period_end = date_list[-1]

    grid = build_schedule_grid([employee], date_list)
    emp_grid = grid.get(employee.id, {})

    assignments = ProjectAssignment.query.filter(
        ProjectAssignment.employee_id == employee.id,
        ProjectAssignment.date_from <= period_end,
        db.or_(
            ProjectAssignment.date_to.is_(None),
            ProjectAssignment.date_to >= today,
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

    return {
        'employee': {'id': employee.id, 'name': employee.name},
        'schedule': schedule,
    }, 200


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
    planned_q = PlannedData.query
    if allowed_ids is not None:
        planned_q = planned_q.filter(PlannedData.project_id.in_(allowed_ids))
    planned_rows = planned_q.all()

    lots = sorted({r.lot for r in planned_rows if r.lot})
    materials = sorted({r.material for r in planned_rows if r.material})
    roles = [r.name for r in Role.query.order_by(Role.name).all()]
    projects = user.accessible_projects()

    machines = Machine.query.filter_by(active=True).order_by(Machine.name).all()

    return {
        'lots': lots,
        'materials': materials,
        'roles': roles,
        'projects': [_project_base(p) for p in projects],
        'employees': [
            {'id': e.id, 'name': e.name, 'role': e.role or ''}
            for e in _active_employees(allowed_ids)
        ],
        'machines': [
            {'id': m.id, 'name': m.name, 'type': m.machine_type or ''}
            for m in machines
        ],
        'hired_machines': [
            {'id': h.id, 'machine_name': h.machine_name, 'hire_company': h.hire_company or ''}
            for h in _active_hire(allowed_ids)
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
@jwt_required()
def send_reminders():
    user, err = _get_user()
    if err:
        return err

    if user.role != 'admin':
        return {'error': 'Access denied'}, 403

    from utils.notifications import send_entry_reminders
    count = send_entry_reminders()

    return {'message': 'Reminders sent', 'count': count}, 200


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
