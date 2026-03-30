import os
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta

from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify
from flask_login import current_user

from blueprints.auth import require_role
from utils.helpers import get_active_project_id

from flask_login import current_user
from models import (db, Machine, MachineGroup, Project, HiredMachine, MachineBreakdown,
                    BreakdownPhoto, ProjectEquipmentAssignment, ProjectEquipmentRequirement,
                    ProjectMachine, EquipmentAssignmentHistory, User, DailyEntry,
                    MachineTransfer, SiteEquipmentChecklist, SiteEquipmentChecklistItem,
                    MachineDailyCheck, MachineDocument, MachineHoursLog,
                    ProjectDailyTaskAssignment)
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
        hired_machines = HiredMachine.query.filter_by(active=True).order_by(HiredMachine.machine_name).all()
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

    # ── Admin dashboard data (shown inline on the equipment page) ────────
    dashboard_data = None
    if current_user.role == 'admin':
        from sqlalchemy import func
        today_date = date.today()
        project_data = []
        total_incomplete_checks = 0
        total_open_breakdowns = 0

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

            active_checklists = SiteEquipmentChecklist.query.filter_by(
                project_id=p.id).filter(
                SiteEquipmentChecklist.completed_at.is_(None)).all()
            checklist_info = []
            for cl in active_checklists:
                total_items = len(cl.items)
                checked_items = sum(1 for i in cl.items if i.checked)
                checklist_info.append({
                    'id': cl.id, 'name': cl.checklist_name, 'due_date': cl.due_date,
                    'total': total_items, 'checked': checked_items,
                    'overdue': cl.due_date < today_date,
                })

            if total_machines > checks_today:
                total_incomplete_checks += 1
            total_open_breakdowns += open_bds

            site_manager_name = None
            if p.site_manager:
                site_manager_name = p.site_manager.display_name or p.site_manager.username

            project_data.append({
                'project': p, 'site_manager': site_manager_name,
                'total_machines': total_machines, 'checks_today': checks_today,
                'entry_submitted': entry_today is not None,
                'open_breakdowns': open_bds, 'checklists': checklist_info,
            })

        upcoming_checklists = SiteEquipmentChecklist.query.filter(
            SiteEquipmentChecklist.completed_at.is_(None),
            SiteEquipmentChecklist.due_date <= today_date + timedelta(days=7),
        ).count()

        alert_machines = Machine.query.filter(
            Machine.active == True,
            db.or_(
                db.and_(Machine.dispose_by_date.isnot(None),
                        Machine.dispose_by_date <= today_date + timedelta(days=30)),
                db.and_(Machine.next_inspection_date.isnot(None),
                        Machine.next_inspection_date <= today_date + timedelta(days=14)),
            )
        ).order_by(Machine.dispose_by_date, Machine.next_inspection_date).all()

        pending_transfers = MachineTransfer.query.filter(
            MachineTransfer.status.in_(['scheduled', 'in_transit'])
        ).order_by(MachineTransfer.scheduled_date).all()

        dashboard_data = {
            'project_data': project_data,
            'total_incomplete_checks': total_incomplete_checks,
            'total_open_breakdowns': total_open_breakdowns,
            'total_overdue_checklists': upcoming_checklists,
            'flagged_machines': len(alert_machines),
            'alert_machines': alert_machines,
            'pending_transfers': pending_transfers,
        }

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
                           today=date.today(),
                           dashboard=dashboard_data)


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


# ---------------------------------------------------------------------------
# Checklist routes
# ---------------------------------------------------------------------------

@equipment_bp.route('/equipment/checklist/create', methods=['POST'])
@require_role('admin')
def checklist_create():
    """Admin creates a new site equipment checklist for a project."""
    project_id = request.form.get('project_id', type=int)
    checklist_name = request.form.get('checklist_name', '').strip()
    due_date_str = request.form.get('due_date', '').strip()
    notes = request.form.get('notes', '').strip() or None

    if not project_id or not checklist_name or not due_date_str:
        flash('Project, name, and due date are required.', 'danger')
        return redirect(url_for('equipment.equipment_overview'))

    try:
        due_date = datetime.strptime(due_date_str, '%Y-%m-%d').date()
    except ValueError:
        flash('Invalid date.', 'danger')
        return redirect(url_for('equipment.equipment_overview'))

    project = Project.query.get_or_404(project_id)
    cl = SiteEquipmentChecklist(
        project_id=project_id,
        checklist_name=checklist_name,
        due_date=due_date,
        created_by_user_id=current_user.id,
        notes=notes,
    )
    db.session.add(cl)
    db.session.flush()

    # Auto-populate items for all machines assigned to this project
    assigned_own = ProjectMachine.query.filter_by(project_id=project_id).all()
    for pm in assigned_own:
        label = pm.machine.name
        if pm.machine.plant_id:
            label += f' ({pm.machine.plant_id})'
        db.session.add(SiteEquipmentChecklistItem(
            checklist_id=cl.id,
            machine_id=pm.machine_id,
            machine_label=label,
        ))

    hired = HiredMachine.query.filter_by(project_id=project_id, active=True).all()
    for hm in hired:
        label = hm.machine_name
        if hm.plant_id:
            label += f' ({hm.plant_id})'
        db.session.add(SiteEquipmentChecklistItem(
            checklist_id=cl.id,
            hired_machine_id=hm.id,
            machine_label=label,
        ))

    db.session.commit()
    flash(f'Checklist "{checklist_name}" created with {len(assigned_own) + len(hired)} items.', 'success')
    return redirect(url_for('equipment.checklist_view', checklist_id=cl.id))


@equipment_bp.route('/equipment/checklist/<int:checklist_id>')
@require_role('admin', 'supervisor', 'site')
def checklist_view(checklist_id):
    """View a checklist with all items and completion status."""
    cl = SiteEquipmentChecklist.query.get_or_404(checklist_id)
    items = SiteEquipmentChecklistItem.query.filter_by(checklist_id=checklist_id).all()
    total = len(items)
    checked_count = sum(1 for i in items if i.checked)
    return render_template('equipment/checklist_view.html',
                           checklist=cl, items=items,
                           total=total, checked_count=checked_count)


@equipment_bp.route('/equipment/checklist/<int:checklist_id>/item/<int:item_id>/check', methods=['POST'])
@require_role('admin', 'supervisor')
def checklist_item_check(checklist_id, item_id):
    """Supervisor marks a checklist item as checked."""
    item = SiteEquipmentChecklistItem.query.get_or_404(item_id)
    if item.checklist_id != checklist_id:
        flash('Invalid checklist item.', 'danger')
        return redirect(url_for('equipment.checklist_view', checklist_id=checklist_id))

    condition = request.form.get('condition', 'good')
    notes = request.form.get('notes', '').strip() or None

    item.checked = True
    item.checked_by_user_id = current_user.id
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

    # If condition is poor or broken_down, create a breakdown record
    if condition in ('poor', 'broken_down'):
        bd = MachineBreakdown(
            machine_id=item.machine_id,
            hired_machine_id=item.hired_machine_id,
            incident_date=date.today(),
            description=f'Flagged during checklist: {item.checklist.checklist_name}. Condition: {condition}. {notes or ""}',
            repair_status='pending',
        )
        db.session.add(bd)
        db.session.flush()

        # Send notification to admin
        try:
            from utils.notifications import notify_breakdown_to_admin
            machine_name = item.machine_label
            project_name = item.checklist.project.name if item.checklist.project else 'Unknown'
            notify_breakdown_to_admin(bd, machine_name, project_name)
        except Exception:
            pass

    # Check if all items are now done
    cl = SiteEquipmentChecklist.query.get(checklist_id)
    unchecked = SiteEquipmentChecklistItem.query.filter_by(
        checklist_id=checklist_id, checked=False).count()
    if unchecked == 0:
        cl.completed_at = datetime.utcnow()

    db.session.commit()
    flash(f'Item "{item.machine_label}" checked.', 'success')
    return redirect(url_for('equipment.checklist_view', checklist_id=checklist_id))


@equipment_bp.route('/equipment/checklist/<int:checklist_id>/delete', methods=['POST'])
@require_role('admin')
def checklist_delete(checklist_id):
    """Admin deletes a checklist."""
    cl = SiteEquipmentChecklist.query.get_or_404(checklist_id)
    db.session.delete(cl)
    db.session.commit()
    flash('Checklist deleted.', 'info')
    return redirect(url_for('equipment.equipment_overview'))


# ---------------------------------------------------------------------------
# Transfer routes
# ---------------------------------------------------------------------------

@equipment_bp.route('/equipment/transfer/schedule', methods=['POST'])
@require_role('admin', 'supervisor')
def transfer_schedule():
    """Schedule a machine transfer between projects."""
    machine_id = request.form.get('machine_id', type=int)
    from_project_id = request.form.get('from_project_id', type=int)
    to_project_id = request.form.get('to_project_id', type=int)
    scheduled_date_str = request.form.get('scheduled_date', '').strip()
    travel_notes = request.form.get('travel_notes', '').strip() or None
    transport_contact = request.form.get('transport_contact', '').strip() or None

    if not machine_id or not scheduled_date_str:
        flash('Machine and scheduled date are required.', 'danger')
        return redirect(url_for('equipment.equipment_overview'))

    try:
        scheduled_date = datetime.strptime(scheduled_date_str, '%Y-%m-%d').date()
    except ValueError:
        flash('Invalid date.', 'danger')
        return redirect(url_for('equipment.equipment_overview'))

    machine = Machine.query.get_or_404(machine_id)

    # Validate machine is currently assigned to from_project
    if from_project_id:
        existing = ProjectMachine.query.filter_by(
            machine_id=machine_id, project_id=from_project_id).first()
        if not existing:
            flash(f'Machine "{machine.name}" is not assigned to the selected source project.', 'danger')
            return redirect(url_for('equipment.equipment_overview'))

    transfer = MachineTransfer(
        machine_id=machine_id,
        from_project_id=from_project_id or None,
        to_project_id=to_project_id or None,
        scheduled_date=scheduled_date,
        travel_notes=travel_notes,
        transport_contact=transport_contact,
        created_by=current_user.display_name or current_user.username,
    )
    db.session.add(transfer)
    db.session.commit()
    flash(f'Transfer scheduled for "{machine.name}".', 'success')
    return redirect(url_for('equipment.equipment_overview'))


@equipment_bp.route('/equipment/transfer/<int:transfer_id>/update', methods=['POST'])
@require_role('admin', 'supervisor')
def transfer_update(transfer_id):
    """Update transfer status. When completed, update ProjectMachine and log history."""
    transfer = MachineTransfer.query.get_or_404(transfer_id)
    new_status = request.form.get('status', transfer.status)
    transfer.status = new_status

    if new_status == 'completed' and not transfer.completed_at:
        transfer.completed_at = datetime.utcnow()

        # Update ProjectMachine
        existing = ProjectMachine.query.filter_by(machine_id=transfer.machine_id).first()
        if transfer.to_project_id:
            if existing:
                existing.project_id = transfer.to_project_id
            else:
                db.session.add(ProjectMachine(
                    project_id=transfer.to_project_id,
                    machine_id=transfer.machine_id,
                ))
        elif existing:
            db.session.delete(existing)

        # Log assignment history
        db.session.add(EquipmentAssignmentHistory(
            machine_id=transfer.machine_id,
            from_project_id=transfer.from_project_id,
            to_project_id=transfer.to_project_id,
            moved_by=current_user.display_name or current_user.username,
        ))

    db.session.commit()
    flash(f'Transfer updated to {new_status}.', 'success')
    return redirect(url_for('equipment.equipment_overview'))


# ---------------------------------------------------------------------------
# Daily check routes
# ---------------------------------------------------------------------------

@equipment_bp.route('/equipment/daily-check/submit', methods=['POST'])
@require_role('admin', 'supervisor')
def daily_check_submit():
    """Supervisor submits a daily check for one machine."""
    machine_id = request.form.get('machine_id', type=int)
    hired_machine_id = request.form.get('hired_machine_id', type=int)
    project_id = request.form.get('project_id', type=int)
    condition = request.form.get('condition', 'good')
    notes = request.form.get('notes', '').strip() or None

    if not project_id or (not machine_id and not hired_machine_id):
        flash('Project and machine are required.', 'danger')
        return redirect(url_for('equipment.equipment_overview'))

    check = MachineDailyCheck(
        machine_id=machine_id or None,
        hired_machine_id=hired_machine_id or None,
        project_id=project_id,
        check_date=date.today(),
        checked_by_user_id=current_user.id,
        condition=condition,
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

    # If broken_down, auto-create a breakdown
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

        try:
            from utils.notifications import notify_breakdown_to_admin
            project = Project.query.get(project_id)
            notify_breakdown_to_admin(bd, machine_name, project.name if project else 'Unknown')
        except Exception:
            pass

    db.session.add(check)
    db.session.commit()
    flash('Daily check recorded.', 'success')
    return redirect(url_for('equipment.equipment_overview'))


# ---------------------------------------------------------------------------
# Machine detail edit
# ---------------------------------------------------------------------------

@equipment_bp.route('/equipment/machine/<int:machine_id>/edit-details', methods=['POST'])
@require_role('admin')
def machine_edit_details(machine_id):
    """Edit the extended machine detail fields."""
    m = Machine.query.get_or_404(machine_id)

    for field in ('serial_number', 'manufacturer', 'model_number',
                  'storage_instructions', 'service_instructions',
                  'spare_parts_notes', 'disposal_procedure'):
        val = request.form.get(field, '').strip()
        setattr(m, field, val if val else None)

    for date_field in ('acquired_date', 'dispose_by_date', 'next_inspection_date'):
        val = request.form.get(date_field, '').strip()
        if val:
            try:
                setattr(m, date_field, datetime.strptime(val, '%Y-%m-%d').date())
            except ValueError:
                pass
        else:
            setattr(m, date_field, None)

    interval = request.form.get('inspection_interval_days', '').strip()
    m.inspection_interval_days = int(interval) if interval else None

    db.session.commit()
    flash(f'Details updated for "{m.name}".', 'success')

    # Redirect back to the referrer if available, else admin dashboard
    return redirect(request.referrer or url_for('equipment.equipment_overview'))


# ---------------------------------------------------------------------------
# Admin dashboard
# ---------------------------------------------------------------------------

@equipment_bp.route('/equipment/admin-dashboard')
@require_role('admin')
def admin_dashboard():
    """Redirect to consolidated equipment page."""
    return redirect(url_for('equipment.equipment_overview'))


# ---------------------------------------------------------------------------
# Checklist photo serving
# ---------------------------------------------------------------------------

@equipment_bp.route('/equipment/checklist-photo/<filename>')
@require_role('admin', 'supervisor', 'site')
def serve_checklist_photo(filename):
    return storage.serve_file(
        f'checklists/{filename}',
        os.path.join(UPLOAD_FOLDER, 'checklists', filename)
    )


@equipment_bp.route('/equipment/daily-check-photo/<filename>')
@require_role('admin', 'supervisor', 'site')
def serve_daily_check_photo(filename):
    return storage.serve_file(
        f'daily_checks/{filename}',
        os.path.join(UPLOAD_FOLDER, 'daily_checks', filename)
    )


# ---------------------------------------------------------------------------
# Machine detail page (comprehensive single-machine view)
# ---------------------------------------------------------------------------

@equipment_bp.route('/equipment/machine/<int:machine_id>')
@require_role('admin', 'supervisor', 'site')
def machine_detail(machine_id):
    """Full machine detail page with documents, hours, lifecycle, checks."""
    m = Machine.query.get_or_404(machine_id)
    docs = MachineDocument.query.filter_by(machine_id=machine_id).order_by(MachineDocument.uploaded_at.desc()).all()
    hours_logs = MachineHoursLog.query.filter_by(machine_id=machine_id).order_by(MachineHoursLog.log_date.desc()).limit(30).all()
    recent_checks = MachineDailyCheck.query.filter_by(machine_id=machine_id).order_by(MachineDailyCheck.check_date.desc()).limit(14).all()
    breakdowns = MachineBreakdown.query.filter_by(machine_id=machine_id).order_by(MachineBreakdown.incident_date.desc()).all()
    assignment = ProjectMachine.query.filter_by(machine_id=machine_id).first()
    transfers = MachineTransfer.query.filter(
        MachineTransfer.machine_id == machine_id,
        MachineTransfer.status.in_(['scheduled', 'in_transit'])
    ).all()
    projects = Project.query.filter_by(active=True).order_by(Project.name).all()

    return render_template('equipment/machine_detail.html',
                           machine=m, docs=docs, hours_logs=hours_logs,
                           recent_checks=recent_checks, breakdowns=breakdowns,
                           assignment=assignment, transfers=transfers,
                           projects=projects, today=date.today())


# ---------------------------------------------------------------------------
# Machine document management
# ---------------------------------------------------------------------------

@equipment_bp.route('/equipment/machine/<int:machine_id>/document/upload', methods=['POST'])
@require_role('admin', 'supervisor')
def machine_document_upload(machine_id):
    """Upload a document or photo to a machine."""
    m = Machine.query.get_or_404(machine_id)
    file = request.files.get('file')
    if not file or not file.filename:
        flash('No file selected.', 'danger')
        return redirect(url_for('equipment.machine_detail', machine_id=machine_id))

    doc_type = request.form.get('doc_type', 'other')
    title = request.form.get('title', '').strip() or file.filename
    notes = request.form.get('notes', '').strip() or None

    ext = os.path.splitext(file.filename)[1].lower()
    stored = f"{uuid.uuid4()}{ext}"
    local_path = os.path.join(UPLOAD_FOLDER, 'machine_docs', stored)
    storage.upload_file(file, f'machine_docs/{stored}', local_path)

    doc = MachineDocument(
        machine_id=machine_id,
        filename=stored,
        original_name=file.filename,
        doc_type=doc_type,
        title=title,
        notes=notes,
        uploaded_by_user_id=current_user.id,
    )
    db.session.add(doc)
    db.session.commit()
    flash(f'Document "{title}" uploaded.', 'success')
    return redirect(url_for('equipment.machine_detail', machine_id=machine_id))


@equipment_bp.route('/equipment/machine-doc/<filename>')
@require_role('admin', 'supervisor', 'site')
def serve_machine_doc(filename):
    return storage.serve_file(
        f'machine_docs/{filename}',
        os.path.join(UPLOAD_FOLDER, 'machine_docs', filename)
    )


@equipment_bp.route('/equipment/machine/<int:machine_id>/document/<int:doc_id>/delete', methods=['POST'])
@require_role('admin')
def machine_document_delete(machine_id, doc_id):
    doc = MachineDocument.query.get_or_404(doc_id)
    if doc.machine_id != machine_id:
        flash('Invalid document.', 'danger')
        return redirect(url_for('equipment.machine_detail', machine_id=machine_id))
    storage.delete_file(f'machine_docs/{doc.filename}',
                        os.path.join(UPLOAD_FOLDER, 'machine_docs', doc.filename))
    db.session.delete(doc)
    db.session.commit()
    flash('Document deleted.', 'info')
    return redirect(url_for('equipment.machine_detail', machine_id=machine_id))


# ---------------------------------------------------------------------------
# Task assignments (admin assigns who does daily entry / machine startup)
# ---------------------------------------------------------------------------

@equipment_bp.route('/equipment/task-assignment/save', methods=['POST'])
@require_role('admin')
def task_assignment_save():
    """Save or update daily task assignments for a project."""
    project_id = request.form.get('project_id', type=int)
    if not project_id:
        flash('Project is required.', 'danger')
        return redirect(request.referrer or url_for('main.index'))

    for task_type in ('daily_entry', 'machine_startup'):
        user_id = request.form.get(f'{task_type}_user_id', type=int)
        existing = ProjectDailyTaskAssignment.query.filter_by(
            project_id=project_id, task_type=task_type).first()
        if user_id:
            if existing:
                existing.assigned_user_id = user_id
                existing.active = True
            else:
                db.session.add(ProjectDailyTaskAssignment(
                    project_id=project_id,
                    task_type=task_type,
                    assigned_user_id=user_id,
                ))
        elif existing:
            existing.active = False

    db.session.commit()
    flash('Task assignments updated.', 'success')
    return redirect(request.referrer or url_for('main.index'))


# ---------------------------------------------------------------------------
# Admin edit/delete for daily checks and hours logs
# ---------------------------------------------------------------------------

@equipment_bp.route('/equipment/daily-check/<int:check_id>/delete', methods=['POST'])
@require_role('admin')
def daily_check_delete(check_id):
    """Admin deletes a daily check record."""
    check = MachineDailyCheck.query.get_or_404(check_id)
    machine_id = check.machine_id
    # Also delete linked hours log
    if check.hours_log:
        for hl in check.hours_log:
            db.session.delete(hl)
    db.session.delete(check)
    db.session.commit()
    flash('Daily check deleted.', 'info')
    if machine_id:
        return redirect(url_for('equipment.machine_detail', machine_id=machine_id))
    return redirect(url_for('equipment.equipment_overview'))


@equipment_bp.route('/equipment/daily-check/<int:check_id>/edit', methods=['POST'])
@require_role('admin')
def daily_check_edit(check_id):
    """Admin edits a daily check record."""
    check = MachineDailyCheck.query.get_or_404(check_id)
    condition = request.form.get('condition')
    if condition:
        check.condition = condition
    notes = request.form.get('notes', '').strip()
    check.notes = notes if notes else check.notes
    hours_str = request.form.get('hours_reading', '').strip()
    if hours_str:
        check.hours_reading = float(hours_str)
        # Update linked hours log if exists
        for hl in (check.hours_log or []):
            hl.hours_reading = float(hours_str)
    db.session.commit()
    flash('Daily check updated.', 'success')
    if check.machine_id:
        return redirect(url_for('equipment.machine_detail', machine_id=check.machine_id))
    return redirect(url_for('equipment.equipment_overview'))


@equipment_bp.route('/equipment/hours-log/<int:log_id>/delete', methods=['POST'])
@require_role('admin')
def hours_log_delete(log_id):
    """Admin deletes a hours log entry."""
    log = MachineHoursLog.query.get_or_404(log_id)
    machine_id = log.machine_id
    db.session.delete(log)
    db.session.commit()
    flash('Hours log entry deleted.', 'info')
    return redirect(url_for('equipment.machine_detail', machine_id=machine_id))
