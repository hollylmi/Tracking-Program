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
