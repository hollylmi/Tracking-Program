import os
import json

# settings.json lives at <project_root>/instance/settings.json
# __file__ is <project_root>/utils/settings.py, so go up two levels
_SETTINGS_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'instance', 'settings.json'
)


_DEFAULT_AIRPORTS = [
    {'code': 'SYD', 'name': 'Sydney'},
    {'code': 'MEL', 'name': 'Melbourne'},
    {'code': 'BNE', 'name': 'Brisbane'},
    {'code': 'PER', 'name': 'Perth'},
    {'code': 'ADL', 'name': 'Adelaide'},
    {'code': 'CBR', 'name': 'Canberra'},
    {'code': 'OOL', 'name': 'Gold Coast'},
    {'code': 'CNS', 'name': 'Cairns'},
    {'code': 'TSV', 'name': 'Townsville'},
    {'code': 'DRW', 'name': 'Darwin'},
    {'code': 'HBA', 'name': 'Hobart'},
    {'code': 'KTA', 'name': 'Karratha'},
    {'code': 'PHE', 'name': 'Port Hedland'},
    {'code': 'NTL', 'name': 'Newcastle'},
]

_DEFAULT_LOCATIONS = [
    'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide',
    'Canberra', 'Gold Coast', 'Cairns', 'Townsville', 'Darwin',
    'Hobart', 'Karratha', 'Port Hedland', 'Newcastle', 'Wollongong',
    'Geelong', 'Sunshine Coast',
]


def load_settings():
    if os.path.exists(_SETTINGS_FILE):
        with open(_SETTINGS_FILE, 'r') as f:
            data = json.load(f)
        # Ensure airports/locations lists exist (backfill for older configs)
        if 'airports' not in data:
            data['airports'] = _DEFAULT_AIRPORTS
        if 'locations' not in data:
            data['locations'] = _DEFAULT_LOCATIONS
        if 'drive_pairs' not in data:
            data['drive_pairs'] = _DEFAULT_DRIVE_PAIRS
        return data
    return {
        'company_name': '',
        'smtp_server': 'smtp.gmail.com',
        'smtp_port': 587,
        'smtp_username': '',
        'smtp_password': '',
        'from_name': '',
        'from_email': '',
        'airports': _DEFAULT_AIRPORTS,
        'locations': _DEFAULT_LOCATIONS,
        'drive_pairs': _DEFAULT_DRIVE_PAIRS,
    }


def get_airports():
    """Return list of {'code': 'SYD', 'name': 'Sydney'} dicts."""
    settings = load_settings()
    return settings.get('airports', _DEFAULT_AIRPORTS)


def get_locations():
    """Return sorted list of location name strings."""
    settings = load_settings()
    return sorted(settings.get('locations', _DEFAULT_LOCATIONS))


_DEFAULT_DRIVE_PAIRS = [
    ['Sydney', 'Wollongong'],
    ['Sydney', 'Newcastle'],
    ['Melbourne', 'Geelong'],
    ['Brisbane', 'Gold Coast'],
    ['Brisbane', 'Sunshine Coast'],
]


def get_drive_pairs():
    """Return list of [city_a, city_b] pairs where driving is the default transport."""
    settings = load_settings()
    return settings.get('drive_pairs', _DEFAULT_DRIVE_PAIRS)


def save_settings(data):
    os.makedirs(os.path.dirname(_SETTINGS_FILE), exist_ok=True)
    with open(_SETTINGS_FILE, 'w') as f:
        json.dump(data, f, indent=2)
