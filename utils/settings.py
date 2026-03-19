import os
import json

# settings.json lives at <project_root>/instance/settings.json
# __file__ is <project_root>/utils/settings.py, so go up two levels
_SETTINGS_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'instance', 'settings.json'
)


def load_settings():
    if os.path.exists(_SETTINGS_FILE):
        with open(_SETTINGS_FILE, 'r') as f:
            return json.load(f)
    return {
        'company_name': '',
        'smtp_server': 'smtp.gmail.com',
        'smtp_port': 587,
        'smtp_username': '',
        'smtp_password': '',
        'from_name': '',
        'from_email': '',
    }


def save_settings(data):
    os.makedirs(os.path.dirname(_SETTINGS_FILE), exist_ok=True)
    with open(_SETTINGS_FILE, 'w') as f:
        json.dump(data, f, indent=2)
