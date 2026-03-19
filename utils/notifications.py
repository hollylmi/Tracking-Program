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
