from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from datetime import datetime

db = SQLAlchemy()


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), nullable=False, unique=True)
    display_name = db.Column(db.String(200))       # full name shown in entries
    email = db.Column(db.String(200))              # contact email
    password_hash = db.Column(db.String(256), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    active = db.Column(db.Boolean, default=True)
    role = db.Column(db.String(20), nullable=False, default='admin')
    employee_id = db.Column(db.Integer, db.ForeignKey('employee.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    entries = db.relationship('DailyEntry', backref='submitted_by_user', lazy=True)
    employee = db.relationship('Employee', foreign_keys=[employee_id], lazy=True)

    def accessible_projects(self):
        if self.role == 'admin':
            return Project.query.filter_by(active=True).order_by(Project.name).all()
        access = UserProjectAccess.query.filter_by(user_id=self.id).all()
        return [a.project for a in access if a.project.active]

    @property
    def is_active(self):
        return self.active

    def __repr__(self):
        return f'<User {self.username}>'

# Association tables for many-to-many relationships
entry_employees = db.Table(
    'entry_employees',
    db.Column('entry_id', db.Integer, db.ForeignKey('daily_entry.id'), primary_key=True),
    db.Column('employee_id', db.Integer, db.ForeignKey('employee.id'), primary_key=True)
)

entry_machines = db.Table(
    'entry_machines',
    db.Column('entry_id', db.Integer, db.ForeignKey('daily_entry.id'), primary_key=True),
    db.Column('machine_id', db.Integer, db.ForeignKey('machine.id'), primary_key=True)
)

employee_roles = db.Table(
    'employee_roles',
    db.Column('employee_id', db.Integer, db.ForeignKey('employee.id'), primary_key=True),
    db.Column('role_id', db.Integer, db.ForeignKey('role.id'), primary_key=True)
)


class Project(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    active = db.Column(db.Boolean, default=True)
    start_date = db.Column(db.Date)           # Day 1 of installation (for Gantt day→date mapping)
    planned_crew = db.Column(db.Integer)      # Estimated crew size for efficiency calculations
    hours_per_day = db.Column(db.Float)       # Quoted hours per working day
    quoted_days = db.Column(db.Integer)       # Total quoted working days for the job
    planned_end_date = db.Column(db.Date)    # Planned finish date — used for ongoing assignment accommodation
    state = db.Column(db.String(10))              # Australian state code e.g. 'QLD'
    is_cfmeu = db.Column(db.Boolean, default=False)
    track_by_lot = db.Column(db.Boolean, default=True)  # False = track by material only (no lot field)
    site_address = db.Column(db.String(500))      # Physical site address
    city = db.Column(db.String(100))                 # City/town for travel planning (e.g. "Brisbane", "Sydney")
    nearest_airport = db.Column(db.String(10))       # Airport code for travel (e.g. "BNE", "SYD", "KTA")
    site_contact = db.Column(db.String(200))      # On-site contact name / phone
    site_manager_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    entries = db.relationship('DailyEntry', backref='project', lazy=True)
    site_manager = db.relationship('User', foreign_keys=[site_manager_user_id], lazy=True)
    planned_data = db.relationship('PlannedData', backref='project',
                                   cascade='all, delete-orphan', lazy=True)
    non_work_dates = db.relationship('ProjectNonWorkDate', backref='project',
                                     cascade='all, delete-orphan',
                                     order_by='ProjectNonWorkDate.date')
    budgeted_roles = db.relationship('ProjectBudgetedRole', backref='project',
                                     cascade='all, delete-orphan', lazy=True)

    def __repr__(self):
        return f'<Project {self.name}>'


class UserProjectAccess(db.Model):
    __tablename__ = 'user_project_access'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    granted_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    granted_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', foreign_keys=[user_id])
    project = db.relationship('Project', foreign_keys=[project_id])
    granted_by_user = db.relationship('User', foreign_keys=[granted_by])

    __table_args__ = (
        db.UniqueConstraint('user_id', 'project_id'),
    )


class Role(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    delay_rate = db.Column(db.Float)
    group_name = db.Column(db.String(100))   # scheduling role group (e.g. "Supervisor", "Labourer")
    employees = db.relationship('Employee', backref='role_obj', lazy=True)

    def __repr__(self):
        return f'<Role {self.name}>'


class Employee(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    role = db.Column(db.String(100))              # display string, synced from roles on save
    role_id = db.Column(db.Integer, db.ForeignKey('role.id'), nullable=True)  # legacy primary role
    delay_rate = db.Column(db.Float)              # overridable; defaults to max of assigned roles
    active = db.Column(db.Boolean, default=True)
    requires_accommodation = db.Column(db.Boolean, default=True)  # False for locals who don't need accommodation
    termination_date = db.Column(db.Date, nullable=True)  # Employee drops off schedule after this date
    home_base = db.Column(db.String(50), nullable=True)  # e.g. 'sydney', 'melbourne' — for office/travel grouping
    home_airport = db.Column(db.String(10), nullable=True)  # e.g. 'SYD','MEL','BNE' or 'DRIVES' = no flights needed
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    roles = db.relationship('Role', secondary='employee_roles', lazy='subquery',
                            backref=db.backref('member_employees', lazy=True))

    def __repr__(self):
        return f'<Employee {self.name}>'


class MachineGroup(db.Model):
    """Optional grouping for machines (e.g. 'Welding Setup', 'Deployment')."""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    delay_rate = db.Column(db.Float)              # shared rate for the whole group
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    machines = db.relationship('Machine', backref='group', lazy=True)

    def __repr__(self):
        return f'<MachineGroup {self.name}>'


class Machine(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    plant_id = db.Column(db.String(100))           # internal plant/fleet ID
    machine_type = db.Column(db.String(100))
    description = db.Column(db.Text)               # what the item is / notes
    delay_rate = db.Column(db.Float)               # own rate for this individual item (independent of group)
    group_id = db.Column(db.Integer, db.ForeignKey('machine_group.id'), nullable=True)
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    # Extended equipment tracking fields
    acquired_date = db.Column(db.Date, nullable=True)
    dispose_by_date = db.Column(db.Date, nullable=True)
    next_inspection_date = db.Column(db.Date, nullable=True)
    inspection_interval_days = db.Column(db.Integer, nullable=True)
    storage_instructions = db.Column(db.Text, nullable=True)
    service_instructions = db.Column(db.Text, nullable=True)
    spare_parts_notes = db.Column(db.Text, nullable=True)
    disposal_procedure = db.Column(db.Text, nullable=True)
    serial_number = db.Column(db.String(200), nullable=True)
    manufacturer = db.Column(db.String(200), nullable=True)
    model_number = db.Column(db.String(200), nullable=True)

    def __repr__(self):
        return f'<Machine {self.name}>'


class DailyEntry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    entry_date = db.Column(db.Date, nullable=False)
    lot_number = db.Column(db.String(100))
    location = db.Column(db.String(200))
    material = db.Column(db.String(200))
    num_people = db.Column(db.Integer)
    install_hours = db.Column(db.Float, default=0)
    install_sqm = db.Column(db.Float, default=0)       # actual SQM installed this entry
    delay_hours = db.Column(db.Float, default=0)            # wet weather delay hours
    delay_billable = db.Column(db.Boolean, default=True)   # legacy — kept for compat
    delay_reason = db.Column(db.Text)                       # e.g. "Wet Weather"
    delay_description = db.Column(db.Text)                  # description for standdown emails
    own_delay_hours = db.Column(db.Float, default=0)       # internal delays (hidden from client view)
    own_delay_description = db.Column(db.Text)             # internal delay notes
    machines_stood_down = db.Column(db.Boolean, default=False)  # hired machines stood down
    weather = db.Column(db.String(200))             # weather conditions for the day
    notes = db.Column(db.Text)
    other_work_description = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    local_id = db.Column(db.String(100), nullable=True, index=True)
    form_opened_at = db.Column(db.DateTime, nullable=True)   # when user opened the form (mobile)

    employees = db.relationship(
        'Employee', secondary=entry_employees, lazy='subquery',
        backref=db.backref('entries', lazy=True)
    )
    machines = db.relationship(
        'Machine', secondary=entry_machines, lazy='subquery',
        backref=db.backref('entries', lazy=True)
    )
    photos = db.relationship('EntryPhoto', backref='entry',
                             cascade='all, delete-orphan', lazy=True)
    production_lines = db.relationship('EntryProductionLine', backref='entry',
                                        cascade='all, delete-orphan', lazy=True,
                                        order_by='EntryProductionLine.id')
    delay_lines = db.relationship('EntryDelayLine', backref='entry',
                                    cascade='all, delete-orphan', lazy=True,
                                    order_by='EntryDelayLine.id')
    variation_lines = db.relationship('EntryVariationLine', backref='entry',
                                       cascade='all, delete-orphan', lazy=True,
                                       order_by='EntryVariationLine.id')
    other_activity_lines = db.relationship('EntryOtherActivityLine', backref='entry',
                                            cascade='all, delete-orphan', lazy=True,
                                            order_by='EntryOtherActivityLine.id')

    @property
    def day_name(self):
        return self.entry_date.strftime('%A') if self.entry_date else ''

    @property
    def total_sqm(self):
        """Total sqm from production lines, falling back to install_sqm."""
        if self.production_lines:
            return sum(pl.install_sqm or 0 for pl in self.production_lines)
        return self.install_sqm or 0

    @property
    def total_hours(self):
        """Total hours from production lines, falling back to install_hours."""
        if self.production_lines:
            return sum(pl.install_hours or 0 for pl in self.production_lines)
        return self.install_hours or 0

    @property
    def total_delay_hours_from_lines(self):
        """Total delay hours from delay lines, falling back to legacy delay_hours."""
        if self.delay_lines:
            return sum(dl.hours or 0 for dl in self.delay_lines)
        return self.delay_hours or 0

    @property
    def total_variation_hours(self):
        """Total hours from variation lines."""
        return sum(vl.hours or 0 for vl in self.variation_lines) if self.variation_lines else 0

    @property
    def total_other_activity_hours(self):
        """Total hours from other activity lines."""
        return sum(ol.hours or 0 for ol in self.other_activity_lines) if self.other_activity_lines else 0

    @property
    def production_person_hours(self):
        """Total person-hours across production lines."""
        if self.production_lines:
            return sum(pl.person_hours for pl in self.production_lines)
        return 0

    @property
    def variation_person_hours(self):
        """Total person-hours across variation lines."""
        if self.variation_lines:
            total = 0
            for vl in self.variation_lines:
                emp_ids = vl.billed_employee_ids
                total += (vl.hours or 0) * len(emp_ids) if emp_ids else 0
            return total
        return 0

    @property
    def other_activity_person_hours(self):
        """Total person-hours across other activity lines."""
        if self.other_activity_lines:
            return sum(ol.person_hours for ol in self.other_activity_lines)
        return 0

    @property
    def total_person_hours_accounted(self):
        """Sum of all person-hours across production, variation, and other activities."""
        return self.production_person_hours + self.variation_person_hours + self.other_activity_person_hours

    @property
    def available_person_hours(self):
        """Total available person-hours = crew count × hours_per_day from project."""
        crew_count = len(self.employees) if self.employees else (self.num_people or 0)
        hours_per_day = self.project.hours_per_day if self.project and self.project.hours_per_day else 8
        return crew_count * hours_per_day

    @property
    def utilisation_pct(self):
        """Percentage of available person-hours accounted for."""
        avail = self.available_person_hours
        if avail <= 0:
            return 0
        return round(self.total_person_hours_accounted / avail * 100, 1)

    def __repr__(self):
        return f'<DailyEntry {self.entry_date} - {self.project.name}>'


class EntryDelayLine(db.Model):
    """One delay event within a daily entry."""
    id = db.Column(db.Integer, primary_key=True)
    entry_id = db.Column(db.Integer, db.ForeignKey('daily_entry.id'), nullable=False)
    reason = db.Column(db.String(100))       # Wet Weather, Wind, Client Delay, etc.
    hours = db.Column(db.Float, default=0)
    description = db.Column(db.Text)

    def __repr__(self):
        return f'<EntryDelayLine {self.reason} {self.hours}h>'


class EntryVariationLine(db.Model):
    """Client-directed variation work within a daily entry."""
    id = db.Column(db.Integer, primary_key=True)
    entry_id = db.Column(db.Integer, db.ForeignKey('daily_entry.id'), nullable=False)
    variation_number = db.Column(db.String(100))
    description = db.Column(db.Text)
    hours = db.Column(db.Float, default=0)
    employee_ids_json = db.Column(db.Text)     # JSON array of employee IDs to bill
    machine_ids_json = db.Column(db.Text)      # JSON array of machine IDs to bill

    @property
    def billed_employee_ids(self):
        import json
        return json.loads(self.employee_ids_json) if self.employee_ids_json else []

    @property
    def billed_machine_ids(self):
        import json
        return json.loads(self.machine_ids_json) if self.machine_ids_json else []

    @property
    def num_crew(self):
        return len(self.billed_employee_ids)

    @property
    def person_hours(self):
        return (self.hours or 0) * self.num_crew

    def __repr__(self):
        return f'<EntryVariationLine V{self.variation_number} {self.hours}h>'


class EntryProductionLine(db.Model):
    """One lot/material production line within a daily entry."""
    id = db.Column(db.Integer, primary_key=True)
    entry_id = db.Column(db.Integer, db.ForeignKey('daily_entry.id'), nullable=False)
    lot_number = db.Column(db.String(100))
    material = db.Column(db.String(200))
    activity_type = db.Column(db.String(50), default='deploy')  # deploy / weld
    install_hours = db.Column(db.Float, default=0)
    install_sqm = db.Column(db.Float, default=0)
    weld_metres = db.Column(db.Float, default=0)               # metres of seam welded
    employee_ids_json = db.Column(db.Text)     # JSON array of employee IDs assigned to this line

    @property
    def crew_employee_ids(self):
        import json
        return json.loads(self.employee_ids_json) if self.employee_ids_json else []

    @property
    def num_crew(self):
        return len(self.crew_employee_ids)

    @property
    def person_hours(self):
        return (self.install_hours or 0) * self.num_crew

    def __repr__(self):
        return f'<EntryProductionLine {self.lot_number} {self.material} {self.install_hours}h {self.install_sqm}m2>'


class EntryOtherActivityLine(db.Model):
    """Non-deployment activity within a daily entry (inductions, material runs, etc.)."""
    id = db.Column(db.Integer, primary_key=True)
    entry_id = db.Column(db.Integer, db.ForeignKey('daily_entry.id'), nullable=False)
    description = db.Column(db.Text)
    hours = db.Column(db.Float, default=0)
    employee_ids_json = db.Column(db.Text)     # JSON array of employee IDs assigned

    @property
    def crew_employee_ids(self):
        import json
        return json.loads(self.employee_ids_json) if self.employee_ids_json else []

    @property
    def num_crew(self):
        return len(self.crew_employee_ids)

    @property
    def person_hours(self):
        return (self.hours or 0) * self.num_crew

    def __repr__(self):
        return f'<EntryOtherActivityLine {self.description} {self.hours}h>'


class EntryPhoto(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    entry_id = db.Column(db.Integer, db.ForeignKey('daily_entry.id'), nullable=False)
    filename = db.Column(db.String(500), nullable=False)
    original_name = db.Column(db.String(500))
    caption = db.Column(db.String(500))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f'<EntryPhoto {self.filename}>'


class HiredMachine(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    machine_name = db.Column(db.String(200), nullable=False)
    plant_id = db.Column(db.String(100))           # plant/fleet ID from hire company
    group_id = db.Column(db.Integer, db.ForeignKey('machine_group.id'), nullable=True)
    machine_type = db.Column(db.String(100))
    description = db.Column(db.Text)               # description of the item
    hire_company = db.Column(db.String(200))
    hire_company_email = db.Column(db.String(200))
    hire_company_phone = db.Column(db.String(50))
    delivery_date = db.Column(db.Date)
    return_date = db.Column(db.Date)
    cost_per_day = db.Column(db.Float)
    cost_per_week = db.Column(db.Float)
    delay_rate = db.Column(db.Float)              # $/hr rate charged for delay billing
    count_saturdays = db.Column(db.Boolean, default=True)
    invoice_filename = db.Column(db.String(500))
    invoice_original_name = db.Column(db.String(500))
    notes = db.Column(db.Text)
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    project = db.relationship('Project', backref='hired_machines')
    group = db.relationship('MachineGroup', backref='hired_machines')
    stand_downs = db.relationship(
        'StandDown', backref='hired_machine',
        cascade='all, delete-orphan',
        order_by='StandDown.stand_down_date'
    )

    def __repr__(self):
        return f'<HiredMachine {self.machine_name} - {self.hire_company}>'


class StandDown(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    hired_machine_id = db.Column(db.Integer, db.ForeignKey('hired_machine.id'), nullable=False)
    entry_id = db.Column(db.Integer, db.ForeignKey('daily_entry.id'), nullable=True)
    stand_down_date = db.Column(db.Date, nullable=False)
    reason = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    entry = db.relationship('DailyEntry', backref='stand_downs')

    def __repr__(self):
        return f'<StandDown {self.stand_down_date} - {self.reason[:30]}>'


class HireCompany(db.Model):
    """Database of hire companies for future reference."""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False, unique=True)
    phone = db.Column(db.String(50))
    email = db.Column(db.String(200))
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    reviews = db.relationship('HireReview', backref='company',
                               cascade='all, delete-orphan', lazy=True,
                               order_by='HireReview.created_at.desc()')

    @property
    def avg_overall(self):
        """Average score out of 10 across all reviews."""
        if not self.reviews:
            return None
        scores = [r.avg_score for r in self.reviews if r.avg_score is not None]
        return round(sum(scores) / len(scores), 1) if scores else None

    @property
    def pct_score(self):
        """Overall percentage score (avg × 10)."""
        avg = self.avg_overall
        return round(avg * 10) if avg is not None else None

    def __repr__(self):
        return f'<HireCompany {self.name}>'


class HireReview(db.Model):
    """Review/rating for a specific hire from a company."""
    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey('hire_company.id'), nullable=False)
    hired_machine_id = db.Column(db.Integer, db.ForeignKey('hired_machine.id'), nullable=True)
    machine_description = db.Column(db.String(300))
    weekly_rate = db.Column(db.Float)
    rating_standdown = db.Column(db.Integer)
    rating_communication = db.Column(db.Integer)
    rating_delivery = db.Column(db.Integer)
    comments = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    hired_machine = db.relationship('HiredMachine', backref='reviews')

    @property
    def avg_score(self):
        scores = [s for s in [self.rating_standdown, self.rating_communication, self.rating_delivery] if s is not None]
        return round(sum(scores) / len(scores), 1) if scores else None

    def __repr__(self):
        return f'<HireReview company={self.company_id}>'


class PlannedData(db.Model):
    """Stores planned daily installation data uploaded from spreadsheet."""
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    lot = db.Column(db.String(100))
    location = db.Column(db.String(200))
    material = db.Column(db.String(200))
    day_number = db.Column(db.Integer)     # installation day number (not calendar date)
    planned_sqm = db.Column(db.Float)

    def __repr__(self):
        return f'<PlannedData {self.lot} {self.material} Day {self.day_number}>'


class ProjectNonWorkDate(db.Model):
    """Non-working dates for a project (public holidays, shutdowns, wet weather days, etc.)."""
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    reason = db.Column(db.String(500))

    def __repr__(self):
        return f'<ProjectNonWorkDate {self.date}>'


class ProjectBudgetedRole(db.Model):
    """Budgeted crew count per role type for a project."""
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    role_name = db.Column(db.String(100), nullable=False)
    budgeted_count = db.Column(db.Integer, nullable=False, default=1)

    def __repr__(self):
        return f'<ProjectBudgetedRole {self.role_name} x{self.budgeted_count}>'


class ProjectMachine(db.Model):
    """Owned (own fleet) machines assigned to a specific project."""
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    machine_id = db.Column(db.Integer, db.ForeignKey('machine.id'), nullable=False)
    assigned_date = db.Column(db.Date)        # optional: date machine arrived on site
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    project = db.relationship('Project', backref='project_machines')
    machine = db.relationship('Machine', backref='project_assignments')

    def __repr__(self):
        return f'<ProjectMachine project={self.project_id} machine={self.machine_id}>'


class EquipmentAssignmentHistory(db.Model):
    """Tracks every time a machine is assigned/moved between projects."""
    id = db.Column(db.Integer, primary_key=True)
    machine_id = db.Column(db.Integer, db.ForeignKey('machine.id'), nullable=False)
    from_project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=True)
    to_project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=True)
    moved_at = db.Column(db.DateTime, default=datetime.utcnow)
    moved_by = db.Column(db.String(200))  # username who made the change

    machine = db.relationship('Machine', backref='assignment_history')
    from_project = db.relationship('Project', foreign_keys=[from_project_id])
    to_project = db.relationship('Project', foreign_keys=[to_project_id])

    def __repr__(self):
        return f'<EquipmentAssignmentHistory machine={self.machine_id}>'


class ProjectEquipmentRequirement(db.Model):
    """A named equipment requirement for a project (e.g. 'Excavator x2')."""
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    label = db.Column(db.String(200), nullable=False)       # free-text name, e.g. "Excavator"
    required_count = db.Column(db.Integer, nullable=False, default=1)

    project = db.relationship('Project', backref='equipment_requirements')

    def __repr__(self):
        return f'<ProjectEquipmentRequirement {self.label} x{self.required_count}>'


class ProjectEquipmentAssignment(db.Model):
    """Explicitly assigns a specific machine (owned or hired) to an equipment requirement."""
    id = db.Column(db.Integer, primary_key=True)
    requirement_id = db.Column(db.Integer, db.ForeignKey('project_equipment_requirement.id'), nullable=False)
    machine_id = db.Column(db.Integer, db.ForeignKey('machine.id'), nullable=True)
    hired_machine_id = db.Column(db.Integer, db.ForeignKey('hired_machine.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    requirement = db.relationship('ProjectEquipmentRequirement', backref='assignments')
    machine = db.relationship('Machine')
    hired_machine = db.relationship('HiredMachine')

    @property
    def display_name(self):
        if self.machine:
            name = self.machine.name
            if self.machine.plant_id:
                name += f' ({self.machine.plant_id})'
            return name
        if self.hired_machine:
            name = self.hired_machine.machine_name
            if self.hired_machine.plant_id:
                name += f' ({self.hired_machine.plant_id})'
            return name
        return '—'

    @property
    def source(self):
        return 'Own Fleet' if self.machine_id else 'Hired'

    def __repr__(self):
        return f'<ProjectEquipmentAssignment req={self.requirement_id}>'


class ProjectWorkedSunday(db.Model):
    """Sundays that were actually worked on a project (exceptions to the Sunday skip rule)."""
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    reason = db.Column(db.String(500))

    project = db.relationship('Project', backref='worked_sundays')

    def __repr__(self):
        return f'<ProjectWorkedSunday {self.date}>'


class ProjectDocument(db.Model):
    """Documents attached to a project (drawings, specifications, etc.)."""
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    filename = db.Column(db.String(500), nullable=False)       # stored filename (UUID)
    original_name = db.Column(db.String(500))                  # original uploaded filename
    doc_type = db.Column(db.String(50), default='other')       # drawing / specification / other
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)

    project = db.relationship('Project', backref='documents')

    def __repr__(self):
        return f'<ProjectDocument {self.original_name}>'


# ---------------------------------------------------------------------------
# Scheduling models
# ---------------------------------------------------------------------------

class SwingPattern(db.Model):
    """RDO swing pattern definition, e.g. '2 weeks on, 7 days off'."""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    work_weeks = db.Column(db.Integer, nullable=False)  # weeks on site per cycle
    off_days = db.Column(db.Integer, nullable=False)    # consecutive RDO days per cycle
    description = db.Column(db.String(300))

    @property
    def cycle_length(self):
        return self.work_weeks * 7 + self.off_days

    def __repr__(self):
        return f'<SwingPattern {self.name}>'


class EmployeeSwing(db.Model):
    """Assigns a swing pattern to an employee from a given start date."""
    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey('employee.id'), nullable=False)
    pattern_id = db.Column(db.Integer, db.ForeignKey('swing_pattern.id'), nullable=False)
    start_date = db.Column(db.Date, nullable=False)
    day_offset = db.Column(db.Integer, default=0)   # shift cycle start by N days
    notes = db.Column(db.String(300))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    employee = db.relationship('Employee', backref='swings')
    pattern = db.relationship('SwingPattern', backref='employee_swings')

    def is_rdo(self, check_date):
        """Returns True if check_date falls on an R&R/off period under this swing assignment."""
        days_since = (check_date - self.start_date).days + (self.day_offset or 0)
        if days_since < 0:
            return False
        position = days_since % self.pattern.cycle_length
        return position >= self.pattern.work_weeks * 7

    def __repr__(self):
        return f'<EmployeeSwing emp={self.employee_id} pattern={self.pattern_id}>'


class ScheduleDayOverride(db.Model):
    """Single-day schedule override for an employee — takes top priority in the grid."""
    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey('employee.id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    # status: available / project / annual / sick / personal / r_and_r / travel / rdo / office / other
    status = db.Column(db.String(20), nullable=False)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=True)
    is_half_day = db.Column(db.Boolean, default=False)  # True = half travel + half on site (project_id = site project)
    office_location = db.Column(db.String(50))  # 'sydney' or 'melbourne' when status='office'
    notes = db.Column(db.String(300))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    employee = db.relationship('Employee', backref='day_overrides')
    project = db.relationship('Project')

    __table_args__ = (db.UniqueConstraint('employee_id', 'date', name='uq_override_emp_date'),)

    def __repr__(self):
        return f'<ScheduleDayOverride emp={self.employee_id} {self.date} {self.status}>'


class EmployeeLeave(db.Model):
    """Leave period for an employee (annual, sick, etc.)."""
    LEAVE_TYPES = ['annual', 'sick', 'personal', 'r_and_r', 'travel', 'other']

    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey('employee.id'), nullable=False)
    date_from = db.Column(db.Date, nullable=False)
    date_to = db.Column(db.Date, nullable=False)
    leave_type = db.Column(db.String(50), default='annual')
    notes = db.Column(db.String(300))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    employee = db.relationship('Employee', backref='leaves')

    def __repr__(self):
        return f'<EmployeeLeave emp={self.employee_id} {self.date_from}-{self.date_to}>'


class ProjectAssignment(db.Model):
    """Assigns an employee to a project for a date range."""
    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey('employee.id'), nullable=False)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    date_from = db.Column(db.Date, nullable=False)
    date_to = db.Column(db.Date, nullable=True)    # None = ongoing / no end date
    notes = db.Column(db.String(300))
    scheduled_role_id = db.Column(db.Integer, db.ForeignKey('role.id'), nullable=True)
    # Transport overrides for travel planning
    transport_to_mode = db.Column(db.String(20))    # fly / drive / local — overrides auto-detection
    transport_from_mode = db.Column(db.String(20))   # fly / drive / local — overrides auto-detection
    needs_accommodation = db.Column(db.Boolean, nullable=True)  # NULL = use employee default, True/False = override per job
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    employee = db.relationship('Employee', backref='project_assignments')
    project = db.relationship('Project', backref='employee_assignments')
    scheduled_role = db.relationship('Role', foreign_keys=[scheduled_role_id])

    def __repr__(self):
        return f'<ProjectAssignment emp={self.employee_id} proj={self.project_id}>'


# ---------------------------------------------------------------------------
# Equipment / breakdown models
# ---------------------------------------------------------------------------

AUSTRALIAN_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']

class MachineBreakdown(db.Model):
    """Records a breakdown incident for an owned or hired machine."""
    id = db.Column(db.Integer, primary_key=True)
    machine_id = db.Column(db.Integer, db.ForeignKey('machine.id'), nullable=True)
    hired_machine_id = db.Column(db.Integer, db.ForeignKey('hired_machine.id'), nullable=True)
    incident_date = db.Column(db.Date, nullable=False)
    incident_time = db.Column(db.String(10))        # HH:MM string
    description = db.Column(db.Text)
    repairing_by = db.Column(db.String(200))
    repair_status = db.Column(db.String(20), default='pending')   # pending / in_progress / completed
    anticipated_return = db.Column(db.Date)
    resolved_date = db.Column(db.Date)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    local_id = db.Column(db.String(100), nullable=True, index=True)

    machine = db.relationship('Machine', backref='breakdowns')
    hired_machine = db.relationship('HiredMachine', backref='breakdowns')
    photos = db.relationship('BreakdownPhoto', backref='breakdown',
                             cascade='all, delete-orphan', lazy=True)

    @property
    def is_active(self):
        return self.repair_status != 'completed'

    def __repr__(self):
        return f'<MachineBreakdown {self.incident_date} status={self.repair_status}>'


class BreakdownPhoto(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    breakdown_id = db.Column(db.Integer, db.ForeignKey('machine_breakdown.id'), nullable=False)
    filename = db.Column(db.String(500), nullable=False)
    original_name = db.Column(db.String(500))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f'<BreakdownPhoto {self.filename}>'


# ---------------------------------------------------------------------------
# Equipment transfer, checklist, and daily check models
# ---------------------------------------------------------------------------

class TransferBatch(db.Model):
    """A transfer event — one or more machines moving between projects."""
    id = db.Column(db.Integer, primary_key=True)
    from_project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=True)
    to_project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=True)
    scheduled_date = db.Column(db.Date, nullable=False)
    pickup_location = db.Column(db.String(500))      # auto-filled from source project site_address
    dropoff_location = db.Column(db.String(500))      # auto-filled from dest project site_address
    travel_notes = db.Column(db.Text)
    status = db.Column(db.String(20), default='scheduled')  # scheduled / in_transit / completed / cancelled
    # Personnel
    pre_check_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)     # source supervisor
    transport_user_ids = db.Column(db.Text, nullable=True)                                  # comma-separated user IDs
    transport_contact = db.Column(db.String(500))                                           # free text contact info
    arrival_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)        # destination supervisor
    # Metadata
    created_by = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime, nullable=True)
    reminder_sent = db.Column(db.Boolean, default=False)

    from_project = db.relationship('Project', foreign_keys=[from_project_id])
    to_project = db.relationship('Project', foreign_keys=[to_project_id])
    pre_check_user = db.relationship('User', foreign_keys=[pre_check_user_id])
    arrival_user = db.relationship('User', foreign_keys=[arrival_user_id])
    items = db.relationship('MachineTransfer', backref='batch', cascade='all, delete-orphan', lazy=True)

    @property
    def all_pre_checked(self):
        return all(t.pre_check_id for t in self.items)

    @property
    def all_arrived(self):
        return all(t.arrival_check_id for t in self.items)

    def __repr__(self):
        return f'<TransferBatch {self.id} {self.status}>'


class MachineTransfer(db.Model):
    """One machine within a transfer batch."""
    id = db.Column(db.Integer, primary_key=True)
    batch_id = db.Column(db.Integer, db.ForeignKey('transfer_batch.id'), nullable=True)
    machine_id = db.Column(db.Integer, db.ForeignKey('machine.id'), nullable=False)
    from_project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=True)
    to_project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=True)
    scheduled_date = db.Column(db.Date, nullable=False)
    travel_notes = db.Column(db.Text)
    transport_contact = db.Column(db.String(200))
    status = db.Column(db.String(20), default='scheduled')  # scheduled / in_transit / completed / cancelled
    reminder_sent = db.Column(db.Boolean, default=False)
    created_by = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime, nullable=True)
    # Pre-move check
    pre_check_id = db.Column(db.Integer, db.ForeignKey('machine_daily_check.id'), nullable=True)
    pre_check_notes = db.Column(db.Text, nullable=True)
    # Arrival check
    arrival_check_id = db.Column(db.Integer, db.ForeignKey('machine_daily_check.id'), nullable=True)
    arrival_check_notes = db.Column(db.Text, nullable=True)
    arrived_by_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    arrived_at = db.Column(db.DateTime, nullable=True)

    machine = db.relationship('Machine', backref='transfers')
    from_project = db.relationship('Project', foreign_keys=[from_project_id])
    to_project = db.relationship('Project', foreign_keys=[to_project_id])
    pre_check = db.relationship('MachineDailyCheck', foreign_keys=[pre_check_id])
    arrival_check = db.relationship('MachineDailyCheck', foreign_keys=[arrival_check_id])
    arrived_by = db.relationship('User', foreign_keys=[arrived_by_user_id])

    def __repr__(self):
        return f'<MachineTransfer machine={self.machine_id} status={self.status}>'


class SiteEquipmentChecklist(db.Model):
    """Periodic full-fleet audit for a project site."""
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    checklist_name = db.Column(db.String(200), nullable=False)
    due_date = db.Column(db.Date, nullable=False)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime, nullable=True)
    notes = db.Column(db.Text)

    project = db.relationship('Project', backref='equipment_checklists')
    created_by_user = db.relationship('User', foreign_keys=[created_by_user_id])
    items = db.relationship('SiteEquipmentChecklistItem', backref='checklist',
                            cascade='all, delete-orphan', lazy=True)

    def __repr__(self):
        return f'<SiteEquipmentChecklist {self.checklist_name}>'


class SiteEquipmentChecklistItem(db.Model):
    """One row per machine per checklist."""
    id = db.Column(db.Integer, primary_key=True)
    checklist_id = db.Column(db.Integer, db.ForeignKey('site_equipment_checklist.id'), nullable=False)
    machine_id = db.Column(db.Integer, db.ForeignKey('machine.id'), nullable=True)
    hired_machine_id = db.Column(db.Integer, db.ForeignKey('hired_machine.id'), nullable=True)
    machine_label = db.Column(db.String(300))
    checked = db.Column(db.Boolean, default=False)
    checked_by_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    checked_at = db.Column(db.DateTime, nullable=True)
    condition = db.Column(db.String(20), nullable=True)  # good / fair / poor
    photo_filename = db.Column(db.String(500), nullable=True)
    photo_original_name = db.Column(db.String(500), nullable=True)
    notes = db.Column(db.Text, nullable=True)

    machine = db.relationship('Machine', backref='checklist_items')
    hired_machine = db.relationship('HiredMachine', backref='checklist_items')
    checked_by_user = db.relationship('User', foreign_keys=[checked_by_user_id])

    def __repr__(self):
        return f'<SiteEquipmentChecklistItem checklist={self.checklist_id} machine_label={self.machine_label}>'


class MachineDailyCheck(db.Model):
    """Morning supervisor walk-around — one record per machine per day per project."""
    id = db.Column(db.Integer, primary_key=True)
    machine_id = db.Column(db.Integer, db.ForeignKey('machine.id'), nullable=True)
    hired_machine_id = db.Column(db.Integer, db.ForeignKey('hired_machine.id'), nullable=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    check_date = db.Column(db.Date, nullable=False)
    checked_by_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    condition = db.Column(db.String(20), nullable=False)  # good / fair / poor / broken_down
    hours_reading = db.Column(db.Float, nullable=True)    # current machine hours meter reading
    notes = db.Column(db.Text, nullable=True)
    photo_filename = db.Column(db.String(500), nullable=True)
    photo_original_name = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    breakdown_id = db.Column(db.Integer, db.ForeignKey('machine_breakdown.id'), nullable=True)

    machine = db.relationship('Machine', backref='daily_checks')
    hired_machine = db.relationship('HiredMachine', backref='daily_checks')
    project = db.relationship('Project', backref='daily_checks')
    checked_by_user = db.relationship('User', foreign_keys=[checked_by_user_id])
    breakdown = db.relationship('MachineBreakdown', backref='daily_check')

    __table_args__ = (
        db.UniqueConstraint('machine_id', 'project_id', 'check_date',
                            name='uq_daily_check_machine'),
        db.UniqueConstraint('hired_machine_id', 'project_id', 'check_date',
                            name='uq_daily_check_hired'),
    )

    def __repr__(self):
        return f'<MachineDailyCheck project={self.project_id} date={self.check_date}>'


class MachineDocument(db.Model):
    """Documentation attached to a machine (manuals, certs, service records, photos)."""
    id = db.Column(db.Integer, primary_key=True)
    machine_id = db.Column(db.Integer, db.ForeignKey('machine.id'), nullable=False)
    filename = db.Column(db.String(500), nullable=False)
    original_name = db.Column(db.String(500))
    doc_type = db.Column(db.String(50), default='other')  # manual / certificate / service_record / photo / other
    title = db.Column(db.String(300))
    notes = db.Column(db.Text)
    uploaded_by_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)

    machine = db.relationship('Machine', backref='documents')
    uploaded_by = db.relationship('User', foreign_keys=[uploaded_by_user_id])

    def __repr__(self):
        return f'<MachineDocument machine={self.machine_id} {self.original_name}>'


class MachineHoursLog(db.Model):
    """Tracks machine hours over time — recorded during daily checks."""
    id = db.Column(db.Integer, primary_key=True)
    machine_id = db.Column(db.Integer, db.ForeignKey('machine.id'), nullable=False)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=True)
    log_date = db.Column(db.Date, nullable=False)
    hours_reading = db.Column(db.Float, nullable=False)
    recorded_by_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    daily_check_id = db.Column(db.Integer, db.ForeignKey('machine_daily_check.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    machine = db.relationship('Machine', backref='hours_logs')
    project = db.relationship('Project')
    recorded_by = db.relationship('User', foreign_keys=[recorded_by_user_id])
    daily_check = db.relationship('MachineDailyCheck', backref='hours_log')

    def __repr__(self):
        return f'<MachineHoursLog machine={self.machine_id} {self.log_date} {self.hours_reading}h>'


class ProjectDailyTaskAssignment(db.Model):
    """Assigns who is responsible for daily tasks per project."""
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    task_type = db.Column(db.String(50), nullable=False)  # daily_entry / machine_startup
    assigned_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    project = db.relationship('Project', backref='daily_task_assignments')
    assigned_user = db.relationship('User', foreign_keys=[assigned_user_id])

    __table_args__ = (
        db.UniqueConstraint('project_id', 'task_type', name='uq_project_task_type'),
    )

    def __repr__(self):
        return f'<ProjectDailyTaskAssignment project={self.project_id} task={self.task_type}>'


# Association table for scheduled check ↔ machines
scheduled_check_machines = db.Table(
    'scheduled_check_machines',
    db.Column('check_id', db.Integer, db.ForeignKey('scheduled_equipment_check.id'), primary_key=True),
    db.Column('machine_id', db.Integer, db.ForeignKey('machine.id'), primary_key=True),
)


class ScheduledEquipmentCheck(db.Model):
    """Admin-assigned equipment check — one-time or recurring, for specific machines."""
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    name = db.Column(db.String(300), nullable=False)          # e.g. "Initial mobilisation check", "Monthly inspection"
    assigned_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    frequency = db.Column(db.String(20), nullable=False, default='one_time')  # one_time / daily / weekly / fortnightly / monthly / custom
    interval_days = db.Column(db.Integer, nullable=True)      # for custom frequency
    start_date = db.Column(db.Date, nullable=False)
    next_due_date = db.Column(db.Date, nullable=False)
    last_completed_date = db.Column(db.Date, nullable=True)
    active = db.Column(db.Boolean, default=True)
    notes = db.Column(db.Text)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    project = db.relationship('Project', backref='scheduled_checks')
    assigned_user = db.relationship('User', foreign_keys=[assigned_user_id], backref='assigned_checks')
    created_by = db.relationship('User', foreign_keys=[created_by_user_id])
    machines = db.relationship('Machine', secondary=scheduled_check_machines, backref='scheduled_checks')

    def advance_due_date(self):
        """After completion, advance next_due_date based on frequency."""
        from datetime import timedelta
        self.last_completed_date = self.next_due_date
        freq_map = {
            'daily': 1, 'weekly': 7, 'fortnightly': 14, 'monthly': 30,
        }
        if self.frequency == 'one_time':
            self.active = False
        elif self.frequency == 'custom' and self.interval_days:
            self.next_due_date = self.next_due_date + timedelta(days=self.interval_days)
        elif self.frequency in freq_map:
            self.next_due_date = self.next_due_date + timedelta(days=freq_map[self.frequency])

    def __repr__(self):
        return f'<ScheduledEquipmentCheck {self.name} project={self.project_id}>'


class ScheduledCheckCompletion(db.Model):
    """Records each time a scheduled check is completed."""
    id = db.Column(db.Integer, primary_key=True)
    scheduled_check_id = db.Column(db.Integer, db.ForeignKey('scheduled_equipment_check.id'), nullable=False)
    completed_date = db.Column(db.Date, nullable=False)
    completed_by_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    scheduled_check = db.relationship('ScheduledEquipmentCheck', backref='completions')
    completed_by = db.relationship('User', foreign_keys=[completed_by_user_id])

    def __repr__(self):
        return f'<ScheduledCheckCompletion check={self.scheduled_check_id} date={self.completed_date}>'


# ---------------------------------------------------------------------------
# Public holiday and CFMEU calendar models
# ---------------------------------------------------------------------------

class PublicHoliday(db.Model):
    """Public holiday — may apply to one or more Australian states."""
    id = db.Column(db.Integer, primary_key=True)
    state = db.Column(db.String(10))                   # legacy (kept for compat)
    states = db.Column(db.String(200))                 # comma-separated: "QLD,NSW" or "ALL"
    date = db.Column(db.Date, nullable=False)
    name = db.Column(db.String(200), nullable=False)

    def states_list(self):
        return [s.strip() for s in (self.states or self.state or '').split(',') if s.strip()]

    def __repr__(self):
        return f'<PublicHoliday {self.states} {self.date} {self.name}>'


class CFMEUDate(db.Model):
    """CFMEU shutdown/RDO date — may apply to one or more states, or ALL."""
    id = db.Column(db.Integer, primary_key=True)
    state = db.Column(db.String(10))                   # legacy (kept for compat)
    states = db.Column(db.String(200))                 # comma-separated: "QLD" or "ALL"
    date = db.Column(db.Date, nullable=False)
    name = db.Column(db.String(200), nullable=False)

    def states_list(self):
        return [s.strip() for s in (self.states or self.state or '').split(',') if s.strip()]

    def __repr__(self):
        return f'<CFMEUDate {self.states} {self.date} {self.name}>'


# ---------------------------------------------------------------------------
# Panel diagram models
# ---------------------------------------------------------------------------

class DiagramLayer(db.Model):
    """A named material/installation layer for a project with an uploaded SVG diagram."""
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    layer_name = db.Column(db.String(200), nullable=False)   # e.g. "Layer 1 – HDPE"
    svg_filename = db.Column(db.String(500))                 # UUID-based stored filename
    svg_original_name = db.Column(db.String(500))            # original upload filename
    bg_filename = db.Column(db.String(500))                  # background image filename (diagram view)
    bg_original_name = db.Column(db.String(500))             # original background filename
    canvas_bg_filename = db.Column(db.String(500))           # background image for as-built canvas
    canvas_bg_original_name = db.Column(db.String(500))
    description = db.Column(db.Text)
    canvas_elements = db.Column(db.Text)   # JSON: {"seams": [...], "repairs": [...]}
    sort_order = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    project = db.relationship('Project', backref='diagram_layers')
    panels = db.relationship('PanelInstallRecord', backref='layer',
                              cascade='all, delete-orphan', lazy=True)

    @property
    def total_panels(self):
        return len(self.panels)

    @property
    def installed_panels(self):
        return sum(1 for p in self.panels if p.status == 'installed')

    def __repr__(self):
        return f'<DiagramLayer {self.layer_name}>'


class PanelInstallRecord(db.Model):
    """Records the installation status of a single panel in a diagram layer."""
    id = db.Column(db.Integer, primary_key=True)
    layer_id = db.Column(db.Integer, db.ForeignKey('diagram_layer.id'), nullable=False)
    panel_id = db.Column(db.String(200), nullable=False)   # SVG element id attribute
    panel_label = db.Column(db.String(200))                # display label e.g. "P-001"
    # status: planned / installed / issue
    status = db.Column(db.String(20), default='planned', nullable=False)
    installed_date = db.Column(db.Date)
    employee_id = db.Column(db.Integer, db.ForeignKey('employee.id'), nullable=True)
    notes = db.Column(db.Text)
    roll_number    = db.Column(db.String(100))
    install_time   = db.Column(db.String(10))   # HH:MM
    width_m        = db.Column(db.Float)
    length_m       = db.Column(db.Float)
    area_sqm       = db.Column(db.Float)
    panel_type     = db.Column(db.String(100))
    canvas_x      = db.Column(db.Float)
    canvas_y      = db.Column(db.Float)
    canvas_w      = db.Column(db.Float)
    canvas_h      = db.Column(db.Float)
    canvas_points = db.Column(db.Text)   # JSON: [[x1,y1],[x2,y2],...] for polygon panels
    source        = db.Column(db.String(20))  # 'diagram' or 'canvas' — which view created this record
    recorded_by_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    employee = db.relationship('Employee')
    recorded_by = db.relationship('User')

    __table_args__ = (
        db.UniqueConstraint('layer_id', 'panel_id', name='uq_panel_layer_id'),
    )

    def __repr__(self):
        return f'<PanelInstallRecord {self.panel_id} {self.status}>'


class DeviceToken(db.Model):
    __tablename__ = 'device_token'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    token = db.Column(db.String(500), nullable=False)
    platform = db.Column(db.String(20), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = db.relationship('User', backref='device_tokens')

    __table_args__ = (
        db.UniqueConstraint('user_id', 'token', name='uq_user_token'),
    )


# ---------------------------------------------------------------------------
# Travel & accommodation models
# ---------------------------------------------------------------------------

class FlightBooking(db.Model):
    """Individual flight leg for an employee on a travel day."""
    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey('employee.id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    direction = db.Column(db.String(20), nullable=False)  # 'inbound' or 'outbound'
    airline = db.Column(db.String(200))
    flight_number = db.Column(db.String(50))
    departure_airport = db.Column(db.String(100))
    departure_time = db.Column(db.String(10))       # HH:MM
    arrival_airport = db.Column(db.String(100))
    arrival_time = db.Column(db.String(10))          # HH:MM
    booking_reference = db.Column(db.String(100))
    notes = db.Column(db.String(500))
    # Ground transport after arrival
    ground_transport = db.Column(db.String(30))      # uber / hire_car / pickup / public_transport / self_drive / shuttle
    ground_destination = db.Column(db.String(300))    # Where they're going after (address, accom name, site)
    ground_with_employee_id = db.Column(db.Integer, db.ForeignKey('employee.id'), nullable=True)  # Sharing with
    ground_pickup_by = db.Column(db.String(200))      # Person picking them up (name / phone)
    hire_car_company = db.Column(db.String(200))       # Hire car company
    hire_car_reference = db.Column(db.String(100))     # Hire car booking ref
    hire_car_booked_for = db.Column(db.String(200))    # Whose name the car is under
    ground_notes = db.Column(db.String(500))           # Any other ground transport notes
    created_by_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    employee = db.relationship('Employee', foreign_keys=[employee_id], backref='flight_bookings')
    ground_with = db.relationship('Employee', foreign_keys=[ground_with_employee_id])
    created_by = db.relationship('User', foreign_keys=[created_by_id])

    def __repr__(self):
        return f'<FlightBooking {self.employee_id} {self.date} {self.flight_number}>'


class AccommodationProperty(db.Model):
    """A shared accommodation (house, apartment, hotel) that multiple employees can be assigned to."""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(300), nullable=False)          # e.g. "4-bed house Smith St"
    property_type = db.Column(db.String(50), default='house')  # house / apartment / hotel / motel / other
    address = db.Column(db.String(500))
    phone = db.Column(db.String(50))
    bedrooms = db.Column(db.Integer, default=1)                # capacity
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=True)
    date_from = db.Column(db.Date, nullable=True)              # lease/booking start
    date_to = db.Column(db.Date, nullable=True)                # lease/booking end
    check_in_time = db.Column(db.String(10))                   # HH:MM
    check_out_time = db.Column(db.String(10))                  # HH:MM
    booking_reference = db.Column(db.String(100))
    instructions = db.Column(db.Text)                          # admin check-in instructions, directions, rules
    notes = db.Column(db.Text)
    active = db.Column(db.Boolean, default=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = db.relationship('Project', backref='accommodation_properties')
    created_by = db.relationship('User', foreign_keys=[created_by_id])
    bookings = db.relationship('AccommodationBooking', backref='property', lazy=True)
    documents = db.relationship('AccommodationDocument', backref='property', lazy=True,
                                cascade='all, delete-orphan')

    @property
    def current_occupants(self):
        """Employees currently assigned (booking covers today)."""
        from datetime import date as d
        today = d.today()
        return [b for b in self.bookings if b.date_from <= today <= b.date_to]

    @property
    def occupancy(self):
        """Number of current occupants."""
        return len(self.current_occupants)

    def __repr__(self):
        return f'<AccommodationProperty {self.name}>'


class AccommodationDocument(db.Model):
    """File attached to an accommodation property (lease, check-in PDF, map, etc.)."""
    id = db.Column(db.Integer, primary_key=True)
    property_id = db.Column(db.Integer, db.ForeignKey('accommodation_property.id'), nullable=False)
    filename = db.Column(db.String(300), nullable=False)       # UUID-based stored name
    original_name = db.Column(db.String(300))
    doc_type = db.Column(db.String(50), default='other')       # lease / check_in / map / rules / receipt / other
    title = db.Column(db.String(300))
    notes = db.Column(db.String(500))
    uploaded_by_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)

    uploaded_by = db.relationship('User', foreign_keys=[uploaded_by_user_id])

    def __repr__(self):
        return f'<AccommodationDocument {self.original_name}>'


class AccommodationBooking(db.Model):
    """Links an employee to an accommodation property (or standalone one-off hotel booking)."""
    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey('employee.id'), nullable=False)
    property_id = db.Column(db.Integer, db.ForeignKey('accommodation_property.id'), nullable=True)  # NULL = legacy standalone
    date_from = db.Column(db.Date, nullable=False)
    date_to = db.Column(db.Date, nullable=False)
    property_name = db.Column(db.String(300))                  # kept for standalone/legacy bookings
    address = db.Column(db.String(500))
    phone = db.Column(db.String(50))
    room_info = db.Column(db.String(200))                      # e.g. "Room 204", "Bedroom 2"
    booking_reference = db.Column(db.String(100))
    check_in_time = db.Column(db.String(10))                   # HH:MM
    check_out_time = db.Column(db.String(10))                  # HH:MM
    notes = db.Column(db.String(500))
    created_by_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    employee = db.relationship('Employee', backref='accommodation_bookings')
    created_by = db.relationship('User', foreign_keys=[created_by_id])

    @property
    def display_name(self):
        """Property name — from linked property or standalone field."""
        if self.property:
            return self.property.name
        return self.property_name or 'Unknown'

    @property
    def display_address(self):
        if self.property:
            return self.property.address
        return self.address

    @property
    def housemates(self):
        """Other employees staying at the same property during overlapping dates."""
        if not self.property_id:
            return []
        from models import Employee
        overlapping = AccommodationBooking.query.filter(
            AccommodationBooking.property_id == self.property_id,
            AccommodationBooking.id != self.id,
            AccommodationBooking.date_from <= self.date_to,
            AccommodationBooking.date_to >= self.date_from,
        ).all()
        return overlapping

    def __repr__(self):
        return f'<AccommodationBooking {self.employee_id} {self.date_from}-{self.date_to}>'
