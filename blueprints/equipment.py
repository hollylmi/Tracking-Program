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
                    ProjectDailyTaskAssignment, ScheduledEquipmentCheck,
                    ScheduledCheckCompletion, TransferBatch)
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

    # ── Project colour map (matches scheduling page) ───────────────────
    EQUIP_PALETTE = [
        ('#cfe2ff', '#084298'),  # blue
        ('#d1e7dd', '#0a3622'),  # green
        ('#f8d7da', '#842029'),  # red
        ('#fff3cd', '#664d03'),  # yellow
        ('#d2f4ea', '#0b4c34'),  # teal
        ('#fde8d8', '#6c3a00'),  # orange
        ('#e2d9f3', '#3d1a78'),  # purple
        ('#dee2e6', '#343a40'),  # grey
    ]
    all_proj_ordered = Project.query.order_by(Project.id).all()
    project_colour_map = {
        p.id: EQUIP_PALETTE[i % len(EQUIP_PALETTE)]
        for i, p in enumerate(all_proj_ordered)
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
                           dashboard=dashboard_data,
                           project_colour_map=project_colour_map)


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
    """Schedule a transfer batch — one or more machines between projects."""
    from_project_id = request.form.get('from_project_id', type=int)
    to_project_id = request.form.get('to_project_id', type=int)
    scheduled_date_str = request.form.get('scheduled_date', '').strip()
    travel_notes = request.form.get('travel_notes', '').strip() or None
    transport_contact = request.form.get('transport_contact', '').strip() or None
    pre_check_user_id = request.form.get('pre_check_user_id', type=int)
    arrival_user_id = request.form.get('arrival_user_id', type=int)
    transport_user_ids = ','.join(request.form.getlist('transport_user_ids'))
    pickup_location = request.form.get('pickup_location', '').strip() or None
    dropoff_location = request.form.get('dropoff_location', '').strip() or None

    # Support both single machine_id and multiple machine_ids
    machine_ids = request.form.getlist('machine_ids', type=int)
    single_id = request.form.get('machine_id', type=int)
    if single_id and single_id not in machine_ids:
        machine_ids.append(single_id)

    if not machine_ids or not scheduled_date_str:
        flash('At least one machine and a scheduled date are required.', 'danger')
        return redirect(request.referrer or url_for('equipment.operations_dashboard'))

    try:
        scheduled_date = datetime.strptime(scheduled_date_str, '%Y-%m-%d').date()
    except ValueError:
        flash('Invalid date.', 'danger')
        return redirect(request.referrer or url_for('equipment.operations_dashboard'))

    # Auto-fill locations from project addresses if not provided
    if not pickup_location and from_project_id:
        src = Project.query.get(from_project_id)
        if src and src.site_address:
            pickup_location = src.site_address
    if not dropoff_location and to_project_id:
        dst = Project.query.get(to_project_id)
        if dst and dst.site_address:
            dropoff_location = dst.site_address

    batch = TransferBatch(
        from_project_id=from_project_id or None,
        to_project_id=to_project_id or None,
        scheduled_date=scheduled_date,
        pickup_location=pickup_location,
        dropoff_location=dropoff_location,
        travel_notes=travel_notes,
        transport_contact=transport_contact,
        pre_check_user_id=pre_check_user_id or None,
        arrival_user_id=arrival_user_id or None,
        transport_user_ids=transport_user_ids or None,
        created_by=current_user.display_name or current_user.username,
    )
    db.session.add(batch)
    db.session.flush()

    for mid in machine_ids:
        db.session.add(MachineTransfer(
            batch_id=batch.id,
            machine_id=mid,
            from_project_id=from_project_id or None,
            to_project_id=to_project_id or None,
            scheduled_date=scheduled_date,
            travel_notes=travel_notes,
            transport_contact=transport_contact,
            created_by=current_user.display_name or current_user.username,
        ))

    db.session.commit()
    flash(f'Transfer scheduled for {len(machine_ids)} machine(s).', 'success')
    return redirect(url_for('equipment.transfer_batch_detail', batch_id=batch.id))


@equipment_bp.route('/equipment/transfer/<int:transfer_id>/update', methods=['POST'])
@require_role('admin', 'supervisor')
def transfer_update(transfer_id):
    """Update transfer status."""
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
    return redirect(request.referrer or url_for('equipment.operations_dashboard'))


@equipment_bp.route('/equipment/transfer/<int:transfer_id>/pre-check', methods=['POST'])
@require_role('admin', 'supervisor', 'site')
def transfer_pre_check(transfer_id):
    """Record pre-move check before transport."""
    transfer = MachineTransfer.query.get_or_404(transfer_id)
    condition = request.form.get('condition', 'good')
    notes = request.form.get('notes', '').strip() or None
    hours_str = request.form.get('hours_reading', '').strip()
    hours_reading = float(hours_str) if hours_str else None

    # Create or update a daily check record for this machine
    project_id = transfer.from_project_id or transfer.to_project_id
    check = MachineDailyCheck.query.filter_by(
        machine_id=transfer.machine_id, project_id=project_id, check_date=date.today()
    ).first()
    if check:
        check.condition = condition
        check.hours_reading = hours_reading
        check.notes = f'Pre-transfer check. {notes or ""}'
        check.checked_by_user_id = current_user.id
    else:
        check = MachineDailyCheck(
            machine_id=transfer.machine_id,
            project_id=project_id,
            check_date=date.today(),
            checked_by_user_id=current_user.id,
            condition=condition,
            hours_reading=hours_reading,
            notes=f'Pre-transfer check. {notes or ""}',
        )
        db.session.add(check)

    photo = request.files.get('photo')
    if photo and photo.filename:
        ext = os.path.splitext(photo.filename)[1].lower()
        stored = f"{uuid.uuid4()}{ext}"
        local_path = os.path.join(UPLOAD_FOLDER, 'daily_checks', stored)
        storage.upload_file(photo, f'daily_checks/{stored}', local_path)
        check.photo_filename = stored
        check.photo_original_name = photo.filename

    db.session.flush()
    transfer.pre_check_id = check.id
    transfer.pre_check_notes = notes

    # Log hours
    if hours_reading is not None:
        db.session.add(MachineHoursLog(
            machine_id=transfer.machine_id,
            project_id=transfer.from_project_id,
            log_date=date.today(),
            hours_reading=hours_reading,
            recorded_by_user_id=current_user.id,
            daily_check_id=check.id,
        ))

    # If all machines in the batch are pre-checked, mark batch as in_transit
    if transfer.batch_id:
        batch = TransferBatch.query.get(transfer.batch_id)
        if batch and all(t.pre_check_id for t in batch.items):
            batch.status = 'in_transit'
            for t in batch.items:
                t.status = 'in_transit'
    else:
        transfer.status = 'in_transit'

    db.session.commit()
    machine_name = transfer.machine.name if transfer.machine else 'Machine'
    flash(f'Pre-transfer check recorded for {machine_name}.', 'success')
    if transfer.batch_id:
        return redirect(url_for('equipment.transfer_batch_detail', batch_id=transfer.batch_id))
    return redirect(request.referrer or url_for('equipment.operations_dashboard'))


@equipment_bp.route('/equipment/transfer/<int:transfer_id>/arrive', methods=['POST'])
@require_role('admin', 'supervisor', 'site')
def transfer_arrive(transfer_id):
    """Mark machine as arrived at destination and record arrival check."""
    transfer = MachineTransfer.query.get_or_404(transfer_id)
    condition = request.form.get('condition', 'good')
    notes = request.form.get('notes', '').strip() or None
    hours_str = request.form.get('hours_reading', '').strip()
    hours_reading = float(hours_str) if hours_str else None

    dest_project_id = transfer.to_project_id or transfer.from_project_id
    check = MachineDailyCheck.query.filter_by(
        machine_id=transfer.machine_id, project_id=dest_project_id, check_date=date.today()
    ).first()
    if check:
        check.condition = condition
        check.hours_reading = hours_reading
        check.notes = f'Arrival check after transfer. {notes or ""}'
        check.checked_by_user_id = current_user.id
    else:
        check = MachineDailyCheck(
            machine_id=transfer.machine_id,
            project_id=dest_project_id,
            check_date=date.today(),
            checked_by_user_id=current_user.id,
            condition=condition,
            hours_reading=hours_reading,
            notes=f'Arrival check after transfer. {notes or ""}',
        )
        db.session.add(check)

    photo = request.files.get('photo')
    if photo and photo.filename:
        ext = os.path.splitext(photo.filename)[1].lower()
        stored = f"{uuid.uuid4()}{ext}"
        local_path = os.path.join(UPLOAD_FOLDER, 'daily_checks', stored)
        storage.upload_file(photo, f'daily_checks/{stored}', local_path)
        check.photo_filename = stored
        check.photo_original_name = photo.filename

    db.session.add(check)
    db.session.flush()

    transfer.arrival_check_id = check.id
    transfer.arrival_check_notes = notes
    transfer.arrived_by_user_id = current_user.id
    transfer.arrived_at = datetime.utcnow()
    transfer.status = 'completed'
    transfer.completed_at = datetime.utcnow()

    # Update ProjectMachine assignment
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

    db.session.add(EquipmentAssignmentHistory(
        machine_id=transfer.machine_id,
        from_project_id=transfer.from_project_id,
        to_project_id=transfer.to_project_id,
        moved_by=current_user.display_name or current_user.username,
    ))

    if hours_reading is not None:
        db.session.add(MachineHoursLog(
            machine_id=transfer.machine_id,
            project_id=transfer.to_project_id,
            log_date=date.today(),
            hours_reading=hours_reading,
            recorded_by_user_id=current_user.id,
            daily_check_id=check.id,
        ))

    # If all machines in the batch have arrived, mark batch complete
    if transfer.batch_id:
        batch = TransferBatch.query.get(transfer.batch_id)
        if batch and all(t.arrival_check_id for t in batch.items):
            batch.status = 'completed'
            batch.completed_at = datetime.utcnow()

    db.session.commit()
    machine_name = transfer.machine.name if transfer.machine else 'Machine'
    flash(f'{machine_name} arrived and checked.', 'success')
    if transfer.batch_id:
        return redirect(url_for('equipment.transfer_batch_detail', batch_id=transfer.batch_id))
    return redirect(request.referrer or url_for('equipment.operations_dashboard'))


@equipment_bp.route('/equipment/transfer/<int:transfer_id>')
@require_role('admin', 'supervisor', 'site')
def transfer_detail(transfer_id):
    """View single transfer — redirect to batch if it has one."""
    transfer = MachineTransfer.query.get_or_404(transfer_id)
    if transfer.batch_id:
        return redirect(url_for('equipment.transfer_batch_detail', batch_id=transfer.batch_id))
    return render_template('equipment/transfer_detail.html', transfer=transfer, today=date.today())


@equipment_bp.route('/equipment/transfer-batch/<int:batch_id>')
@require_role('admin', 'supervisor', 'site')
def transfer_batch_detail(batch_id):
    """View a transfer batch with all machines and check status."""
    batch = TransferBatch.query.get_or_404(batch_id)
    users = User.query.filter_by(active=True).order_by(User.display_name).all()
    # Parse transport user IDs
    transport_users = []
    if batch.transport_user_ids:
        tids = [int(x) for x in batch.transport_user_ids.split(',') if x.strip()]
        transport_users = User.query.filter(User.id.in_(tids)).all() if tids else []

    # Check if pre-checks are available (within 24h of scheduled date)
    pre_check_window = batch.scheduled_date - timedelta(days=1) <= date.today()
    # Check if arrival checks are available (in transit)
    arrival_window = batch.status == 'in_transit'

    return render_template('equipment/transfer_batch_detail.html',
                           batch=batch, users=users, transport_users=transport_users,
                           pre_check_window=pre_check_window, arrival_window=arrival_window,
                           today=date.today())


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
    hours_str = request.form.get('hours_reading', '').strip()
    hours_reading = float(hours_str) if hours_str else None

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
    db.session.flush()

    # Auto-log hours
    if hours_reading is not None and (machine_id or hired_machine_id):
        mid = machine_id or None
        if mid:
            db.session.add(MachineHoursLog(
                machine_id=mid, project_id=project_id, log_date=date.today(),
                hours_reading=hours_reading, recorded_by_user_id=current_user.id,
                daily_check_id=check.id,
            ))

    db.session.commit()
    flash('Daily check recorded.', 'success')
    # Redirect back to the checks page if we came from there
    if request.referrer and 'daily-checks/do' in request.referrer:
        return redirect(request.referrer)
    return redirect(url_for('equipment.daily_checks_do', project_id=project_id))


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

    # Handle photo upload
    photo = request.files.get('photo')
    if photo and photo.filename:
        import uuid
        ext = os.path.splitext(photo.filename)[1].lower()
        if ext in ('.jpg', '.jpeg', '.png', '.gif', '.webp'):
            stored_name = f"machine_{uuid.uuid4().hex}{ext}"
            photo_dir = os.path.join(UPLOAD_FOLDER, 'machine_photos')
            os.makedirs(photo_dir, exist_ok=True)
            photo.save(os.path.join(photo_dir, stored_name))
            # Remove old photo if exists
            if m.photo_filename:
                try:
                    os.remove(os.path.join(photo_dir, m.photo_filename))
                except OSError:
                    pass
            m.photo_filename = stored_name
            m.photo_original_name = photo.filename

    # Handle photo removal
    if request.form.get('remove_photo') == '1' and m.photo_filename:
        photo_dir = os.path.join(UPLOAD_FOLDER, 'machine_photos')
        try:
            os.remove(os.path.join(photo_dir, m.photo_filename))
        except OSError:
            pass
        m.photo_filename = None
        m.photo_original_name = None

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


@equipment_bp.route('/equipment/machine-photo/<filename>')
@require_role('admin', 'supervisor', 'site')
def serve_machine_photo(filename):
    return storage.serve_file(
        f'machine_photos/{filename}',
        os.path.join(UPLOAD_FOLDER, 'machine_photos', filename)
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
@require_role('admin', 'supervisor')
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
    if request.referrer and 'daily-checks' in request.referrer:
        return redirect(request.referrer)
    if machine_id:
        return redirect(url_for('equipment.machine_detail', machine_id=machine_id))
    return redirect(url_for('equipment.equipment_overview'))


@equipment_bp.route('/equipment/daily-check/<int:check_id>/edit', methods=['POST'])
@require_role('admin', 'supervisor')
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
    if request.referrer and 'daily-checks' in request.referrer:
        return redirect(request.referrer)
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


# ---------------------------------------------------------------------------
# Daily checks — do checks (web interface for supervisors)
# ---------------------------------------------------------------------------

@equipment_bp.route('/equipment/daily-checks/do')
@require_role('admin', 'supervisor', 'site')
def daily_checks_do():
    """Web page where supervisors do their daily machine checks."""
    project_id = request.args.get('project_id', type=int)
    if not project_id:
        # For non-admins, use their active project
        if current_user.role != 'admin':
            project_id = get_active_project_id()
        if not project_id:
            flash('Please select a project.', 'warning')
            return redirect(url_for('equipment.equipment_overview'))

    project = Project.query.get_or_404(project_id)
    check_date = date.today()

    # All machines assigned to this project
    own_assignments = ProjectMachine.query.filter_by(project_id=project_id).all()
    hired_machines_list = HiredMachine.query.filter_by(project_id=project_id, active=True).all()

    # Today's checks
    checks = MachineDailyCheck.query.filter_by(project_id=project_id, check_date=check_date).all()
    check_by_machine = {c.machine_id: c for c in checks if c.machine_id}
    check_by_hired = {c.hired_machine_id: c for c in checks if c.hired_machine_id}

    # Pending transfers for these machines
    machine_ids = [pm.machine_id for pm in own_assignments]
    pending_transfers = {}
    if machine_ids:
        for t in MachineTransfer.query.filter(
            MachineTransfer.machine_id.in_(machine_ids),
            MachineTransfer.status.in_(['scheduled', 'in_transit'])
        ).all():
            pending_transfers[t.machine_id] = t

    machines = []
    for pm in own_assignments:
        m = pm.machine
        dc = check_by_machine.get(m.id)
        alerts = []
        if m.next_inspection_date:
            days = (m.next_inspection_date - check_date).days
            if days <= 14:
                alerts.append({'type': 'inspection', 'message': f'Inspection due in {days} days' if days > 0 else 'Inspection overdue', 'urgency': 'danger' if days <= 3 else 'warning'})
        if m.dispose_by_date:
            days = (m.dispose_by_date - check_date).days
            if days <= 30:
                alerts.append({'type': 'disposal', 'message': f'Disposal in {days} days' if days > 0 else 'Disposal overdue', 'urgency': 'danger' if days <= 7 else 'warning'})

        transfer = pending_transfers.get(m.id)
        transfer_info = None
        if transfer:
            transfer_info = {
                'to_project': transfer.to_project.name if transfer.to_project else 'Unassigned',
                'scheduled_date': transfer.scheduled_date.strftime('%d/%m/%Y'),
            }

        machines.append({
            'machine_id': m.id, 'hired_machine_id': None, 'name': m.name,
            'plant_id': m.plant_id, 'type': m.machine_type, 'source': 'fleet',
            'alerts': alerts, 'pending_transfer': transfer_info,
            'check': {
                'id': dc.id, 'condition': dc.condition, 'hours_reading': dc.hours_reading,
                'notes': dc.notes,
                'checked_by': (dc.checked_by_user.display_name or dc.checked_by_user.username) if dc.checked_by_user else None,
                'checked_at': dc.created_at.strftime('%H:%M') if dc.created_at else None,
                'photo_url': url_for('equipment.serve_daily_check_photo', filename=dc.photo_filename) if dc.photo_filename else None,
            } if dc else None,
        })

    for hm in hired_machines_list:
        dc = check_by_hired.get(hm.id)
        machines.append({
            'machine_id': None, 'hired_machine_id': hm.id, 'name': hm.machine_name,
            'plant_id': hm.plant_id, 'type': hm.machine_type, 'source': 'hired',
            'alerts': [], 'pending_transfer': None,
            'check': {
                'id': dc.id, 'condition': dc.condition, 'hours_reading': dc.hours_reading,
                'notes': dc.notes,
                'checked_by': (dc.checked_by_user.display_name or dc.checked_by_user.username) if dc.checked_by_user else None,
                'checked_at': dc.created_at.strftime('%H:%M') if dc.created_at else None,
                'photo_url': url_for('equipment.serve_daily_check_photo', filename=dc.photo_filename) if dc.photo_filename else None,
            } if dc else None,
        })

    # Sort: unchecked first
    machines.sort(key=lambda x: (1 if x['check'] else 0))

    return render_template('equipment/daily_checks_do.html',
                           project=project, check_date=check_date, machines=machines)


# ---------------------------------------------------------------------------
# Scheduled equipment checks (admin creates, assigns to supervisor/site user)
# ---------------------------------------------------------------------------

@equipment_bp.route('/equipment/scheduled-check/create', methods=['POST'])
@require_role('admin')
def scheduled_check_create():
    """Admin creates a scheduled equipment check."""
    project_id = request.form.get('project_id', type=int)
    name = request.form.get('name', '').strip()
    assigned_user_id = request.form.get('assigned_user_id', type=int)
    frequency = request.form.get('frequency', 'one_time')
    interval_days = request.form.get('interval_days', type=int)
    start_date_str = request.form.get('start_date', '').strip()
    notes = request.form.get('notes', '').strip() or None
    machine_ids = request.form.getlist('machine_ids', type=int)

    if not project_id or not name or not assigned_user_id or not start_date_str:
        flash('Project, name, assigned person, and start date are required.', 'danger')
        return redirect(request.referrer or url_for('main.index'))

    try:
        start_dt = datetime.strptime(start_date_str, '%Y-%m-%d').date()
    except ValueError:
        flash('Invalid date.', 'danger')
        return redirect(request.referrer or url_for('main.index'))

    sc = ScheduledEquipmentCheck(
        project_id=project_id,
        name=name,
        assigned_user_id=assigned_user_id,
        frequency=frequency,
        interval_days=interval_days if frequency == 'custom' else None,
        start_date=start_dt,
        next_due_date=start_dt,
        notes=notes,
        created_by_user_id=current_user.id,
    )

    # Attach machines
    if machine_ids:
        machines = Machine.query.filter(Machine.id.in_(machine_ids)).all()
        sc.machines = machines

    db.session.add(sc)
    db.session.commit()
    flash(f'Scheduled check "{name}" created with {len(sc.machines)} machines.', 'success')
    return redirect(request.referrer or url_for('main.index'))


@equipment_bp.route('/equipment/scheduled-check/<int:check_id>/complete', methods=['POST'])
@require_role('admin', 'supervisor', 'site')
def scheduled_check_complete(check_id):
    """Mark a scheduled check as completed for today."""
    sc = ScheduledEquipmentCheck.query.get_or_404(check_id)
    notes = request.form.get('notes', '').strip() or None

    completion = ScheduledCheckCompletion(
        scheduled_check_id=sc.id,
        completed_date=date.today(),
        completed_by_user_id=current_user.id,
        notes=notes,
    )
    db.session.add(completion)
    sc.advance_due_date()
    db.session.commit()
    flash(f'Check "{sc.name}" completed.', 'success')
    return redirect(request.referrer or url_for('main.index'))


@equipment_bp.route('/equipment/scheduled-check/<int:check_id>/edit', methods=['POST'])
@require_role('admin')
def scheduled_check_edit(check_id):
    """Admin edits a scheduled check."""
    sc = ScheduledEquipmentCheck.query.get_or_404(check_id)
    name = request.form.get('name', '').strip()
    if name:
        sc.name = name
    assigned_user_id = request.form.get('assigned_user_id', type=int)
    if assigned_user_id:
        sc.assigned_user_id = assigned_user_id
    frequency = request.form.get('frequency')
    if frequency:
        sc.frequency = frequency
        if frequency == 'custom':
            sc.interval_days = request.form.get('interval_days', type=int)
    next_due = request.form.get('next_due_date', '').strip()
    if next_due:
        try:
            sc.next_due_date = datetime.strptime(next_due, '%Y-%m-%d').date()
        except ValueError:
            pass
    notes = request.form.get('notes', '').strip()
    sc.notes = notes if notes else sc.notes

    machine_ids = request.form.getlist('machine_ids', type=int)
    if machine_ids:
        sc.machines = Machine.query.filter(Machine.id.in_(machine_ids)).all()

    db.session.commit()
    flash(f'Check "{sc.name}" updated.', 'success')
    return redirect(request.referrer or url_for('main.index'))


@equipment_bp.route('/equipment/scheduled-check/<int:check_id>/delete', methods=['POST'])
@require_role('admin')
def scheduled_check_delete(check_id):
    """Admin deletes a scheduled check."""
    sc = ScheduledEquipmentCheck.query.get_or_404(check_id)
    db.session.delete(sc)
    db.session.commit()
    flash('Scheduled check deleted.', 'info')
    return redirect(request.referrer or url_for('main.index'))


# ---------------------------------------------------------------------------
# Equipment Operations Dashboard (admin)
# ---------------------------------------------------------------------------

@equipment_bp.route('/equipment/operations')
@require_role('admin')
def operations_dashboard():
    """Admin operations view — inspections, check results, breakdowns, transfers."""
    from sqlalchemy import func

    today_date = date.today()

    # ── 1. Machines due for inspection or disposal ──────────────────────
    inspection_due = Machine.query.filter(
        Machine.active == True,
        Machine.next_inspection_date.isnot(None),
        Machine.next_inspection_date <= today_date + timedelta(days=30),
    ).order_by(Machine.next_inspection_date).all()

    disposal_due = Machine.query.filter(
        Machine.active == True,
        Machine.dispose_by_date.isnot(None),
        Machine.dispose_by_date <= today_date + timedelta(days=60),
    ).order_by(Machine.dispose_by_date).all()

    # ── 2. Scheduled checks — pending / overdue ─────────────────────────
    scheduled_checks = ScheduledEquipmentCheck.query.filter_by(active=True).order_by(
        ScheduledEquipmentCheck.next_due_date).all()
    overdue_checks = [sc for sc in scheduled_checks if sc.next_due_date <= today_date
                      and not any(c.completed_date == today_date for c in sc.completions)]
    upcoming_checks = [sc for sc in scheduled_checks if sc.next_due_date > today_date
                       and sc.next_due_date <= today_date + timedelta(days=7)]

    # ── 3. Recent check results (last 7 days) ──────────────────────────
    seven_days_ago = today_date - timedelta(days=7)
    recent_checks = MachineDailyCheck.query.filter(
        MachineDailyCheck.check_date >= seven_days_ago,
    ).order_by(MachineDailyCheck.check_date.desc(), MachineDailyCheck.created_at.desc()).limit(100).all()

    # Group by date for display
    checks_by_date = defaultdict(list)
    for dc in recent_checks:
        checks_by_date[dc.check_date].append(dc)

    # ── 4. Open breakdowns ──────────────────────────────────────────────
    open_breakdowns = MachineBreakdown.query.filter(
        MachineBreakdown.repair_status != 'completed'
    ).order_by(MachineBreakdown.incident_date.desc()).all()

    # ── 5. Pending transfers (batches + legacy individual) ──────────────
    pending_batches = TransferBatch.query.filter(
        TransferBatch.status.in_(['scheduled', 'in_transit'])
    ).order_by(TransferBatch.scheduled_date).all()
    pending_transfers = MachineTransfer.query.filter(
        MachineTransfer.batch_id.is_(None),
        MachineTransfer.status.in_(['scheduled', 'in_transit'])
    ).order_by(MachineTransfer.scheduled_date).all()

    # ── 6. Scheduled check completion history (last 14 days) ────────────
    recent_completions = ScheduledCheckCompletion.query.filter(
        ScheduledCheckCompletion.completed_date >= today_date - timedelta(days=14),
    ).order_by(ScheduledCheckCompletion.completed_date.desc()).all()

    # Project colour map
    PALETTE = [('#cfe2ff','#084298'),('#d1e7dd','#0a3622'),('#f8d7da','#842029'),
               ('#fff3cd','#664d03'),('#d2f4ea','#0b4c34'),('#fde8d8','#6c3a00'),
               ('#e2d9f3','#3d1a78'),('#dee2e6','#343a40')]
    all_proj = Project.query.order_by(Project.id).all()
    project_colour_map = {p.id: PALETTE[i % len(PALETTE)] for i, p in enumerate(all_proj)}

    projects = Project.query.filter_by(active=True).order_by(Project.name).all()
    all_machines = Machine.query.filter_by(active=True).order_by(Machine.name).all()
    all_users = User.query.filter_by(active=True).order_by(User.display_name).all()
    # Machine → project mapping for transfer modal filtering
    machine_project_map = {pm.machine_id: pm.project_id for pm in ProjectMachine.query.all()}

    return render_template('equipment/operations.html',
                           today=today_date,
                           inspection_due=inspection_due,
                           disposal_due=disposal_due,
                           overdue_checks=overdue_checks,
                           upcoming_checks=upcoming_checks,
                           scheduled_checks=scheduled_checks,
                           checks_by_date=dict(checks_by_date),
                           open_breakdowns=open_breakdowns,
                           pending_batches=pending_batches,
                           pending_transfers=pending_transfers,
                           recent_completions=recent_completions,
                           project_colour_map=project_colour_map,
                           projects=projects,
                           all_machines=all_machines,
                           all_users=all_users,
                           machine_project_map=machine_project_map)


@equipment_bp.route('/equipment/daily-checks/view')
@require_role('admin', 'supervisor', 'site')
def daily_checks_view():
    """View all daily checks for a project on a specific date."""
    project_id = request.args.get('project_id', type=int)
    date_str = request.args.get('date', '')

    if date_str:
        try:
            check_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            check_date = date.today()
    else:
        check_date = date.today()

    project = Project.query.get_or_404(project_id) if project_id else None

    # Get all checks for this project and date
    query = MachineDailyCheck.query.filter_by(check_date=check_date)
    if project_id:
        query = query.filter_by(project_id=project_id)
    checks = query.order_by(MachineDailyCheck.created_at.desc()).all()

    # Get all machines assigned to this project to show what's NOT been checked
    unchecked_machines = []
    if project_id:
        checked_machine_ids = {c.machine_id for c in checks if c.machine_id}
        checked_hired_ids = {c.hired_machine_id for c in checks if c.hired_machine_id}
        for pm in ProjectMachine.query.filter_by(project_id=project_id).all():
            if pm.machine_id not in checked_machine_ids:
                unchecked_machines.append({'name': pm.machine.name, 'plant_id': pm.machine.plant_id, 'type': 'fleet'})
        for hm in HiredMachine.query.filter_by(project_id=project_id, active=True).all():
            if hm.id not in checked_hired_ids:
                unchecked_machines.append({'name': hm.machine_name, 'plant_id': hm.plant_id, 'type': 'hired'})

    projects = Project.query.filter_by(active=True).order_by(Project.name).all()

    # Project colour map
    PALETTE = [('#cfe2ff','#084298'),('#d1e7dd','#0a3622'),('#f8d7da','#842029'),
               ('#fff3cd','#664d03'),('#d2f4ea','#0b4c34'),('#fde8d8','#6c3a00'),
               ('#e2d9f3','#3d1a78'),('#dee2e6','#343a40')]
    all_proj = Project.query.order_by(Project.id).all()
    project_colour_map = {p.id: PALETTE[i % len(PALETTE)] for i, p in enumerate(all_proj)}

    return render_template('equipment/daily_checks_view.html',
                           checks=checks, project=project, check_date=check_date,
                           unchecked_machines=unchecked_machines, projects=projects,
                           project_colour_map=project_colour_map)
