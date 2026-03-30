import os
import logging
from datetime import date, timedelta

logger = logging.getLogger(__name__)

# Firebase Admin SDK initialisation
# Only initialises if credentials are available — safe to import in dev
# without Firebase configured

_firebase_app = None


def get_firebase_app():
    global _firebase_app
    if _firebase_app is not None:
        return _firebase_app
    try:
        import firebase_admin
        from firebase_admin import credentials
        cred_path = os.environ.get('FIREBASE_CREDENTIALS_PATH')
        cred_json = os.environ.get('FIREBASE_CREDENTIALS_JSON')
        if cred_json:
            import json
            cred = credentials.Certificate(json.loads(cred_json))
        elif cred_path:
            cred = credentials.Certificate(cred_path)
        else:
            logger.warning(
                'Firebase credentials not configured — push notifications disabled')
            return None
        _firebase_app = firebase_admin.initialize_app(cred)
        return _firebase_app
    except Exception as e:
        logger.error(f'Firebase init failed: {e}')
        return None


def send_notification(token, title, body, data=None):
    """Send a push notification to a single device token.
    Returns True if sent, False if failed."""
    app = get_firebase_app()
    if app is None:
        logger.warning('Push notification skipped — Firebase not configured')
        return False
    try:
        from firebase_admin import messaging
        message = messaging.Message(
            notification=messaging.Notification(
                title=title,
                body=body,
            ),
            data=data or {},
            token=token,
        )
        messaging.send(message)
        return True
    except Exception as e:
        logger.error(f'Push notification failed: {e}')
        return False


def send_entry_reminders():
    """Send 4pm reminders to users who have not submitted a daily entry today.
    Called by the scheduled job at 4pm."""
    from models import User, DailyEntry, DeviceToken
    from sqlalchemy import func

    today = date.today()

    # Find all active non-admin users who have device tokens
    users_with_tokens = (
        User.query
        .join(DeviceToken)
        .filter(User.active == True)
        .filter(User.role != 'admin')
        .all()
    )

    sent_count = 0
    for user in users_with_tokens:
        # Check if this user has submitted an entry today
        entry_today = (
            DailyEntry.query
            .filter_by(user_id=user.id)
            .filter(func.date(DailyEntry.entry_date) == today)
            .first()
        )

        if entry_today:
            continue

        # Send reminder to all their devices
        for device in user.device_tokens:
            success = send_notification(
                token=device.token,
                title='Daily entry reminder',
                body="Don't forget to submit your daily entry before you leave site today.",
                data={'type': 'entry_reminder', 'date': str(today)},
            )
            if success:
                sent_count += 1

    logger.info(f'Entry reminders sent: {sent_count}')
    return sent_count


def send_upcoming_flight_reminders():
    """Send reminders for flights happening tomorrow.
    Called by scheduled job once daily."""
    from models import FlightBooking, User, DeviceToken
    from datetime import timedelta

    tomorrow = date.today() + timedelta(days=1)

    flights = FlightBooking.query.filter_by(date=tomorrow).all()
    if not flights:
        return 0

    sent_count = 0
    # Group by employee to avoid duplicate lookups
    emp_flights = {}
    for f in flights:
        emp_flights.setdefault(f.employee_id, []).append(f)

    for emp_id, emp_fl_list in emp_flights.items():
        user = User.query.filter_by(employee_id=emp_id, active=True).first()
        if not user:
            continue
        tokens = DeviceToken.query.filter_by(user_id=user.id).all()
        if not tokens:
            continue

        for f in emp_fl_list:
            parts = []
            if f.flight_number:
                parts.append(f.flight_number)
            if f.departure_time and f.departure_airport:
                parts.append(f'at {f.departure_time} from {f.departure_airport}')
            elif f.departure_time:
                parts.append(f'at {f.departure_time}')
            detail = ' '.join(parts) if parts else 'tomorrow'

            body = f'Reminder: Flight {detail}'
            for device in tokens:
                success = send_notification(
                    token=device.token,
                    title='Upcoming flight tomorrow',
                    body=body,
                    data={'type': 'flight_reminder', 'date': tomorrow.isoformat(),
                          'flight_id': str(f.id)},
                )
                if success:
                    sent_count += 1

    logger.info(f'Flight reminders sent: {sent_count}')
    return sent_count


def send_upcoming_checkin_reminders():
    """Send reminders for accommodation check-ins happening tomorrow.
    Called by scheduled job once daily."""
    from models import AccommodationBooking, User, DeviceToken
    from datetime import timedelta

    tomorrow = date.today() + timedelta(days=1)

    checkins = AccommodationBooking.query.filter_by(date_from=tomorrow).all()
    if not checkins:
        return 0

    sent_count = 0
    for ab in checkins:
        user = User.query.filter_by(employee_id=ab.employee_id, active=True).first()
        if not user:
            continue
        tokens = DeviceToken.query.filter_by(user_id=user.id).all()
        if not tokens:
            continue

        prop = ab.property_name or 'your accommodation'
        time_str = f' at {ab.check_in_time}' if ab.check_in_time else ''
        body = f'Reminder: Check-in tomorrow{time_str} at {prop}'

        for device in tokens:
            success = send_notification(
                token=device.token,
                title='Accommodation check-in tomorrow',
                body=body,
                data={'type': 'accommodation_reminder', 'date': tomorrow.isoformat(),
                      'accommodation_id': str(ab.id)},
            )
            if success:
                sent_count += 1

    logger.info(f'Accommodation check-in reminders sent: {sent_count}')
    return sent_count


# ---------------------------------------------------------------------------
# Equipment notification functions
# ---------------------------------------------------------------------------

def notify_breakdown_to_admin(breakdown, machine_name, project_name):
    """Fire immediately when a breakdown is created from a daily check or checklist.
    Sends push to all admin users and emails the site manager."""
    from models import User, DeviceToken, Project

    title = f'Breakdown: {machine_name}'
    body = f'{machine_name} reported broken down at {project_name}.'

    # Push to all admin users
    admin_users = (
        User.query
        .join(DeviceToken)
        .filter(User.active == True, User.role == 'admin')
        .all()
    )
    sent_count = 0
    for user in admin_users:
        for device in user.device_tokens:
            success = send_notification(
                token=device.token,
                title=title,
                body=body,
                data={'type': 'breakdown_alert',
                      'breakdown_id': str(breakdown.id),
                      'machine_name': machine_name,
                      'project_name': project_name},
            )
            if success:
                sent_count += 1

    # Also notify the site manager if the project has one
    if breakdown.machine_id:
        from models import ProjectMachine
        pm = ProjectMachine.query.filter_by(machine_id=breakdown.machine_id).first()
        if pm and pm.project and pm.project.site_manager_user_id:
            mgr = User.query.get(pm.project.site_manager_user_id)
            if mgr and mgr.active:
                tokens = DeviceToken.query.filter_by(user_id=mgr.id).all()
                for device in tokens:
                    send_notification(
                        token=device.token,
                        title=title,
                        body=body,
                        data={'type': 'breakdown_alert',
                              'breakdown_id': str(breakdown.id)},
                    )

    logger.info(f'Breakdown notification sent to {sent_count} admin devices for {machine_name}')
    return sent_count


def send_daily_check_reminders():
    """7am daily — for each project where daily checks are incomplete, notify site manager."""
    from models import (User, DeviceToken, Project, ProjectMachine, HiredMachine,
                        MachineDailyCheck, UserProjectAccess)

    today_date = date.today()
    projects = Project.query.filter_by(active=True).all()
    sent_count = 0

    for p in projects:
        own_count = ProjectMachine.query.filter_by(project_id=p.id).count()
        hired_count = HiredMachine.query.filter_by(project_id=p.id, active=True).count()
        total = own_count + hired_count
        if total == 0:
            continue

        checks_done = MachineDailyCheck.query.filter_by(
            project_id=p.id, check_date=today_date).count()
        if checks_done >= total:
            continue

        # Notify site manager
        notify_user_ids = set()
        if p.site_manager_user_id:
            notify_user_ids.add(p.site_manager_user_id)

        # Also notify supervisors with access
        supervisor_access = (
            UserProjectAccess.query
            .join(User, UserProjectAccess.user_id == User.id)
            .filter(UserProjectAccess.project_id == p.id,
                    User.role == 'supervisor', User.active == True)
            .all()
        )
        for a in supervisor_access:
            notify_user_ids.add(a.user_id)

        for uid in notify_user_ids:
            tokens = DeviceToken.query.filter_by(user_id=uid).all()
            for device in tokens:
                success = send_notification(
                    token=device.token,
                    title='Daily equipment check reminder',
                    body=f'{p.name}: {checks_done}/{total} machines checked. Please complete morning checks.',
                    data={'type': 'daily_check_reminder', 'project_id': str(p.id)},
                )
                if success:
                    sent_count += 1

    logger.info(f'Daily check reminders sent: {sent_count}')
    return sent_count


def send_checklist_reminders():
    """Daily — notify for checklists due within 7 days that are incomplete."""
    from models import (User, DeviceToken, SiteEquipmentChecklist, Project)

    today_date = date.today()
    upcoming = SiteEquipmentChecklist.query.filter(
        SiteEquipmentChecklist.completed_at.is_(None),
        SiteEquipmentChecklist.due_date <= today_date + timedelta(days=7),
    ).all()

    sent_count = 0
    for cl in upcoming:
        if not cl.project or not cl.project.site_manager_user_id:
            continue

        mgr = User.query.get(cl.project.site_manager_user_id)
        if not mgr or not mgr.active:
            continue

        tokens = DeviceToken.query.filter_by(user_id=mgr.id).all()
        days_left = (cl.due_date - today_date).days
        urgency = 'OVERDUE' if days_left < 0 else f'{days_left} days left'

        for device in tokens:
            success = send_notification(
                token=device.token,
                title=f'Equipment checklist: {urgency}',
                body=f'"{cl.checklist_name}" for {cl.project.name} is due {cl.due_date.strftime("%d/%m/%Y")}.',
                data={'type': 'checklist_reminder', 'checklist_id': str(cl.id)},
            )
            if success:
                sent_count += 1

    logger.info(f'Checklist reminders sent: {sent_count}')
    return sent_count


def send_transfer_reminders():
    """Daily — notify for transfers scheduled within 3 days."""
    from models import (User, DeviceToken, MachineTransfer, Project)

    today_date = date.today()
    upcoming = MachineTransfer.query.filter(
        MachineTransfer.status == 'scheduled',
        MachineTransfer.reminder_sent == False,
        MachineTransfer.scheduled_date <= today_date + timedelta(days=3),
    ).all()

    sent_count = 0
    from models import db

    for t in upcoming:
        machine_name = t.machine.name if t.machine else 'Unknown'
        notify_user_ids = set()

        if t.from_project and t.from_project.site_manager_user_id:
            notify_user_ids.add(t.from_project.site_manager_user_id)
        if t.to_project and t.to_project.site_manager_user_id:
            notify_user_ids.add(t.to_project.site_manager_user_id)

        for uid in notify_user_ids:
            tokens = DeviceToken.query.filter_by(user_id=uid).all()
            for device in tokens:
                success = send_notification(
                    token=device.token,
                    title='Machine transfer reminder',
                    body=f'{machine_name} transfer scheduled for {t.scheduled_date.strftime("%d/%m/%Y")}.',
                    data={'type': 'transfer_reminder', 'transfer_id': str(t.id)},
                )
                if success:
                    sent_count += 1

        t.reminder_sent = True

    db.session.commit()
    logger.info(f'Transfer reminders sent: {sent_count}')
    return sent_count


def send_expiry_alerts():
    """Daily — email/push admins about machines with disposal/inspection within 14 days."""
    from models import User, DeviceToken, Machine

    today_date = date.today()
    from models import db
    flagged = Machine.query.filter(
        Machine.active == True,
        db.or_(
            db.and_(Machine.dispose_by_date.isnot(None),
                    Machine.dispose_by_date <= today_date + timedelta(days=14)),
            db.and_(Machine.next_inspection_date.isnot(None),
                    Machine.next_inspection_date <= today_date + timedelta(days=14)),
        )
    ).all()

    if not flagged:
        return 0

    admin_users = (
        User.query
        .join(DeviceToken)
        .filter(User.active == True, User.role == 'admin')
        .all()
    )

    sent_count = 0
    for m in flagged:
        parts = []
        if m.dispose_by_date:
            days = (m.dispose_by_date - today_date).days
            parts.append(f'disposal in {days}d')
        if m.next_inspection_date:
            days = (m.next_inspection_date - today_date).days
            parts.append(f'inspection in {days}d')
        detail = ', '.join(parts)

        for user in admin_users:
            for device in user.device_tokens:
                success = send_notification(
                    token=device.token,
                    title=f'Equipment alert: {m.name}',
                    body=f'{m.name}: {detail}',
                    data={'type': 'expiry_alert', 'machine_id': str(m.id)},
                )
                if success:
                    sent_count += 1

    logger.info(f'Expiry alerts sent: {sent_count}')
    return sent_count
