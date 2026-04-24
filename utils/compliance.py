"""Helpers for the per-machine compliance system (service / calibration /
test & tag / annual cert)."""
from sqlalchemy import event, inspect as sqla_inspect
from sqlalchemy.orm import Session, object_session

from models import (
    db, Machine, MachineTypeCompliance, MachineCompliance,
    COMPLIANCE_KINDS,
)


def sync_machine_compliance(machine):
    """Ensure MachineCompliance rows for `machine` match the rules for its
    current machine_type. Creates rows for newly-enabled kinds. Preserves
    existing records — never deletes history. Idempotent."""
    if not machine or not machine.machine_type:
        return
    rule = MachineTypeCompliance.query.filter_by(machine_type=machine.machine_type).first()
    existing = {mc.kind: mc for mc in MachineCompliance.query.filter_by(machine_id=machine.id).all()}

    for kind in COMPLIANCE_KINDS:
        enabled = bool(rule and rule.is_enabled(kind))
        default_interval = rule.interval_for(kind) if rule else None
        default_unit = rule.unit_for(kind) if rule else 'days'
        row = existing.get(kind)
        if enabled and not row:
            row = MachineCompliance(
                machine_id=machine.id,
                kind=kind,
                interval_days=default_interval,
                interval_unit=default_unit,
            )
            db.session.add(row)
        elif enabled and row and row.interval_days is None and default_interval is not None:
            row.interval_days = default_interval
            row.interval_unit = default_unit
            row.recompute_next_due()


def backfill_all_machines():
    """Run sync_machine_compliance for every active machine. Safe to re-run."""
    for m in Machine.query.filter_by(active=True).all():
        sync_machine_compliance(m)
    db.session.commit()


# ─── Auto-sync on machine insert / type change ────────────────────────────
# Queue ids in session.info during flush; process them in after_commit so the
# sync writes happen in a clean transactional state.

def _queue_for_sync(session, machine_id):
    ids = session.info.setdefault('_compliance_sync_ids', set())
    ids.add(machine_id)


@event.listens_for(Machine, 'after_insert')
def _machine_after_insert(mapper, connection, target):
    if not target.machine_type:
        return
    s = object_session(target)
    if s is not None:
        _queue_for_sync(s, target.id)


@event.listens_for(Machine, 'after_update')
def _machine_after_update(mapper, connection, target):
    hist = sqla_inspect(target).attrs.machine_type.history
    if not hist.has_changes():
        return
    s = object_session(target)
    if s is not None:
        _queue_for_sync(s, target.id)


@event.listens_for(Session, 'after_commit')
def _session_after_commit(session):
    ids = session.info.pop('_compliance_sync_ids', None)
    if not ids:
        return
    # Resolve fresh (post-commit) and sync. Second commit will fire this
    # listener again but with nothing queued, so no recursion.
    try:
        for mid in list(ids):
            m = Machine.query.get(mid)
            if m:
                sync_machine_compliance(m)
        db.session.commit()
    except Exception:
        db.session.rollback()
