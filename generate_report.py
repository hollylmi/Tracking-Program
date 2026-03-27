"""Generate Person-Hours Productivity Tracking report as PDF."""
import os
from fpdf import FPDF, XPos, YPos


class ReportPDF(FPDF):
    def header(self):
        # Check for logo
        logo_path = None
        static_dir = os.path.join(os.path.dirname(__file__), 'static')
        for ext in ('png', 'jpg', 'jpeg', 'gif'):
            p = os.path.join(static_dir, f'logo.{ext}')
            if os.path.exists(p):
                logo_path = p
                break
        if logo_path:
            self.image(logo_path, 10, 8, 25)
            self.set_x(40)
        self.set_font('Helvetica', 'B', 14)
        self.cell(0, 8, 'Person-Hours Productivity Tracking', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_font('Helvetica', '', 9)
        self.cell(0, 5, 'PlyTrack - LMI Group Investments', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.line(10, self.get_y() + 2, 200, self.get_y() + 2)
        self.ln(6)

    def footer(self):
        self.set_y(-15)
        self.set_font('Helvetica', 'I', 7)
        self.cell(0, 10, f'Page {self.page_no()}/{{nb}}', align='C')

    def section_header(self, title):
        self.set_font('Helvetica', 'B', 11)
        self.set_fill_color(41, 98, 255)
        self.set_text_color(255, 255, 255)
        self.cell(0, 7, '  ' + title, fill=True, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_text_color(0, 0, 0)
        self.ln(2)

    def sub_header(self, title):
        self.set_font('Helvetica', 'B', 9)
        self.set_fill_color(230, 235, 245)
        self.cell(0, 6, '  ' + title, fill=True, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(1)

    def body_text(self, text):
        self.set_font('Helvetica', '', 9)
        self.multi_cell(0, 5, text)
        self.ln(1)

    def bullet(self, text, indent=15):
        self.set_font('Helvetica', '', 9)
        x = self.get_x()
        self.set_x(indent)
        self.cell(5, 5, '-')
        self.multi_cell(0, 5, text)

    def table_row(self, cells, widths, bold=False, fill=False, header=False):
        self.set_font('Helvetica', 'B' if bold or header else '', 8)
        if header:
            self.set_fill_color(50, 50, 60)
            self.set_text_color(255, 255, 255)
        elif fill:
            self.set_fill_color(245, 245, 250)
            self.set_text_color(0, 0, 0)
        else:
            self.set_text_color(0, 0, 0)
        for i, (cell, w) in enumerate(zip(cells, widths)):
            self.cell(w, 6, str(cell), border=1, fill=header or fill)
        self.ln()
        self.set_text_color(0, 0, 0)


def generate():
    pdf = ReportPDF()
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # ── Overview ──────────────────────────────────────────────────────────
    pdf.section_header('Overview')
    pdf.body_text(
        'The person-hours productivity tracking system measures how effectively crew time is used on site each day. '
        'Every person-hour is categorised into one of four types: Production, Variations, Other Activities, or Unaccounted. '
        'This gives full visibility into where time is spent and identifies inefficiencies.'
    )

    # ── How It Works ─────────────────────────────────────────────────────
    pdf.section_header('How It Works')
    pdf.body_text('Each daily entry captures four types of activity line, each with hours and assigned crew:')
    pdf.ln(1)

    col_w = [35, 55, 100]
    pdf.table_row(['Category', 'What', 'Tracked By'], col_w, header=True)
    pdf.table_row(['Production', 'Material deployment (GCL, LLDPE, HDPE)', 'Production lines with crew selector'], col_w)
    pdf.table_row(['Variations', 'Client-directed work (billable)', 'Variation lines with billing crew'], col_w, fill=True)
    pdf.table_row(['Other Activities', 'Non-deployment work', 'Other activity lines with crew'], col_w)
    pdf.table_row(['Unaccounted', 'Gap between available and accounted', 'Auto-calculated'], col_w, fill=True)
    pdf.ln(3)

    pdf.body_text(
        'Available person-hours = crew on site x hours per day (from project settings).\n'
        'Utilisation % = total accounted person-hours / available person-hours.\n\n'
        'The entry form shows a live summary bar: green (>90%), amber (70-90%), red (<70%).'
    )

    # ── How to Fill In the Form ──────────────────────────────────────────
    pdf.section_header('How to Fill In the Entry Form')
    pdf.bullet('Select your crew - tick everyone on site in the Crew Members panel (right side)')
    pdf.bullet('Add production lines - for each material deployed, add lot, material, hours, m2. Click the people icon to assign the deployment crew.')
    pdf.bullet('Add variations - for any client-directed work, add a variation line with hours and the people/equipment doing it')
    pdf.bullet('Add delays - log any weather or other delays with hours and reason')
    pdf.bullet('Add other activities - for anything not production, variation, or delay (inductions, material runs, maintenance), click "Add Activity" and assign crew')
    pdf.bullet('Check the summary bar - at the bottom, the person-hours bar shows how well the day is accounted for')
    pdf.ln(3)

    # ── Example 1: Normal Production Day ─────────────────────────────────
    pdf.add_page()
    pdf.section_header('Example 1: Normal Production Day')
    pdf.body_text('8 people on site, 8-hour day (64 available person-hours)')
    pdf.ln(1)

    tw = [30, 50, 20, 45, 30]
    pdf.table_row(['Line Type', 'Activity', 'Hours', 'Crew', 'Person-Hrs'], tw, header=True)
    pdf.table_row(['Production', 'GCL - LOT 12', '6', 'Jake,Tom,Sam,Dave,Chris', '30'], tw)
    pdf.table_row(['Production', 'LLDPE - LOT 12', '5', 'Jake,Tom,Sam,Dave', '20'], tw, fill=True)
    pdf.table_row(['Variation', 'Pipe boot repairs V003', '3', 'Holly, Ben', '6'], tw)
    pdf.table_row(['Other', 'Toolbox talk / prestart', '0.5', 'All 8', '4'], tw, fill=True)
    pdf.ln(2)

    pdf.sub_header('Summary')
    pdf.body_text(
        'Total accounted: 60 / 64 person-hours = 93.8% (green)\n'
        '  - Production: 50 p-hrs (78%)\n'
        '  - Variations: 6 p-hrs (9%)\n'
        '  - Other: 4 p-hrs (6%)\n'
        '  - Unaccounted: 4 p-hrs (6%)\n\n'
        'Productivity: 2,600 m2 GCL / 30 person-hours = 86.7 m2/person-hr'
    )

    # ── Example 2: Weather Day ───────────────────────────────────────────
    pdf.section_header('Example 2: Weather Day - Partial Work')
    pdf.body_text('8 people on site, wet weather stops LLDPE deployment but geotextile can still be laid')
    pdf.ln(1)

    pdf.table_row(['Line Type', 'Activity', 'Hours', 'Crew', 'Person-Hrs'], tw, header=True)
    pdf.table_row(['Delay', 'Wet Weather', '8', '-', '-'], tw)
    pdf.table_row(['Production', 'Geotextile - LOT 5', '6', 'Jake,Tom,Sam,Dave', '24'], tw, fill=True)
    pdf.table_row(['Variation', 'Patch repairs V004', '4', 'Holly, Ben', '8'], tw)
    pdf.table_row(['Other', 'Equipment maintenance', '3', 'Chris, Steve', '6'], tw, fill=True)
    pdf.table_row(['Other', 'Material sorting', '2', 'Lisa', '2'], tw)
    pdf.ln(2)

    pdf.sub_header('Summary')
    pdf.body_text(
        'Total accounted: 40 / 64 person-hours = 62.5% (amber)\n\n'
        'What you tell the client: "We had a full-day wet weather delay on LLDPE, but we maximised the day '
        '- deployed 1,800 m2 of geotextile, completed 4 hours of variation work (V004), and used remaining '
        'crew for equipment maintenance. 62.5% of crew time was productive despite the delay."'
    )

    # ── Example 3: Extra Crew ────────────────────────────────────────────
    pdf.add_page()
    pdf.section_header('Example 3: Extra Crew Day')
    pdf.body_text('9 people on site (planned crew was 7), smashing out a big deployment')
    pdf.ln(1)

    pdf.table_row(['Line Type', 'Activity', 'Hours', 'Crew', 'Person-Hrs'], tw, header=True)
    pdf.table_row(['Production', 'GCL - LOT 14', '7', 'All 9', '63'], tw)
    pdf.table_row(['Other', 'Prestart / induction', '1', 'Steve', '1'], tw, fill=True)
    pdf.ln(2)

    pdf.sub_header('Summary')
    pdf.body_text(
        'Total accounted: 64 / 72 person-hours = 88.9% (amber)\n\n'
        'Client-facing: "Planned crew of 7, actual 9 deployed. Extra 2 crew provided 16 additional '
        'person-hours above estimate. 4,200 m2 GCL installed at 66.7 m2/person-hr."\n\n'
        'Internal: Steve only had 1 hour accounted (12.5% utilisation) - investigate.'
    )

    # ── Example 4: Setup Day ─────────────────────────────────────────────
    pdf.section_header('Example 4: Induction / Setup Day (Project Start)')
    pdf.body_text('6 people on site, first day - mostly setup, no deployment')
    pdf.ln(1)

    pdf.table_row(['Line Type', 'Activity', 'Hours', 'Crew', 'Person-Hrs'], tw, header=True)
    pdf.table_row(['Other', 'Site inductions', '3', 'All 6', '18'], tw)
    pdf.table_row(['Other', 'Equipment setup/unload', '4', '4 crew', '16'], tw, fill=True)
    pdf.table_row(['Other', 'Site walk / planning', '2', '2 supervisors', '4'], tw)
    pdf.table_row(['Production', 'Trial deployment', '1', '4 crew', '4'], tw, fill=True)
    pdf.ln(2)

    pdf.sub_header('Summary')
    pdf.body_text(
        'Total accounted: 42 / 48 person-hours = 87.5% (amber)\n\n'
        'All time is tracked even though there was minimal production. The "Other Activities" section '
        'captures where the day actually went.'
    )

    # ── Key Metrics ──────────────────────────────────────────────────────
    pdf.add_page()
    pdf.section_header('Key Metrics & What They Mean')

    pdf.sub_header('Utilisation %')
    pdf.body_text(
        'How much of the available crew time is accounted for in activity lines.\n'
        '  - Green (>90%): Excellent - nearly all time is tracked\n'
        '  - Amber (70-90%): Good - some gaps, may be minor tasks not logged\n'
        '  - Red (<70%): Needs attention - significant unaccounted time'
    )

    pdf.sub_header('m2 per Person-Hour')
    pdf.body_text(
        'The core productivity metric. How many square metres installed per person-hour of crew time.\n'
        'Example: 2,600 m2 GCL deployed by 5 people over 6 hours = 2,600 / 30 = 86.7 m2/person-hr.\n\n'
        'This accounts for crew size - so a 5-person crew doing 2,600 m2 in 6 hours is the same rate '
        'as a 10-person crew doing 5,200 m2 in 6 hours. It normalises for crew size.'
    )

    pdf.sub_header('Resource Commitment (Client-Facing)')
    pdf.body_text(
        'Shows the client that you are deploying more resources than estimated:\n'
        '  - Planned crew size (from project settings)\n'
        '  - Average actual crew size (from daily entries)\n'
        '  - Additional person-hours above estimate\n\n'
        'This protects you: if behind schedule despite extra crew, the delays are demonstrably real.'
    )

    pdf.sub_header('Weather Day Utilisation')
    pdf.body_text(
        'On days with weather delays, shows what percentage of crew time was still productive.\n'
        'Tells the client: "Even on weather days, we maximised output by deploying alternative materials '
        'and completing variation works."'
    )

    pdf.sub_header('Individual Crew Productivity (Internal)')
    pdf.body_text(
        'Per-employee stats calculated from line assignments:\n'
        '  - Hours accounted per day\n'
        '  - Utilisation %\n'
        '  - Deployment hours vs other hours\n'
        '  - m2/person-hr when on production lines\n\n'
        'This is internal only - never shown on client reports.'
    )

    # ── Save ─────────────────────────────────────────────────────────────
    out_dir = os.path.join(os.path.dirname(__file__), 'instance')
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, 'Person-Hours_Productivity_Report.pdf')
    pdf.output(out_path)
    return out_path


if __name__ == '__main__':
    path = generate()
    print(f'Report saved to: {path}')
