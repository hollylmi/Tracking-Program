import os
import logging
from datetime import date

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
