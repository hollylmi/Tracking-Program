import os
import uuid
from collections import defaultdict
from datetime import date, datetime

from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import current_user

from blueprints.auth import require_role
from utils.helpers import get_active_project_id

from flask_login import current_user
from models import (db, Machine, MachineGroup, Project, HiredMachine, MachineBreakdown,
                    BreakdownPhoto, ProjectEquipmentAssignment, ProjectEquipmentRequirement,
                    ProjectMachine, EquipmentAssignmentHistory)
import storage

equipment_bp = Blueprint('equipment', __name__)

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'instance', 'uploads')


@equipment_bp.route('/equipment/machine/save', methods=['POST'])
@require_role('admin', 'supervisor')
def equipment_machine_save():
    action = request.form.get('action')
    if action == 'add':
        name = request.form.get('name', '').strip()
        if not name:
            flash('Machine name is required.', 'danger')
            return redirect(url_for('equipment.equipment_overview') + '#tab-own')
        group_id = request.form.get('group_id', '').strip()
        m = Machine(
            name=name,
            plant_id=request.form.get('plant_id', '').strip() or None,
            machine_type=request.form.get('machine_type', '').strip() or None,
            description=request.form.get('description', '').strip() or None,
            delay_rate=float(request.form.get('delay_rate')) if request.form.get('delay_rate') else None,
            group_id=int(group_id) if group_id else None,
        )
        db.session.add(m)
        db.session.commit()
        flash(f'Machine "{name}" added.', 'success')
    elif action == 'edit':
        m = Machine.query.get_or_404(request.form.get('machine_id', type=int))
        m.name = request.form.get('name', '').strip()
        m.plant_id = request.form.get('plant_id', '').strip() or None
        m.machine_type = request.form.get('machine_type', '').strip() or None
        m.description = request.form.get('description', '').strip() or None
        m.delay_rate = float(request.form.get('delay_rate')) if request.form.get('delay_rate') else None
        group_id = request.form.get('group_id', '').strip()
        m.group_id = int(group_id) if group_id else None
        db.session.commit()
        flash('Machine updated.', 'success')
    elif action == 'toggle':
        m = Machine.query.get_or_404(request.form.get('machine_id', type=int))
        m.active = not m.active
        db.session.commit()
        flash(f'"{m.name}" {"activated" if m.active else "deactivated"}.', 'info')
    elif action == 'delete':
        m = Machine.query.get_or_404(request.form.get('machine_id', type=int))
        if m.entries:
            flash('Cannot delete — machine has entries. Deactivate instead.', 'danger')
        else:
            db.session.delete(m)
            db.session.commit()
            flash('Machine deleted.', 'info')
    return redirect(url_for('equipment.equipment_overview') + '#tab-own')


@equipment_bp.route('/equipment/group/bulk', methods=['POST'])
@require_role('admin', 'supervisor')
def equipment_group_bulk():
    """Bulk update group membership — set which machines belong to a group."""
    group_id = request.form.get('group_id', type=int)
    if not group_id:
        flash('Select a group.', 'danger')
        return redirect(url_for('equipment.equipment_overview') + '#tab-own')

    grp = MachineGroup.query.get_or_404(group_id)
    selected_ids = set(int(x) for x in request.form.getlist('machine_ids') if x)

    # Remove machines no longer selected from this group
    for m in Machine.query.filter_by(group_id=group_id).all():
        if m.id not in selected_ids:
            m.group_id = None

    # Add newly selected machines to this group
    for mid in selected_ids:
        m = Machine.query.get(mid)
        if m:
            m.group_id = group_id

    db.session.commit()
    flash(f'Group "{grp.name}" updated — {len(selected_ids)} item{"s" if len(selected_ids) != 1 else ""}.', 'success')
    return redirect(url_for('equipment.equipment_overview') + '#tab-own')


@equipment_bp.route('/equipment/assign', methods=['POST'])
@require_role('admin', 'supervisor')
def equipment_assign():
    """Assign or move a machine to a project. Logs history."""
    from flask import jsonify
    machine_id = request.form.get('machine_id', type=int)
    new_project_id = request.form.get('project_id', type=int)

    if not machine_id:
        flash('Machine not specified.', 'danger')
        return redirect(url_for('equipment.equipment_overview') + '#tab-own')

    machine = Machine.query.get_or_404(machine_id)
    existing = ProjectMachine.query.filter_by(machine_id=machine_id).first()
    old_project_id = existing.project_id if existing else None
    old_project_name = existing.project.name if existing and existing.project else None

    if new_project_id:
        new_project = Project.query.get_or_404(new_project_id)
        if existing:
            if existing.project_id == new_project_id:
                flash('Already assigned to that project.', 'warning')
                return redirect(url_for('equipment.equipment_overview') + '#tab-own')
            existing.project_id = new_project_id
        else:
            db.session.add(ProjectMachine(project_id=new_project_id, machine_id=machine_id))

        # Log history
        db.session.add(EquipmentAssignmentHistory(
            machine_id=machine_id,
            from_project_id=old_project_id,
            to_project_id=new_project_id,
            moved_by=current_user.display_name or current_user.username,
        ))
        db.session.commit()
        msg = f'"{machine.name}" assigned to {new_project.name}'
        if old_project_name:
            msg += f' (moved from {old_project_name})'
        flash(msg, 'success')
    else:
        # Unassign
        if existing:
            db.session.add(EquipmentAssignmentHistory(
                machine_id=machine_id,
                from_project_id=old_project_id,
                to_project_id=None,
                moved_by=current_user.display_name or current_user.username,
            ))
            db.session.delete(existing)
            db.session.commit()
            flash(f'"{machine.name}" unassigned from {old_project_name}.', 'info')

    return redirect(url_for('equipment.equipment_overview') + '#tab-own')


@equipment_bp.route('/equipment/<int:machine_id>/history')
@require_role('admin', 'supervisor', 'site')
def equipment_history(machine_id):
    """Return assignment history for a machine as JSON."""
    from flask import jsonify
    machine = Machine.query.get_or_404(machine_id)
    history = (EquipmentAssignmentHistory.query
               .filter_by(machine_id=machine_id)
               .order_by(EquipmentAssignmentHistory.moved_at.desc())
               .all())
    return jsonify({
        'machine': {'id': machine.id, 'name': machine.name, 'plant_id': machine.plant_id},
        'history': [{
            'from': h.from_project.name if h.from_project else '— Unassigned —',
            'to': h.to_project.name if h.to_project else '— Unassigned —',
            'date': h.moved_at.strftime('%d/%m/%Y %H:%M') if h.moved_at else '—',
            'by': h.moved_by or '—',
        } for h in history],
    })


@equipment_bp.route('/equipment')
@require_role('admin', 'supervisor', 'site')
def equipment_overview():
    if current_user.role != 'admin':
        active_pid = get_active_project_id()
        if active_pid:
            assigned_ids = {pm.machine_id for pm in ProjectMachine.query.filter_by(project_id=active_pid).all()}
            own_machines = Machine.query.filter(Machine.id.in_(assigned_ids)).order_by(Machine.name).all()
            hired_machines = HiredMachine.query.filter_by(project_id=active_pid).order_by(HiredMachine.machine_name).all()
        else:
            own_machines = []
            hired_machines = []
    else:
        own_machines = Machine.query.order_by(Machine.name).all()
        hired_machines = HiredMachine.query.order_by(HiredMachine.machine_name).all()
    projects = Project.query.filter_by(active=True).order_by(Project.name).all()

    own_breakdowns = {b.machine_id: b for b in
                      MachineBreakdown.query.filter(
                          MachineBreakdown.machine_id.isnot(None),
                          MachineBreakdown.repair_status != 'completed'
                      ).all()}
    hired_breakdowns = {b.hired_machine_id: b for b in
                        MachineBreakdown.query.filter(
                            MachineBreakdown.hired_machine_id.isnot(None),
                            MachineBreakdown.repair_status != 'completed'
                        ).all()}

    # Direct project assignments (for the assign dropdown)
    all_pm = ProjectMachine.query.all()
    machine_assigned_project = {}
    for pm in all_pm:
        machine_assigned_project[pm.machine_id] = pm.project

    all_assignments = (ProjectEquipmentAssignment.query
                       .join(ProjectEquipmentRequirement)
                       .join(Project)
                       .filter(Project.active == True)
                       .all())
    own_machine_projects = {}
    hired_machine_projects = {}
    for a in all_assignments:
        entry = (a.requirement.project, a.requirement.label)
        if a.machine_id:
            own_machine_projects.setdefault(a.machine_id, []).append(entry)
        if a.hired_machine_id:
            hired_machine_projects.setdefault(a.hired_machine_id, []).append(entry)

    own_bd_history = defaultdict(list)
    for b in MachineBreakdown.query.filter(
            MachineBreakdown.machine_id.isnot(None)
    ).order_by(MachineBreakdown.incident_date.desc()).all():
        own_bd_history[b.machine_id].append(b)
    hired_bd_history = defaultdict(list)
    for b in MachineBreakdown.query.filter(
            MachineBreakdown.hired_machine_id.isnot(None)
    ).order_by(MachineBreakdown.incident_date.desc()).all():
        hired_bd_history[b.hired_machine_id].append(b)

    groups = MachineGroup.query.order_by(MachineGroup.name).all()

    return render_template('equipment/index.html',
                           own_machines=own_machines,
                           hired_machines=hired_machines,
                           groups=groups,
                           machine_assigned_project=machine_assigned_project,
                           projects=projects,
                           own_breakdowns=own_breakdowns,
                           hired_breakdowns=hired_breakdowns,
                           own_machine_projects=own_machine_projects,
                           hired_machine_projects=hired_machine_projects,
                           own_bd_history=own_bd_history,
                           hired_bd_history=hired_bd_history,
                           today=date.today())


@equipment_bp.route('/equipment/breakdown/add', methods=['POST'])
@require_role('admin', 'supervisor', 'site')
def breakdown_add():
    machine_id = request.form.get('machine_id') or None
    hired_machine_id = request.form.get('hired_machine_id') or None
    incident_date_str = request.form.get('incident_date', '').strip()
    try:
        incident_date = datetime.strptime(incident_date_str, '%Y-%m-%d').date()
    except ValueError:
        flash('Invalid date.', 'danger')
        return redirect(url_for('equipment.equipment_overview'))
    bd = MachineBreakdown(
        machine_id=int(machine_id) if machine_id else None,
        hired_machine_id=int(hired_machine_id) if hired_machine_id else None,
        incident_date=incident_date,
        incident_time=request.form.get('incident_time', '').strip() or None,
        description=request.form.get('description', '').strip() or None,
        repairing_by=request.form.get('repairing_by', '').strip() or None,
        repair_status=request.form.get('repair_status', 'pending'),
        anticipated_return=datetime.strptime(request.form['anticipated_return'], '%Y-%m-%d').date()
            if request.form.get('anticipated_return') else None,
    )
    db.session.add(bd)
    db.session.flush()
    photos = request.files.getlist('photos')
    for photo in photos:
        if photo and photo.filename:
            ext = os.path.splitext(photo.filename)[1].lower()
            stored = f"{uuid.uuid4()}{ext}"
            local_path = os.path.join(UPLOAD_FOLDER, 'breakdowns', stored)
            storage.upload_file(photo, f'breakdowns/{stored}', local_path)
            db.session.add(BreakdownPhoto(breakdown_id=bd.id, filename=stored, original_name=photo.filename))
    db.session.commit()
    flash('Breakdown recorded.', 'warning')
    return redirect(url_for('equipment.equipment_overview') + '#tab-own' if not hired_machine_id else '#tab-hired')


@equipment_bp.route('/equipment/breakdown/<int:bd_id>/update', methods=['POST'])
@require_role('admin', 'supervisor')
def breakdown_update(bd_id):
    bd = MachineBreakdown.query.get_or_404(bd_id)
    bd.repair_status = request.form.get('repair_status', bd.repair_status)
    bd.repairing_by = request.form.get('repairing_by', '').strip() or bd.repairing_by
    ret = request.form.get('anticipated_return', '').strip()
    if ret:
        try:
            bd.anticipated_return = datetime.strptime(ret, '%Y-%m-%d').date()
        except ValueError:
            pass
    if bd.repair_status == 'completed' and not bd.resolved_date:
        bd.resolved_date = date.today()
    db.session.commit()
    flash('Breakdown updated.', 'success')
    return redirect(url_for('equipment.equipment_overview'))


@equipment_bp.route('/equipment/breakdown-photo/<filename>')
@require_role('admin', 'supervisor', 'site')
def serve_breakdown_photo(filename):
    return storage.serve_file(
        f'breakdowns/{filename}',
        os.path.join(UPLOAD_FOLDER, 'breakdowns', filename)
    )


@equipment_bp.route('/equipment/breakdown/<int:bd_id>/delete', methods=['POST'])
@require_role('admin', 'supervisor')
def breakdown_delete(bd_id):
    bd = MachineBreakdown.query.get_or_404(bd_id)
    db.session.delete(bd)
    db.session.commit()
    flash('Breakdown record deleted.', 'success')
    return redirect(url_for('equipment.equipment_overview'))
