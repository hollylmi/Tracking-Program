"""
Export all data from the local SQLite database to export.json.
Run this LOCALLY before importing to Railway.

Usage:
    python3 export_data.py
"""
import sqlite3, json, os
from datetime import date, datetime

DB_PATH = os.path.join(os.path.dirname(__file__), 'instance', 'tracking.db')

if not os.path.exists(DB_PATH):
    print("ERROR: No local database found at instance/tracking.db")
    input("Press Enter to close...")
    exit(1)

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()


def table_rows(table):
    try:
        cur.execute(f"SELECT * FROM {table}")
        return [dict(row) for row in cur.fetchall()]
    except Exception as e:
        print(f"  Skipping {table}: {e}")
        return []


def assoc_rows(table):
    try:
        cur.execute(f"SELECT * FROM {table}")
        return [list(row) for row in cur.fetchall()]
    except Exception as e:
        print(f"  Skipping {table}: {e}")
        return []


print("Exporting data from local database...")

data = {
    'role':                   table_rows('role'),
    'project':                table_rows('project'),
    'employee':               table_rows('employee'),
    'machine':                table_rows('machine'),
    'daily_entry':            table_rows('daily_entry'),
    'entry_employees':        assoc_rows('entry_employees'),
    'entry_machines':         assoc_rows('entry_machines'),
    'hired_machine':          table_rows('hired_machine'),
    'stand_down':             table_rows('stand_down'),
    'planned_data':           table_rows('planned_data'),
    'project_non_work_date':  table_rows('project_non_work_date'),
    'project_budgeted_role':  table_rows('project_budgeted_role'),
    'project_machine':        table_rows('project_machine'),
    'project_worked_sunday':  table_rows('project_worked_sunday'),
    # Note: entry_photo and project_document records are included but
    # the actual files need to be re-uploaded manually.
    'entry_photo':            table_rows('entry_photo'),
    'project_document':       table_rows('project_document'),
}

conn.close()

out_path = os.path.join(os.path.dirname(__file__), 'export.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, default=str)

# Print counts
total = 0
for table, rows in data.items():
    count = len(rows)
    total += count
    if count:
        print(f"  {table}: {count} rows")

print(f"\nExport complete — {total} total rows saved to export.json")
print(f"File location: {out_path}")
print("\nNext step: Log in to your Railway app as admin,")
print("go to Admin > Import Data, and upload export.json")
input("\nPress Enter to close...")
