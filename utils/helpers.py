import re

from flask import session
from flask_login import current_user


def _natural_key(s):
    """Sort key for natural ordering: LOT 1, LOT 2, LOT 10 (not LOT 1, LOT 10, LOT 2)."""
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', s or '')]


def get_active_project_id():
    """Return the session-tracked active project id for supervisor/site users.

    Returns None for admins — admin routes handle their own project filtering.
    """
    if current_user.role == 'admin':
        return None
    return session.get('active_project_id')


def in_transit_machine_ids():
    """Return a set of own-fleet Machine IDs that are currently in transit
    (pre-check done, arrival check not done) and therefore locked from daily
    entries + pre-start checks until they arrive at their destination site."""
    from models import MachineTransfer
    rows = MachineTransfer.query.filter(
        MachineTransfer.status == 'in_transit',
    ).with_entities(MachineTransfer.machine_id).all()
    return {mid for (mid,) in rows if mid}


def in_transit_info():
    """Return dict mapping machine_id → {to_project_name, scheduled_date} for
    all in-transit machines, so the UI can show helpful lockout messages."""
    from models import MachineTransfer, Project
    info = {}
    rows = MachineTransfer.query.filter(
        MachineTransfer.status == 'in_transit',
    ).all()
    for t in rows:
        if t.machine_id:
            info[t.machine_id] = {
                'to_project': t.to_project.name if t.to_project else '—',
                'scheduled_date': t.scheduled_date,
                'transfer_id': t.id,
                'batch_id': t.batch_id,
            }
    return info
