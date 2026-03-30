"""
Migration script — adds any missing columns to the existing database.
Safe to run multiple times (skips columns that already exist).
Run automatically by run.bat before starting the app.
"""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'instance', 'tracking.db')

if not os.path.exists(DB_PATH):
    print("Database not found — it will be created fresh when you start the app.")
else:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    def column_exists(table, column):
        cur.execute(f"PRAGMA table_info({table})")
        return any(row[1] == column for row in cur.fetchall())

    def table_exists(table):
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
        return cur.fetchone() is not None

    def add_column(table, column, col_type, default=None):
        if not column_exists(table, column):
            sql = f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"
            if default is not None:
                sql += f" DEFAULT {default}"
            cur.execute(sql)
            print(f"Added:  {table}.{column}")
            return True
        else:
            print(f"OK:     {table}.{column}")
            return False

    changes = 0

    # ── employee ──────────────────────────────────────────────────────────────
    changes += add_column('employee', 'delay_rate', 'REAL')
    changes += add_column('employee', 'role_id', 'INTEGER')

    # ── machine ───────────────────────────────────────────────────────────────
    changes += add_column('machine', 'delay_rate', 'REAL')

    # ── hired_machine ─────────────────────────────────────────────────────────
    changes += add_column('hired_machine', 'count_saturdays', 'INTEGER', default=1)

    # ── stand_down ────────────────────────────────────────────────────────────
    changes += add_column('stand_down', 'entry_id', 'INTEGER')

    # ── project ───────────────────────────────────────────────────────────────
    changes += add_column('project', 'start_date', 'DATE')
    changes += add_column('project', 'planned_crew', 'INTEGER')
    changes += add_column('project', 'hours_per_day', 'REAL')
    changes += add_column('project', 'quoted_days', 'INTEGER')
    changes += add_column('project', 'state', 'VARCHAR(10)')
    changes += add_column('project', 'is_cfmeu', 'BOOLEAN', default=0)

    # ── daily_entry ───────────────────────────────────────────────────────────
    changes += add_column('daily_entry', 'location', 'TEXT')
    changes += add_column('daily_entry', 'install_sqm', 'REAL', default=0)
    changes += add_column('daily_entry', 'delay_billable', 'INTEGER', default=1)
    changes += add_column('daily_entry', 'delay_description', 'TEXT')
    changes += add_column('daily_entry', 'machines_stood_down', 'INTEGER', default=0)
    changes += add_column('daily_entry', 'other_work_description', 'TEXT')
    changes += add_column('daily_entry', 'user_id', 'INTEGER')

    # ── user (email settings per user) ────────────────────────────────────────
    changes += add_column('user', 'email_from_name', 'TEXT')
    changes += add_column('user', 'email_from_address', 'TEXT')
    changes += add_column('user', 'email_smtp_server', 'TEXT')
    changes += add_column('user', 'email_smtp_port', 'INTEGER')
    changes += add_column('user', 'email_smtp_username', 'TEXT')
    changes += add_column('user', 'email_smtp_password', 'TEXT')

    # ── new tables (created by SQLAlchemy db.create_all on first app start) ──
    # entry_photo, planned_data, project_non_work_date, project_budgeted_role,
    # project_machine, project_worked_sunday, project_document — created automatically.
    # We just confirm here if they already exist.
    # Migrate project_equipment_requirement: old schema used machine_type, new uses label
    if table_exists('project_equipment_requirement'):
        if column_exists('project_equipment_requirement', 'machine_type') and \
           not column_exists('project_equipment_requirement', 'label'):
            cur.execute("ALTER TABLE project_equipment_requirement ADD COLUMN label TEXT")
            cur.execute("UPDATE project_equipment_requirement SET label = machine_type WHERE label IS NULL")
            changes += 1
            print("Migrated: project_equipment_requirement.machine_type → label")

    # ── diagram_layer ─────────────────────────────────────────────────────────
    changes += add_column('diagram_layer', 'bg_filename', 'VARCHAR(500)')
    changes += add_column('diagram_layer', 'bg_original_name', 'VARCHAR(500)')
    changes += add_column('diagram_layer', 'canvas_bg_filename', 'VARCHAR(500)')
    changes += add_column('diagram_layer', 'canvas_bg_original_name', 'VARCHAR(500)')

    # ── panel_install_record ──────────────────────────────────────────────────
    changes += add_column('panel_install_record', 'roll_number', 'VARCHAR(100)')
    changes += add_column('panel_install_record', 'install_time', 'VARCHAR(10)')
    changes += add_column('panel_install_record', 'width_m', 'REAL')
    changes += add_column('panel_install_record', 'length_m', 'REAL')
    changes += add_column('panel_install_record', 'area_sqm', 'REAL')
    changes += add_column('panel_install_record', 'panel_type', 'VARCHAR(100)')
    changes += add_column('panel_install_record', 'canvas_x', 'REAL')
    changes += add_column('panel_install_record', 'canvas_y', 'REAL')
    changes += add_column('panel_install_record', 'canvas_w', 'REAL')
    changes += add_column('panel_install_record', 'canvas_h', 'REAL')
    changes += add_column('diagram_layer', 'canvas_elements', 'TEXT')
    changes += add_column('panel_install_record', 'canvas_points', 'TEXT')
    changes += add_column('panel_install_record', 'source', 'VARCHAR(20)')

    # ── employee_roles (many-to-many: employee ↔ role) ───────────────────────
    if not table_exists('employee_roles'):
        cur.execute('''
            CREATE TABLE employee_roles (
                employee_id INTEGER NOT NULL,
                role_id INTEGER NOT NULL,
                PRIMARY KEY (employee_id, role_id),
                FOREIGN KEY (employee_id) REFERENCES employee(id),
                FOREIGN KEY (role_id) REFERENCES role(id)
            )
        ''')
        changes += 1
        print("Created: employee_roles table")
    else:
        print("OK:     employee_roles table exists")

    # ── project_assignment ────────────────────────────────────────────────────
    changes += add_column('project_assignment', 'scheduled_role_id', 'INTEGER')

    # ── public_holiday — multi-state support ─────────────────────────────────
    if add_column('public_holiday', 'states', 'VARCHAR(200)'):
        cur.execute("UPDATE public_holiday SET states = state WHERE states IS NULL AND state IS NOT NULL")
        changes += 1

    # ── cfmeu_date — multi-state support ─────────────────────────────────────
    if add_column('cfmeu_date', 'states', 'VARCHAR(200)'):
        cur.execute("UPDATE cfmeu_date SET states = state WHERE states IS NULL AND state IS NOT NULL")
        changes += 1

    # ── machine — extended equipment tracking fields ──────────────────────────
    changes += add_column('machine', 'acquired_date', 'DATE')
    changes += add_column('machine', 'dispose_by_date', 'DATE')
    changes += add_column('machine', 'next_inspection_date', 'DATE')
    changes += add_column('machine', 'inspection_interval_days', 'INTEGER')
    changes += add_column('machine', 'storage_instructions', 'TEXT')
    changes += add_column('machine', 'service_instructions', 'TEXT')
    changes += add_column('machine', 'spare_parts_notes', 'TEXT')
    changes += add_column('machine', 'disposal_procedure', 'TEXT')
    changes += add_column('machine', 'serial_number', 'VARCHAR(200)')
    changes += add_column('machine', 'manufacturer', 'VARCHAR(200)')
    changes += add_column('machine', 'model_number', 'VARCHAR(200)')

    # ── project — site manager ──────────────────────────────────────────────
    changes += add_column('project', 'site_manager_user_id', 'INTEGER')

    for t in ('entry_photo', 'planned_data', 'project_non_work_date', 'project_budgeted_role',
              'project_machine', 'project_worked_sunday', 'project_document',
              'project_equipment_requirement', 'project_equipment_assignment',
              'machine_breakdown', 'breakdown_photo', 'public_holiday', 'cfmeu_date',
              'machine_transfer', 'site_equipment_checklist', 'site_equipment_checklist_item',
              'machine_daily_check'):
        if table_exists(t):
            print(f"OK:     {t} table exists")
        else:
            print(f"INFO:   {t} table will be created when the app starts")

    conn.commit()
    conn.close()

    if changes:
        print(f"\nMigration complete — {changes} column(s) added.")
    else:
        print("\nDatabase is already up to date.")

print("\nYou can now start the app.")
input("Press Enter to close...")
