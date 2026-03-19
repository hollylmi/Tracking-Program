import os
import uuid

from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import current_user

from blueprints.auth import require_role
from utils.helpers import get_active_project_id
from werkzeug.utils import secure_filename
from datetime import date, datetime

from models import (db, Project, Employee, Machine, DailyEntry, HiredMachine,
                    StandDown, EntryPhoto, ProjectMachine)
import storage
from utils.files import allowed_photo

entries_bp = Blueprint('entries', __name__)

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'instance', 'uploads')


# ---------------------------------------------------------------------------
# Daily entries
# ---------------------------------------------------------------------------

@entries_bp.route('/entry/new', methods=['GET', 'POST'])
@require_role('admin', 'supervisor', 'site')
def new_entry():
    projects = Project.query.filter_by(active=True).order_by(Project.name).all()
    employees = Employee.query.filter_by(active=True).order_by(Employee.name).all()
    machines = Machine.query.filter_by(active=True).order_by(Machine.name).all()
    hired_machines = HiredMachine.query.filter_by(active=True).order_by(HiredMachine.machine_name).all()

    if request.method == 'POST':
        project_id = request.form.get('project_id')
        entry_date_str = request.form.get('entry_date')
        if not project_id or not entry_date_str:
            flash('Project and date are required.', 'danger')
            return render_template('entry_form.html', projects=projects, employees=employees,
                                   machines=machines, hired_machines=hired_machines,
                                   standdown_machine_ids=[], today=date.today())
        try:
            entry_date = datetime.strptime(entry_date_str, '%Y-%m-%d').date()
        except ValueError:
            flash('Invalid date format.', 'danger')
            return render_template('entry_form.html', projects=projects, employees=employees,
                                   machines=machines, hired_machines=hired_machines,
                                   standdown_machine_ids=[], today=date.today())

        delay_hours = float(request.form.get('delay_hours') or 0)
        delay_billable = request.form.get('delay_billable', 'true') == 'true'
        machines_stood_down = bool(request.form.get('machines_stood_down'))

        entry = DailyEntry(
            project_id=int(project_id),
            entry_date=entry_date,
            lot_number=request.form.get('lot_number', '').strip() or None,
            location=request.form.get('location', '').strip() or None,
            material=request.form.get('material', '').strip() or None,
            num_people=int(request.form.get('num_people')) if request.form.get('num_people') else None,
            install_hours=float(request.form.get('install_hours') or 0),
            install_sqm=float(request.form.get('install_sqm') or 0),
            delay_hours=delay_hours,
            delay_billable=delay_billable,
            delay_reason=(request.form.get('delay_reason', '').strip() or None) if delay_hours > 0 else None,
            delay_description=request.form.get('delay_description', '').strip() or None,
            machines_stood_down=machines_stood_down,
            weather=request.form.get('weather', '').strip() or None,
            notes=request.form.get('notes', '').strip() or None,
            other_work_description=request.form.get('other_work_description', '').strip() or None,
            user_id=current_user.id,
        )
        employee_ids = request.form.getlist('employee_ids')
        machine_ids = request.form.getlist('machine_ids')
        if employee_ids:
            entry.employees = Employee.query.filter(Employee.id.in_(employee_ids)).all()
        if machine_ids:
            entry.machines = Machine.query.filter(Machine.id.in_(machine_ids)).all()
        db.session.add(entry)
        db.session.flush()  # get entry.id before photos

        # Photo uploads
        photos = request.files.getlist('photos')
        for photo in photos:
            if photo and photo.filename and allowed_photo(photo.filename):
                ext = photo.filename.rsplit('.', 1)[1].lower()
                stored_name = f"photo_{uuid.uuid4().hex}.{ext}"
                storage.upload_file(photo, f'photos/{stored_name}', os.path.join(UPLOAD_FOLDER, stored_name))
                caption = request.form.get(f'caption_{photo.filename}', '').strip() or None
                db.session.add(EntryPhoto(entry_id=entry.id, filename=stored_name,
                                          original_name=secure_filename(photo.filename),
                                          caption=caption))

        # Auto-create stand-downs for selected hired machines
        standdown_ids = request.form.getlist('standdown_machine_ids')
        if standdown_ids and delay_hours > 0:
            sd_reason = (entry.delay_description or entry.delay_reason or 'Delay')
            sd_count = 0
            for hm_id in standdown_ids:
                hm_obj = HiredMachine.query.get(int(hm_id))
                if hm_obj:
                    existing = StandDown.query.filter_by(
                        hired_machine_id=hm_obj.id, stand_down_date=entry_date).first()
                    if not existing:
                        db.session.add(StandDown(
                            hired_machine_id=hm_obj.id,
                            entry_id=entry.id,
                            stand_down_date=entry_date,
                            reason=sd_reason))
                        sd_count += 1
            if sd_count:
                flash(f'Stand-down recorded for {sd_count} hired machine{"s" if sd_count != 1 else ""}.', 'info')

        db.session.commit()
        flash('Entry saved successfully!', 'success')
        return redirect(url_for('entries.entries'))

    # Build machine_project_map: {machine_id: [project_id, ...]} for JS filtering
    all_pm = ProjectMachine.query.all()
    machine_project_map = {}
    for pm in all_pm:
        machine_project_map.setdefault(pm.machine_id, [])
        machine_project_map[pm.machine_id].append(pm.project_id)

    return render_template('entry_form.html', projects=projects, employees=employees,
                           machines=machines, hired_machines=hired_machines,
                           machine_project_map=machine_project_map,
                           standdown_machine_ids=[], today=date.today())


@entries_bp.route('/entry/<int:entry_id>/edit', methods=['GET', 'POST'])
@require_role('admin', 'supervisor', 'site')
def edit_entry(entry_id):
    entry = DailyEntry.query.get_or_404(entry_id)
    if current_user.role == 'site' and entry.user_id != current_user.id:
        flash('You can only edit your own entries.', 'danger')
        return redirect(url_for('entries.entries'))
    projects = Project.query.filter_by(active=True).order_by(Project.name).all()
    employees = Employee.query.filter_by(active=True).order_by(Employee.name).all()
    machines = Machine.query.filter_by(active=True).order_by(Machine.name).all()
    hired_machines = HiredMachine.query.filter_by(active=True).order_by(HiredMachine.machine_name).all()

    if request.method == 'POST':
        entry.project_id = int(request.form.get('project_id'))
        entry.lot_number = request.form.get('lot_number', '').strip() or None
        entry.location = request.form.get('location', '').strip() or None
        entry.material = request.form.get('material', '').strip() or None
        num_people = request.form.get('num_people')
        entry.num_people = int(num_people) if num_people else None
        entry.install_hours = float(request.form.get('install_hours') or 0)
        entry.install_sqm = float(request.form.get('install_sqm') or 0)
        entry.delay_hours = float(request.form.get('delay_hours') or 0)
        entry.delay_billable = request.form.get('delay_billable', 'true') == 'true'
        entry.delay_reason = (request.form.get('delay_reason', '').strip() or None) if entry.delay_hours > 0 else None
        entry.delay_description = request.form.get('delay_description', '').strip() or None
        entry.machines_stood_down = bool(request.form.get('machines_stood_down'))
        entry.weather = request.form.get('weather', '').strip() or None
        entry.notes = request.form.get('notes', '').strip() or None
        entry.other_work_description = request.form.get('other_work_description', '').strip() or None
        try:
            entry.entry_date = datetime.strptime(request.form.get('entry_date'), '%Y-%m-%d').date()
        except ValueError:
            flash('Invalid date format.', 'danger')

        employee_ids = request.form.getlist('employee_ids')
        machine_ids = request.form.getlist('machine_ids')
        entry.employees = Employee.query.filter(Employee.id.in_(employee_ids)).all() if employee_ids else []
        entry.machines = Machine.query.filter(Machine.id.in_(machine_ids)).all() if machine_ids else []
        entry.updated_at = datetime.utcnow()

        # New photo uploads
        photos = request.files.getlist('photos')
        for photo in photos:
            if photo and photo.filename and allowed_photo(photo.filename):
                ext = photo.filename.rsplit('.', 1)[1].lower()
                stored_name = f"photo_{uuid.uuid4().hex}.{ext}"
                storage.upload_file(photo, f'photos/{stored_name}', os.path.join(UPLOAD_FOLDER, stored_name))
                db.session.add(EntryPhoto(entry_id=entry.id, filename=stored_name,
                                          original_name=secure_filename(photo.filename)))

        # Stand-downs for newly selected hired machines
        standdown_ids = request.form.getlist('standdown_machine_ids')
        if standdown_ids and entry.delay_hours > 0:
            sd_reason = (entry.delay_description or entry.delay_reason or 'Delay')
            sd_count = 0
            for hm_id in standdown_ids:
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
                        sd_count += 1
            if sd_count:
                flash(f'Stand-down recorded for {sd_count} hired machine{"s" if sd_count != 1 else ""}.', 'info')

        db.session.commit()
        flash('Entry updated successfully!', 'success')
        return redirect(url_for('entries.entries'))

    # Pre-check machines that already have a stand-down on this entry's date
    existing_sd_ids = {
        sd.hired_machine_id
        for hm in hired_machines
        for sd in hm.stand_downs
        if sd.stand_down_date == entry.entry_date
    }

    # Build machine_project_map: {machine_id: [project_id, ...]} for JS filtering
    all_pm = ProjectMachine.query.all()
    machine_project_map = {}
    for pm in all_pm:
        machine_project_map.setdefault(pm.machine_id, [])
        machine_project_map[pm.machine_id].append(pm.project_id)

    return render_template('entry_form.html', entry=entry, projects=projects,
                           employees=employees, machines=machines,
                           hired_machines=hired_machines,
                           machine_project_map=machine_project_map,
                           standdown_machine_ids=existing_sd_ids,
                           selected_employee_ids=[e.id for e in entry.employees],
                           selected_machine_ids=[m.id for m in entry.machines],
                           today=date.today())


@entries_bp.route('/entry/<int:entry_id>/delete', methods=['POST'])
@require_role('admin')
def delete_entry(entry_id):
    entry = DailyEntry.query.get_or_404(entry_id)
    # Remove photo files
    for photo in entry.photos:
        storage.delete_file(f'photos/{photo.filename}', os.path.join(UPLOAD_FOLDER, photo.filename))
    db.session.delete(entry)
    db.session.commit()
    flash('Entry deleted.', 'info')
    return redirect(url_for('entries.entries'))


@entries_bp.route('/entry/<int:entry_id>/photo/<int:photo_id>/delete', methods=['POST'])
@require_role('admin', 'supervisor')
def delete_photo(entry_id, photo_id):
    photo = EntryPhoto.query.get_or_404(photo_id)
    if photo.entry_id != entry_id:
        flash('Invalid request.', 'danger')
        return redirect(url_for('entries.edit_entry', entry_id=entry_id))
    storage.delete_file(f'photos/{photo.filename}', os.path.join(UPLOAD_FOLDER, photo.filename))
    db.session.delete(photo)
    db.session.commit()
    flash('Photo deleted.', 'info')
    return redirect(url_for('entries.edit_entry', entry_id=entry_id))


@entries_bp.route('/entry-photo/<filename>')
@require_role('admin', 'supervisor', 'site')
def serve_entry_photo(filename):
    return storage.serve_file(f'photos/{filename}', os.path.join(UPLOAD_FOLDER, filename))


@entries_bp.route('/entries')
@require_role('admin', 'supervisor', 'site')
def entries():
    project_filter = request.args.get('project_id', '')
    date_from = request.args.get('date_from', '')
    date_to = request.args.get('date_to', '')
    query = DailyEntry.query.order_by(DailyEntry.entry_date.desc(), DailyEntry.created_at.desc())
    if current_user.role != 'admin':
        active_pid = get_active_project_id()
        if active_pid:
            query = query.filter_by(project_id=active_pid)
    elif project_filter:
        query = query.filter_by(project_id=int(project_filter))
    if date_from:
        try:
            query = query.filter(DailyEntry.entry_date >= datetime.strptime(date_from, '%Y-%m-%d').date())
        except ValueError:
            pass
    if date_to:
        try:
            query = query.filter(DailyEntry.entry_date <= datetime.strptime(date_to, '%Y-%m-%d').date())
        except ValueError:
            pass
    all_entries = query.all()
    projects = Project.query.order_by(Project.name).all()
    return render_template('entries_list.html', entries=all_entries, projects=projects,
                           project_filter=project_filter, date_from=date_from, date_to=date_to)


@entries_bp.route('/morning-standdown')
@require_role('admin', 'supervisor', 'site')
def morning_standdown():
    date_str = request.args.get('date', date.today().strftime('%Y-%m-%d'))
    try:
        selected_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        selected_date = date.today()

    # Find all standdowns on this date
    standdowns = (StandDown.query
                  .filter_by(stand_down_date=selected_date)
                  .join(HiredMachine)
                  .filter(HiredMachine.active == True)
                  .all())

    # Group by hire company email
    companies = {}
    for sd in standdowns:
        hm = sd.hired_machine
        email = hm.hire_company_email or 'No email'
        company = hm.hire_company or 'Unknown'
        key = email
        if key not in companies:
            companies[key] = {
                'email': email,
                'company': company,
                'machines': [],
                'reasons': set(),
                'photos': [],
            }
        companies[key]['machines'].append(hm)
        if sd.reason:
            companies[key]['reasons'].add(sd.reason)
        # Attach photos from the linked entry
        if sd.entry_id:
            entry = DailyEntry.query.get(sd.entry_id)
            if entry:
                for photo in entry.photos:
                    companies[key]['photos'].append(photo)

    # Convert sets to lists for template
    for key in companies:
        companies[key]['reasons'] = list(companies[key]['reasons'])

    return render_template('morning_standdown.html',
                           companies=list(companies.values()),
                           selected_date=selected_date,
                           date_str=date_str,
                           standdown_count=len(standdowns))
