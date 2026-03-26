import os
import tempfile
from datetime import date

from fpdf import FPDF, XPos, YPos

from models import DailyEntry
from utils.files import safe


def generate_pdf(hm, date_from, date_to, days, summary, settings):
    """Build a stand-down report PDF and return bytes."""
    pdf = FPDF()
    pdf.set_margins(15, 15, 15)
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)

    company = safe(settings.get('company_name', '') or 'Project Tracker')

    pdf.set_font('Helvetica', 'B', 18)
    pdf.cell(0, 10, company, new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
    pdf.set_font('Helvetica', 'B', 13)
    pdf.cell(0, 8, 'MACHINE HIRE STAND-DOWN REPORT', new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
    pdf.set_font('Helvetica', '', 9)
    pdf.cell(0, 5, f'Generated: {date.today().strftime("%d/%m/%Y")}', new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
    pdf.ln(6)

    pdf.set_fill_color(240, 244, 255)
    pdf.set_font('Helvetica', 'B', 10)
    pdf.cell(0, 7, 'MACHINE DETAILS', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
    pdf.set_font('Helvetica', '', 10)

    def detail_row(label, value):
        pdf.set_font('Helvetica', 'B', 9)
        pdf.cell(45, 6, label + ':')
        pdf.set_font('Helvetica', '', 9)
        pdf.cell(0, 6, safe(value) if value else '-', new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    detail_row('Machine', hm.machine_name)
    detail_row('Type', hm.machine_type)
    detail_row('Hire Company', hm.hire_company)
    detail_row('Company Email', hm.hire_company_email)
    detail_row('Delivery Date', hm.delivery_date.strftime('%d/%m/%Y') if hm.delivery_date else None)
    detail_row('Return Date', hm.return_date.strftime('%d/%m/%Y') if hm.return_date else None)
    detail_row('Project', hm.project.name)
    sat_billing = 'Yes (Saturdays billable)' if (hm.count_saturdays is not False) else 'No (Saturdays excluded)'
    detail_row('Saturday Billing', sat_billing)
    pdf.ln(4)

    pdf.set_fill_color(240, 244, 255)
    pdf.set_font('Helvetica', 'B', 10)
    pdf.cell(0, 7, 'REPORT PERIOD', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
    pdf.set_font('Helvetica', '', 9)
    pdf.cell(0, 6, f'{date_from.strftime("%d/%m/%Y")}  to  {date_to.strftime("%d/%m/%Y")}', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(4)

    pdf.set_fill_color(240, 244, 255)
    pdf.set_font('Helvetica', 'B', 10)
    pdf.cell(0, 7, 'DAILY SUMMARY', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)

    col_w = [28, 26, 30, 96]
    pdf.set_font('Helvetica', 'B', 8)
    pdf.set_fill_color(220, 230, 255)
    for i, (header, w) in enumerate(zip(['Date', 'Day', 'Status', 'Notes / Reason'], col_w)):
        is_last = (i == 3)
        pdf.cell(w, 6, header, border=1, fill=True,
                 new_x=XPos.LMARGIN if is_last else XPos.RIGHT,
                 new_y=YPos.NEXT if is_last else YPos.TOP)

    status_labels = {
        'on_site': 'On Site', 'stood_down': 'Stood Down',
        'not_delivered': 'Not Yet Delivered', 'returned': 'Returned',
        'non_working': 'Non-Working Day',
    }
    for d in days:
        is_sd = d['status'] == 'stood_down'
        is_nw = d['status'] == 'non_working'
        pdf.set_text_color(180, 30, 30) if is_sd else (
            pdf.set_text_color(160, 160, 160) if is_nw else pdf.set_text_color(0, 0, 0))
        pdf.set_font('Helvetica', 'B' if is_sd else '', 8)
        pdf.cell(col_w[0], 6, d['date'].strftime('%d/%m/%Y'), border=1)
        pdf.cell(col_w[1], 6, d['day_name'], border=1)
        pdf.cell(col_w[2], 6, status_labels.get(d['status'], d['status']), border=1)
        pdf.set_font('Helvetica', '', 8)
        pdf.cell(col_w[3], 6, safe(d['reason'])[:60], border=1, new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_text_color(0, 0, 0)
    pdf.ln(5)

    pdf.set_fill_color(240, 244, 255)
    pdf.set_font('Helvetica', 'B', 10)
    pdf.cell(0, 7, 'SUMMARY', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
    pdf.set_font('Helvetica', '', 9)
    detail_row('Total Calendar Days', summary['total_days'])
    detail_row('Working Days in Period', summary['working_days'])
    detail_row('Days On Site (Billable)', summary['on_site'])
    detail_row('Days Stood Down', summary['stood_down'])
    detail_row('Saturday Billing', 'Included' if summary.get('count_saturdays', True) else 'Excluded')
    if summary['cost_week']:
        detail_row('Rate (per week)', f"${hm.cost_per_week:,.2f}")
    if summary.get('cost_per_day_derived') is not None:
        detail_row('Rate (per day, derived)', f"${summary['cost_per_day_derived']:,.2f}")
    if summary['cost_day'] is not None:
        detail_row('Estimated Cost (on-site days)', f"${summary['cost_day']:,.2f}")
    pdf.ln(4)

    sd_days = [d for d in days if d['status'] == 'stood_down']
    if sd_days:
        pdf.set_fill_color(255, 240, 240)
        pdf.set_font('Helvetica', 'B', 10)
        pdf.cell(0, 7, 'STAND-DOWN DAYS (NOT CHARGED)', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
        pdf.set_font('Helvetica', '', 9)
        for d in sd_days:
            pdf.set_font('Helvetica', 'B', 9)
            pdf.cell(35, 6, d['date'].strftime('%d/%m/%Y') + ' ' + d['day_name'][:3] + ':')
            pdf.set_font('Helvetica', '', 9)
            pdf.cell(0, 6, safe(d['reason']) or '-', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(4)

    pdf.ln(6)
    pdf.set_font('Helvetica', '', 9)
    pdf.cell(90, 6, 'Prepared by: ________________________________')
    pdf.cell(0, 6, 'Date: ____________________', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(3)
    pdf.cell(90, 6, 'Signature: ___________________________________', new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    return bytes(pdf.output())


def generate_delay_pdf(rows, summary, date_from, date_to, project_name, settings):
    """Build a client delay charge report PDF and return bytes."""
    pdf = FPDF()
    pdf.set_margins(15, 15, 15)
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)

    company = safe(settings.get('company_name', '') or 'Project Tracker')

    pdf.set_font('Helvetica', 'B', 18)
    pdf.cell(0, 10, company, new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
    pdf.set_font('Helvetica', 'B', 13)
    pdf.cell(0, 8, 'DELAY CHARGE REPORT', new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
    pdf.set_font('Helvetica', '', 9)
    pdf.cell(0, 5, f'Generated: {date.today().strftime("%d/%m/%Y")}', new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
    pdf.ln(5)

    pdf.set_fill_color(240, 244, 255)
    pdf.set_font('Helvetica', 'B', 10)
    pdf.cell(0, 7, 'REPORT DETAILS', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)

    def detail_row(label, value):
        pdf.set_font('Helvetica', 'B', 9)
        pdf.cell(45, 6, label + ':')
        pdf.set_font('Helvetica', '', 9)
        pdf.cell(0, 6, safe(value) if value else '-', new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    detail_row('Period', f'{date_from.strftime("%d/%m/%Y")} to {date_to.strftime("%d/%m/%Y")}')
    detail_row('Project', project_name or 'All Projects')
    detail_row('Billable Delay Events', str(summary['billable_count']))
    detail_row('Total Billable Hours', f'{summary["total_hours_billable"]} hrs')
    detail_row('Non-Billable Events', str(summary['non_billable_count']))
    pdf.ln(4)

    billable_rows = [r for r in rows if r['billable']]
    non_billable_rows = [r for r in rows if not r['billable']]

    def render_rows(rows_list, title, fill_color):
        if not rows_list:
            return
        pdf.set_fill_color(*fill_color)
        pdf.set_font('Helvetica', 'B', 11)
        pdf.cell(0, 7, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
        pdf.ln(1)

        col_w = [70, 30, 30, 50]
        for row in rows_list:
            entry = row['entry']
            row_type = row.get('type', 'delay')

            pdf.set_fill_color(230, 235, 255)
            pdf.set_font('Helvetica', 'B', 10)

            if row_type == 'variation':
                var_hrs = sum(v['hours'] for v in row.get('var_lines', []))
                label = safe(f'{entry.entry_date.strftime("%d/%m/%Y")} ({entry.day_name})  -  '
                             f'{entry.project.name}  -  {var_hrs} hrs client variation')
            else:
                label = safe(f'{entry.entry_date.strftime("%d/%m/%Y")} ({entry.day_name})  -  '
                             f'{entry.project.name}  -  {entry.delay_hours} hrs delay')
            pdf.cell(0, 7, label, new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)

            if row_type != 'variation':
                pdf.set_font('Helvetica', 'I', 9)
                pdf.cell(0, 5, safe(f'Reason: {entry.delay_reason or "Not specified"}'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                if entry.delay_description:
                    pdf.multi_cell(0, 5, safe(entry.delay_description))

            # Variations subsection
            if row.get('var_lines'):
                pdf.ln(1)
                pdf.set_font('Helvetica', 'B', 9)
                pdf.set_fill_color(255, 245, 220)
                pdf.cell(0, 6, '  CLIENT VARIATIONS', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
                pdf.set_font('Helvetica', '', 8)
                var_col = [30, 100, 50]
                pdf.set_fill_color(250, 240, 210)
                for header, w in zip(['Variation #', 'Description', 'Hours'], var_col):
                    pdf.cell(w, 5, header, border=1, fill=True)
                pdf.ln()
                for vl in row['var_lines']:
                    pdf.cell(var_col[0], 5, safe(str(vl['variation_number'])), border=1)
                    pdf.cell(var_col[1], 5, safe(vl['description'][:60]), border=1)
                    pdf.cell(var_col[2], 5, f'{vl["hours"]}h', border=1)
                    pdf.ln()

            pdf.ln(1)

            # Cost table (employees + equipment)
            if row['emp_lines'] or row['machine_lines']:
                pdf.set_font('Helvetica', 'B', 8)
                pdf.set_fill_color(210, 218, 255)
                for header, w in zip(['Role / Equipment', 'Rate ($/hr)', 'Hours', 'Cost ($)'], col_w):
                    pdf.cell(w, 6, header, border=1, fill=True)
                pdf.ln()

                pdf.set_font('Helvetica', '', 8)
                for line in row['emp_lines']:
                    pdf.cell(col_w[0], 5, safe('  ' + line['name']), border=1)
                    pdf.cell(col_w[1], 5, f'${line["rate"]:.2f}', border=1)
                    pdf.cell(col_w[2], 5, str(line['hours']), border=1)
                    pdf.cell(col_w[3], 5, f'${line["cost"]:.2f}', border=1)
                    pdf.ln()
                for line in row['machine_lines']:
                    icon = '[GRP] ' if line.get('is_group') else ''
                    pdf.cell(col_w[0], 5, safe('  ' + icon + line['name']), border=1)
                    pdf.cell(col_w[1], 5, f'${line["rate"]:.2f}', border=1)
                    pdf.cell(col_w[2], 5, str(line['hours']), border=1)
                    pdf.cell(col_w[3], 5, f'${line["cost"]:.2f}', border=1)
                    pdf.ln()

            pdf.set_font('Helvetica', 'B', 9)
            pdf.set_text_color(30, 80, 180)
            pdf.cell(0, 6, f'  Event Total: ${row["entry_cost"]:.2f}', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_text_color(0, 0, 0)
            pdf.ln(3)

    render_rows(billable_rows, 'BILLABLE DELAYS (CHARGED TO CLIENT)', (255, 235, 235))
    render_rows(non_billable_rows, 'NON-BILLABLE DELAYS (OWN COST)', (235, 245, 255))

    pdf.ln(3)
    pdf.set_fill_color(30, 80, 180)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font('Helvetica', 'B', 12)
    pdf.cell(0, 10, f'  TOTAL BILLABLE DELAY CHARGES:  ${summary["total_cost"]:,.2f}', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
    pdf.set_text_color(0, 0, 0)

    pdf.ln(8)
    pdf.set_font('Helvetica', '', 9)
    pdf.cell(90, 6, 'Authorised by: ________________________________')
    pdf.cell(0, 6, 'Date: ____________________', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(3)
    pdf.cell(90, 6, 'Signature: ___________________________________', new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    return bytes(pdf.output())


def generate_project_report_pdf(project, progress, delay_summary, cost_estimate, settings,
                                date_from=None, date_to=None, gantt_data=None):
    """Generate a progress report PDF for a project and return bytes."""
    today = date.today()

    def merge_spans(pct_list, day_w):
        """Merge contiguous left_pct positions into (start_pct, end_pct) spans."""
        if not pct_list:
            return []
        sorted_p = sorted(pct_list)
        spans = []
        s = sorted_p[0]; e = s + day_w
        for p in sorted_p[1:]:
            if p <= e + day_w * 0.6:
                e = p + day_w
            else:
                spans.append((s, min(e, 100))); s = p; e = p + day_w
        spans.append((s, min(e, 100)))
        return spans

    entries_q = DailyEntry.query.filter_by(project_id=project.id).order_by(DailyEntry.entry_date)
    if date_from:
        entries_q = entries_q.filter(DailyEntry.entry_date >= date_from)
    if date_to:
        entries_q = entries_q.filter(DailyEntry.entry_date <= date_to)
    period_entries = entries_q.all()
    delay_entries = [e for e in period_entries if (e.delay_hours or 0) > 0]

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)

    company = safe(settings.get('company_name', '') or 'Project Tracker')

    if date_from or date_to:
        from_str = date_from.strftime('%d/%m/%Y') if date_from else 'Start'
        to_str = date_to.strftime('%d/%m/%Y') if date_to else today.strftime('%d/%m/%Y')
        header_period = safe(f'Progress Report -- {from_str} to {to_str}')
    else:
        header_period = safe(f'Progress Report -- {today.strftime("%d/%m/%Y")}')

    # ════════════════════════════════════════════════════════════════════
    # PAGE 1 — Portrait: Summary + Progress + Lot Bars
    # ════════════════════════════════════════════════════════════════════
    pdf.add_page()
    pdf.set_margins(15, 15, 15)

    def section_header(title):
        pdf.ln(1)
        pdf.set_font('Helvetica', 'B', 9)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(0, 6, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_draw_color(220, 220, 220)
        pdf.set_line_width(0.3)
        pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
        pdf.set_text_color(0, 0, 0)
        pdf.ln(1)

    def detail_row(label, value):
        pdf.set_font('Helvetica', '', 8)
        pdf.set_text_color(120, 120, 120)
        pdf.cell(50, 5, label)
        pdf.set_text_color(30, 30, 30)
        pdf.set_font('Helvetica', 'B', 8)
        pdf.cell(0, 5, safe(str(value)) if value is not None else '-',
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    # Header with logo
    # Look for logo in common formats
    _static = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'static')
    logo_path = None
    for ext in ('png', 'jpg', 'jpeg', 'gif'):
        _p = os.path.join(_static, f'logo.{ext}')
        if os.path.exists(_p):
            logo_path = _p
            break
    header_y = pdf.get_y()
    page_w = pdf.w - pdf.l_margin - pdf.r_margin

    if logo_path:
        pdf.image(logo_path, x=pdf.l_margin, y=header_y, h=18, keep_aspect_ratio=True)
        # Company + project name to the right of the logo
        pdf.set_xy(pdf.l_margin + 45, header_y)
        pdf.set_font('Helvetica', 'B', 16)
        pdf.cell(page_w - 45, 7, company, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_x(pdf.l_margin + 45)
        pdf.set_font('Helvetica', '', 10)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(page_w - 45, 5, safe(project.name), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_text_color(0, 0, 0)
        pdf.set_y(max(pdf.get_y(), header_y + 20))
    else:
        pdf.set_font('Helvetica', 'B', 16)
        pdf.cell(0, 8, company, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_font('Helvetica', '', 10)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(0, 5, safe(project.name), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_text_color(0, 0, 0)

    # Accent line
    pdf.set_draw_color(135, 200, 235)  # light blue from logo
    pdf.set_line_width(0.8)
    pdf.line(pdf.l_margin, pdf.get_y() + 1, pdf.w - pdf.r_margin, pdf.get_y() + 1)
    pdf.ln(4)

    # Period + date
    pdf.set_font('Helvetica', '', 9)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(0, 5, header_period, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_text_color(0, 0, 0)
    pdf.ln(2)

    # Project Summary
    section_header('PROJECT SUMMARY')
    detail_row('Start Date', project.start_date.strftime('%d/%m/%Y') if project.start_date else None)
    detail_row('Quoted Days', project.quoted_days)
    detail_row('Hours per Day', project.hours_per_day)

    if progress:
        all_entries_all = DailyEntry.query.filter_by(project_id=project.id).all()
        worked_dates = {e.entry_date for e in all_entries_all if e.install_hours and e.install_hours > 0}
        detail_row('Days Worked', len(worked_dates))
        detail_row('Overall Progress', f'{progress["overall_pct"]}%')
        detail_row('Total Planned', f'{progress["total_planned"]} m\u00b2')
        detail_row('Total Installed', f'{progress["total_actual"]} m\u00b2')
        detail_row('Remaining', f'{progress["total_remaining"]} m\u00b2')
        if progress.get('install_rate'):
            detail_row('Install Rate', f'{progress["install_rate"]} m\u00b2/hr')

    if gantt_data:
        pdf.ln(2)
        if gantt_data.get('target_finish'):
            detail_row('Target Finish', safe(gantt_data['target_finish']))
        if gantt_data.get('est_finish'):
            detail_row('Est. Finish', safe(gantt_data['est_finish']))
        if gantt_data.get('variance_days') is not None:
            v = gantt_data['variance_days']
            v_str = f'+{v} days (BEHIND)' if v > 0 else (f'{v} days (AHEAD)' if v < 0 else 'On Schedule')
            pdf.set_font('Helvetica', 'B', 9)
            if v > 0:
                pdf.set_text_color(180, 0, 0)
            elif v < 0:
                pdf.set_text_color(0, 140, 60)
            pdf.cell(55, 6, 'Variance:')
            pdf.cell(0, 6, safe(v_str), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_text_color(0, 0, 0)
    pdf.ln(4)

    # ── Project Status ──────────────────────────────────────────
    if progress and progress.get('should_be_pct') is not None:
        section_header('STATUS')

        total_planned_days = progress.get('total_planned_days', 0)
        site_delay_days = progress.get('site_delay_days', 0)
        variation_delay_days = progress.get('variation_delay_days', 0)
        total_delay_days = site_delay_days + variation_delay_days
        actual_pct = progress['overall_pct']
        should_pct = progress['should_be_pct']
        diff = round(actual_pct - should_pct, 1)

        # Compact 3-column layout
        col = (pdf.w - pdf.l_margin - pdf.r_margin) / 3
        y0 = pdf.get_y()

        # Col 1: Schedule
        pdf.set_font('Helvetica', 'B', 18)
        pdf.set_text_color(30, 30, 30)
        pdf.cell(col, 8, safe(f'{actual_pct}%'), align='C')
        pdf.cell(col, 8, safe(f'{should_pct}%'), align='C')
        if diff >= 0:
            pdf.set_text_color(0, 140, 60)
            pdf.cell(col, 8, safe(f'+{diff}%'), align='C', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        else:
            pdf.set_text_color(180, 0, 0)
            pdf.cell(col, 8, safe(f'{diff}%'), align='C', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_text_color(100, 100, 100)
        pdf.set_font('Helvetica', '', 7)
        pdf.cell(col, 4, 'Actual', align='C')
        pdf.cell(col, 4, 'Expected', align='C')
        pdf.cell(col, 4, 'Ahead' if diff >= 0 else 'Behind', align='C',
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_text_color(0, 0, 0)
        pdf.ln(2)

        # Compact delay summary
        pdf.set_font('Helvetica', '', 7)
        pdf.set_text_color(100, 100, 100)
        parts = [f'{total_planned_days} planned days']
        if total_delay_days:
            parts.append(f'{total_delay_days} delay days ({site_delay_days} site + {variation_delay_days} variation)')
        parts.append(f'{total_planned_days - total_delay_days} workable days')
        pdf.cell(0, 4, '  |  '.join(parts), new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
        pdf.set_text_color(0, 0, 0)
        pdf.ln(3)

    # Progress by Lot / Material table
    if progress and progress.get('tasks'):
        section_header('PROGRESS BY LOT / MATERIAL')
        col_w = [30, 50, 28, 28, 24, 20]
        pdf.set_font('Helvetica', 'B', 8)
        pdf.set_fill_color(220, 230, 255)
        for hdr, w in zip(['Lot', 'Material', 'Planned m\u00b2', 'Actual m\u00b2', '% Done', 'Status'], col_w):
            pdf.cell(w, 6, safe(hdr), border=1, fill=True)
        pdf.ln()

        pdf.set_font('Helvetica', '', 8)
        for task in progress['tasks']:
            pct = task['pct_complete']
            status = 'Complete' if pct >= 100 else ('In Progress' if pct > 0 else 'Not Started')
            pdf.cell(col_w[0], 5, safe(task['lot'] or '-'), border=1)
            pdf.cell(col_w[1], 5, safe(task['material'] or '-'), border=1)
            pdf.cell(col_w[2], 5, str(task['planned_sqm']), border=1, align='R')
            pdf.cell(col_w[3], 5, str(task['actual_sqm']), border=1, align='R')
            pdf.cell(col_w[4], 5, f'{pct}%', border=1, align='R')
            pdf.cell(col_w[5], 5, status, border=1)
            pdf.ln()

        pdf.set_font('Helvetica', 'B', 8)
        pdf.cell(col_w[0] + col_w[1], 5, 'TOTAL', border=1)
        pdf.cell(col_w[2], 5, str(progress['total_planned']), border=1, align='R')
        pdf.cell(col_w[3], 5, str(progress['total_actual']), border=1, align='R')
        pdf.cell(col_w[4], 5, f"{progress['overall_pct']}%", border=1, align='R')
        pdf.cell(col_w[5], 5, '', border=1)
        pdf.ln()
        pdf.ln(4)

    # ════════════════════════════════════════════════════════════════════
    # PAGE 2 — Gantt Chart (screenshot via playwright)
    # ════════════════════════════════════════════════════════════════════
    if gantt_data and gantt_data.get('rows'):
      try:
        from playwright.sync_api import sync_playwright

        n_rows = len(gantt_data['rows'])
        row_h_px = 56
        header_h_px = 48
        summary_h_px = 70
        total_h_px = header_h_px + n_rows * row_h_px + summary_h_px + 20

        def _esc(s):
            return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')

        rows_html = ''
        for row in gantt_data['rows']:
            var_class = ''
            var_text = ''
            v = row.get('variance_days')
            if v is not None:
                var_class = 'gantt-var-late' if v > 0 else ('gantt-var-early' if v < 0 else 'gantt-var-ontime')
                var_text = (f'+{v}d' if v > 0 else (f'{v}d' if v < 0 else 'On time'))

            stripes_html = ''.join(
                f'<div class="gantt-stripe gantt-stripe-{_esc(s["type"])}" '
                f'style="left:{s["left"]}%;width:{s["w"]}%;"></div>'
                for s in gantt_data.get('shade_stripes', [])
            )
            today_html = ''
            if gantt_data.get('today_pct') is not None and 0 <= gantt_data['today_pct'] <= 100:
                today_html = f'<div class="gantt-today-line" style="left:{gantt_data["today_pct"]}%;"></div>'
            target_html = ''
            if gantt_data.get('target_finish_pct') is not None and 0 <= gantt_data['target_finish_pct'] <= 100:
                target_html = f'<div class="gantt-target-line" style="left:{gantt_data["target_finish_pct"]}%;"></div>'
            planned_html = ''.join(
                f'<div class="gantt-day gantt-planned" style="left:{lft}%;width:{gantt_data["day_width_pct"]}%;"></div>'
                for lft in row.get('planned_days', [])
            )
            actual_html = ''.join(
                f'<div class="gantt-day gantt-actual" style="left:{lft}%;width:{gantt_data["day_width_pct"]}%;"></div>'
                for lft in row.get('actual_days', [])
            )
            forecast_html = ''.join(
                f'<div class="gantt-day gantt-forecast" style="left:{lft}%;width:{gantt_data["day_width_pct"]}%;"></div>'
                for lft in row.get('forecast_days', [])
            )
            rows_html += f'''
            <div style="display:flex;margin-bottom:4px;">
              <div style="min-width:160px;max-width:160px;padding-right:8px;display:flex;align-items:center;">
                <div style="font-size:0.74rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{_esc(row["label"])}</div>
              </div>
              <div style="flex:1;position:relative;height:{row_h_px}px;overflow:hidden;">
                {stripes_html}{today_html}{target_html}{planned_html}{actual_html}{forecast_html}
              </div>
              <div class="gantt-var {var_class}">{var_text}</div>
            </div>'''

        month_html = ''.join(
            f'<div class="gantt-month-label" style="left:{m["left_pct"]}%;">{_esc(m["label"])}</div>'
            for m in gantt_data.get('month_markers', [])
        )
        week_html = ''.join(
            f'<div class="gantt-week-tick" style="left:{w["left_pct"]}%;"></div>'
            f'<div class="gantt-week-label" style="left:{w["left_pct"]}%;">{_esc(w["date"])}</div>'
            for w in gantt_data.get('week_markers', [])
        )
        today_footer = ''
        if gantt_data.get('today_pct') is not None and 0 <= gantt_data['today_pct'] <= 100:
            today_footer = f'<div style="position:absolute;left:{gantt_data["today_pct"]}%;transform:translateX(-50%);font-size:0.6rem;font-weight:700;color:#dc3545;white-space:nowrap;">Today</div>'
        target_footer = ''
        if gantt_data.get('target_finish_pct') is not None:
            target_footer = f'<div style="position:absolute;left:{gantt_data["target_finish_pct"]}%;transform:translateX(-50%);font-size:0.6rem;font-weight:700;color:#0d6efd;white-space:nowrap;">Target</div>'

        var_days = gantt_data.get('variance_days')
        if var_days is not None:
            var_color = '#dc3545' if var_days > 0 else ('#198754' if var_days < 0 else '#6c757d')
            var_sign = '+' if var_days > 0 else ''
            var_label = 'BEHIND' if var_days > 0 else ('AHEAD' if var_days < 0 else 'ON SCHEDULE')
            summary_var = f'<div style="color:{var_color};font-weight:700;">VARIANCE: {var_sign}{var_days} DAYS ({var_label})</div>'
        else:
            summary_var = ''

        html = f'''<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
body {{ margin: 0; padding: 12px; background: #fff; font-family: -apple-system, Arial, sans-serif; }}
.gantt-container {{ min-width: 900px; }}
.gantt-header-row {{ position:relative; height:44px; border-bottom:2px solid #dee2e6; margin-bottom:4px; }}
.gantt-month-label {{ position:absolute; top:2px; font-size:0.7rem; font-weight:600; color:#495057; white-space:nowrap; transform:translateX(-50%); }}
.gantt-week-tick {{ position:absolute; bottom:0; width:1px; height:10px; background:#ced4da; transform:translateX(-50%); }}
.gantt-week-label {{ position:absolute; bottom:12px; font-size:0.6rem; color:#adb5bd; transform:translateX(-50%); white-space:nowrap; }}
.gantt-stripe {{ position:absolute; top:0; height:100%; pointer-events:none; z-index:0; }}
.gantt-stripe-sun {{ background:rgba(255,105,180,0.18); }}
.gantt-stripe-nwd {{ background:rgba(100,180,255,0.28); }}
.gantt-stripe-wwd {{ background:rgba(0,180,160,0.30); }}
.gantt-stripe-cld {{ background:rgba(255,140,0,0.30); }}
.gantt-today-line {{ position:absolute; top:0; height:100%; width:2px; background:#dc3545; z-index:10; pointer-events:none; }}
.gantt-target-line {{ position:absolute; top:0; height:100%; width:2px; background:#0d6efd; z-index:9; pointer-events:none; }}
.gantt-day {{ position:absolute; border-radius:2px; pointer-events:none; z-index:5; }}
.gantt-planned {{ background:deeppink; opacity:0.35; top:2px; height:22px; }}
.gantt-actual {{ background:#00c060; border:1px solid rgba(0,0,0,0.18); opacity:0.9; top:26px; height:22px; }}
.gantt-forecast {{ background:gold; border:1px dashed rgba(0,0,0,0.25); opacity:0.85; top:26px; height:22px; }}
.gantt-var {{ min-width:72px; text-align:left; padding-left:8px; font-size:0.72rem; font-weight:700; line-height:1.2; display:flex; align-items:center; }}
.gantt-var-late {{ color:#dc3545; }}
.gantt-var-early {{ color:#198754; }}
.gantt-var-ontime {{ color:#6c757d; }}
</style></head><body>
<div class="gantt-container">
  <div style="display:flex;">
    <div style="min-width:160px;max-width:160px;"></div>
    <div style="flex:1;position:relative;" class="gantt-header-row">
      {month_html}{week_html}
    </div>
    <div style="min-width:72px;"></div>
  </div>
  {rows_html}
  <div style="display:flex;margin-top:4px;">
    <div style="min-width:160px;max-width:160px;"></div>
    <div style="flex:1;position:relative;height:18px;">{today_footer}{target_footer}</div>
    <div style="min-width:72px;"></div>
  </div>
  <div style="margin-top:10px;padding:10px;background:#f8f9fa;font-family:monospace;border:1px solid #dee2e6;font-size:0.82rem;">
    <div><strong>TARGET FINISH:</strong> {_esc(gantt_data.get("target_finish") or "-")}</div>
    <div><strong>EST. FINISH:</strong> {_esc(gantt_data.get("est_finish") or "-")}</div>
    {summary_var}
  </div>
  <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:12px;font-size:0.75rem;color:#495057;align-items:center;">
    <span><span style="display:inline-block;width:14px;height:10px;background:deeppink;opacity:0.4;border-radius:2px;vertical-align:middle;margin-right:3px;"></span>Planned</span>
    <span><span style="display:inline-block;width:14px;height:10px;background:#00c060;border-radius:2px;vertical-align:middle;margin-right:3px;"></span>Actual</span>
    <span><span style="display:inline-block;width:14px;height:10px;background:gold;border:1px dashed #aaa;border-radius:2px;vertical-align:middle;margin-right:3px;"></span>Forecast</span>
    <span><span style="display:inline-block;width:12px;height:10px;background:rgba(255,105,180,0.4);vertical-align:middle;margin-right:3px;"></span>Weekend</span>
    <span><span style="display:inline-block;width:12px;height:10px;background:rgba(100,180,255,0.45);vertical-align:middle;margin-right:3px;"></span>Non-work</span>
    <span><span style="display:inline-block;width:12px;height:10px;background:rgba(0,180,160,0.45);vertical-align:middle;margin-right:3px;"></span>Weather</span>
    <span><span style="display:inline-block;width:12px;height:10px;background:rgba(255,140,0,0.4);vertical-align:middle;margin-right:3px;"></span>Delay</span>
    <span><span style="display:inline-block;width:2px;height:12px;background:#dc3545;vertical-align:middle;margin-right:3px;"></span>Today</span>
    <span><span style="display:inline-block;width:2px;height:12px;background:#0d6efd;vertical-align:middle;margin-right:3px;"></span>Target</span>
  </div>
</div>
</body></html>'''

        tmp_html = tempfile.NamedTemporaryFile(suffix='.html', delete=False, mode='w', encoding='utf-8')
        tmp_html.write(html)
        tmp_html.close()
        tmp_img = tmp_html.name.replace('.html', '.png')

        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch()
                page = browser.new_page(viewport={'width': 1300, 'height': total_h_px + 40})
                page.goto(f'file:///{tmp_html.name.replace(chr(92), "/")}')
                page.wait_for_timeout(300)
                page.locator('.gantt-container').screenshot(path=tmp_img)
                browser.close()

            pdf.add_page('L')
            pdf.set_margins(10, 10, 10)
            pdf.set_auto_page_break(auto=False)
            pdf.set_font('Helvetica', 'B', 12)
            pdf.set_text_color(0, 0, 0)
            pdf.cell(0, 8, safe(f'Schedule Gantt -- {project.name}'), new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
            img_y = pdf.get_y()
            avail_w = pdf.w - pdf.l_margin - pdf.r_margin
            avail_h = pdf.h - img_y - pdf.b_margin - 2
            pdf.image(tmp_img, x=pdf.l_margin, y=img_y, w=avail_w, h=avail_h, keep_aspect_ratio=True)
        finally:
            os.unlink(tmp_html.name)
            if os.path.exists(tmp_img):
                os.unlink(tmp_img)

        pdf.set_margins(15, 15, 15)
        pdf.set_auto_page_break(auto=True, margin=15)
      except Exception:
        # Playwright/Chromium not available — skip Gantt page
        pdf.add_page()
        pdf.set_font('Helvetica', 'I', 10)
        pdf.cell(0, 10, 'Gantt chart not available (browser rendering unavailable on this server).',
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')

    # ════════════════════════════════════════════════════════════════════
    # PAGE 3+ — Portrait: Daily Activities
    # ════════════════════════════════════════════════════════════════════
    if period_entries:
        pdf.add_page()
        section_header('DAILY ACTIVITIES')
        if date_from or date_to:
            pdf.set_font('Helvetica', 'I', 8)
            pdf.set_text_color(80, 80, 80)
            pdf.cell(0, 5,
                     safe(f'Period: {date_from.strftime("%d/%m/%Y") if date_from else "Start"}'
                          f' to {date_to.strftime("%d/%m/%Y") if date_to else today.strftime("%d/%m/%Y")}'),
                     new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_text_color(0, 0, 0)

        for entry in period_entries:
            date_str = entry.entry_date.strftime('%A, %d %B %Y')
            loc_str = entry.location or ''

            pdf.set_fill_color(228, 238, 255)
            pdf.set_font('Helvetica', 'B', 9)
            hdr_parts = [safe(date_str)]
            if loc_str:
                hdr_parts.append(safe(loc_str))
            pdf.cell(0, 6, '  |  '.join(hdr_parts), new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)

            pdf.set_font('Helvetica', '', 8)
            pdf.set_text_color(0, 0, 0)

            # Production — material + sqm only (no hours)
            prod_lines = entry.production_lines if entry.production_lines else [
                type('PL', (), {'lot_number': entry.lot_number, 'material': entry.material,
                                'install_sqm': entry.install_sqm, 'install_hours': None})()
            ] if (entry.lot_number or entry.material) else []

            if prod_lines:
                pdf.set_font('Helvetica', 'B', 8)
                pdf.cell(0, 5, 'Production:', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.set_font('Helvetica', '', 8)
                for pl in prod_lines:
                    parts = []
                    if pl.lot_number:
                        parts.append(safe(f'Lot {pl.lot_number}'))
                    if pl.material:
                        parts.append(safe(pl.material))
                    if pl.install_sqm:
                        parts.append(safe(f'{pl.install_sqm} m\u00b2'))
                    if parts:
                        pdf.cell(0, 4, safe('  *  ') + '  -  '.join(parts),
                                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                # Total sqm line
                pdf.set_font('Helvetica', 'B', 8)
                pdf.cell(0, 5, safe(f'Total: {entry.total_sqm} m\u00b2'),
                         new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.set_font('Helvetica', '', 8)

            # Variations
            if entry.variation_lines:
                pdf.set_font('Helvetica', 'B', 8)
                pdf.set_text_color(160, 100, 0)
                pdf.cell(0, 5, 'Variations:', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.set_font('Helvetica', '', 8)
                for vl in entry.variation_lines:
                    if (vl.hours or 0) > 0:
                        vnum = f'V{vl.variation_number}' if vl.variation_number else 'Variation'
                        pdf.cell(0, 4, safe(f'  *  {vnum}: {vl.description or ""} - {vl.hours}h'),
                                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.set_text_color(0, 0, 0)

            # Delays
            if entry.delay_lines:
                pdf.set_font('Helvetica', 'B', 8)
                pdf.set_text_color(180, 50, 50)
                pdf.cell(0, 5, 'Delays:', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.set_font('Helvetica', '', 8)
                for dl in entry.delay_lines:
                    if (dl.hours or 0) > 0:
                        pdf.cell(0, 4, safe(f'  *  {dl.reason}: {dl.description or ""} - {dl.hours}h'),
                                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.set_text_color(0, 0, 0)
            elif entry.delay_hours and entry.delay_hours > 0:
                pdf.set_text_color(180, 50, 50)
                pdf.cell(0, 5,
                         safe(f'Delay: {entry.delay_hours}h - {entry.delay_reason or "N/A"}'),
                         new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                if entry.delay_description:
                    pdf.set_font('Helvetica', 'I', 8)
                    pdf.multi_cell(0, 4, safe(f'  {entry.delay_description}'),
                                   new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                    pdf.set_font('Helvetica', '', 8)
                pdf.set_text_color(0, 0, 0)

            if entry.machines_stood_down:
                pdf.set_text_color(0, 110, 130)
                pdf.cell(0, 5, 'Hired machines stood down',
                         new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.set_text_color(0, 0, 0)

            # other_work_description removed from report

            if entry.notes:
                pdf.set_text_color(80, 80, 80)
                pdf.set_font('Helvetica', 'I', 8)
                pdf.multi_cell(0, 4, safe(f'Notes: {entry.notes}'),
                               new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.set_font('Helvetica', '', 8)

            pdf.set_text_color(0, 0, 0)
            pdf.ln(2)

    # ════════════════════════════════════════════════════════════════════
    # Delay Details in Period
    # ════════════════════════════════════════════════════════════════════
    if delay_entries:
        if not period_entries:
            pdf.add_page()
        pdf.ln(2)
        section_header('DELAY DETAILS IN PERIOD')

        for entry in delay_entries:
            date_str = entry.entry_date.strftime('%d/%m/%Y')
            pdf.set_fill_color(255, 243, 226)
            pdf.set_font('Helvetica', 'B', 8)
            pdf.cell(0, 5,
                     safe(f'{date_str}  --  {entry.delay_hours}h  {entry.delay_reason or ""}'),
                     new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
            if entry.delay_description:
                pdf.set_font('Helvetica', '', 8)
                pdf.set_text_color(80, 40, 0)
                pdf.multi_cell(0, 4, safe(entry.delay_description),
                               new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.set_text_color(0, 0, 0)
            pdf.ln(1)

    # ════════════════════════════════════════════════════════════════════
    # All-time Delay Summary
    # ════════════════════════════════════════════════════════════════════
    if delay_summary:
        pdf.ln(3)
        section_header('ALL-TIME DELAY SUMMARY')
        col_w2 = [52, 38, 22, 22, 28]
        pdf.set_font('Helvetica', 'B', 8)
        pdf.set_fill_color(255, 220, 200)
        for hdr, w in zip(['Reason', 'Type', 'Events', 'Hours', 'Schedule Impact'], col_w2):
            pdf.cell(w, 6, hdr, border=1, fill=True)
        pdf.ln()

        pdf.set_font('Helvetica', '', 8)
        hrs_per_day = project.hours_per_day or 8
        for cat in delay_summary:
            impact = round(cat['hours'] / hrs_per_day, 1)
            pdf.cell(col_w2[0], 5, safe(cat['reason']), border=1)
            pdf.cell(col_w2[1], 5, 'Site Delay', border=1)
            pdf.cell(col_w2[2], 5, str(cat['events']), border=1, align='R')
            pdf.cell(col_w2[3], 5, f"{cat['hours']}h", border=1, align='R')
            pdf.cell(col_w2[4], 5, f"~{impact}d", border=1, align='R')
            pdf.ln()
        pdf.ln(4)

    # Footer
    pdf.set_font('Helvetica', '', 8)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(0, 5, f'Generated: {today.strftime("%d/%m/%Y")}',
             new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')

    return bytes(pdf.output())


def generate_weekly_report_pdf(project, week_start, week_end, entries, settings):
    """Generate a weekly progress report PDF for client distribution."""
    pdf = FPDF()
    pdf.set_margins(15, 15, 15)
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)

    company = safe(settings.get('company_name', '') or 'Project Tracker')

    pdf.set_font('Helvetica', 'B', 18)
    pdf.cell(0, 10, company, new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
    pdf.set_font('Helvetica', 'B', 14)
    pdf.cell(0, 8, safe(project.name), new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
    pdf.set_font('Helvetica', '', 10)
    period = safe(f'Weekly Progress Report: {week_start.strftime("%d/%m/%Y")} - {week_end.strftime("%d/%m/%Y")}')
    pdf.cell(0, 6, period, new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')
    pdf.ln(4)

    total_sqm = sum(e.total_sqm for e in entries)
    total_hours = sum(e.install_hours or 0 for e in entries)
    total_delay = sum(e.delay_hours or 0 for e in entries)
    days_with_install = len({e.entry_date for e in entries if e.total_sqm > 0})

    pdf.set_fill_color(240, 244, 255)
    pdf.set_font('Helvetica', 'B', 10)
    pdf.cell(0, 7, 'WEEK SUMMARY', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
    pdf.set_font('Helvetica', '', 9)

    def kv(label, value):
        pdf.set_font('Helvetica', 'B', 9)
        pdf.cell(60, 6, label + ':')
        pdf.set_font('Helvetica', '', 9)
        pdf.cell(0, 6, safe(str(value)), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    kv('Reporting Period', f'{week_start.strftime("%d/%m/%Y")} to {week_end.strftime("%d/%m/%Y")}')
    kv('Days with Installation', str(days_with_install))
    kv('Total Installed', f'{round(total_sqm, 1)} m2')
    kv('Total Install Hours', f'{round(total_hours, 1)} hrs')
    if total_delay > 0:
        kv('Total Delay Hours', f'{round(total_delay, 1)} hrs')
    pdf.ln(4)

    if entries:
        pdf.set_fill_color(220, 230, 255)
        pdf.set_font('Helvetica', 'B', 10)
        pdf.cell(0, 7, 'DAILY BREAKDOWN', new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)

        col_w = [22, 20, 28, 40, 22, 22, 22]
        pdf.set_font('Helvetica', 'B', 8)
        pdf.set_fill_color(200, 215, 255)
        for h, w in zip(['Date', 'Day', 'Lot', 'Material', 'Hrs', 'm2', 'Delay'], col_w):
            pdf.cell(w, 6, h, border=1, fill=True, align='C')
        pdf.ln()

        sorted_entries = sorted(entries, key=lambda e: e.entry_date)
        pdf.set_font('Helvetica', '', 8)
        for e in sorted_entries:
            # Use production lines if available
            lines = e.production_lines if e.production_lines else [
                type('PL', (), {'lot_number': e.lot_number, 'material': e.material, 'install_sqm': e.install_sqm})()
            ]
            for i, pl in enumerate(lines):
                pdf.cell(col_w[0], 5, e.entry_date.strftime('%d/%m/%y') if i == 0 else '', border=1, align='C')
                pdf.cell(col_w[1], 5, e.entry_date.strftime('%a') if i == 0 else '', border=1, align='C')
                pdf.cell(col_w[2], 5, safe(pl.lot_number or '-'), border=1)
                pdf.cell(col_w[3], 5, safe(pl.material or '-'), border=1)
                pdf.cell(col_w[4], 5, str(round(e.install_hours or 0, 1)) if i == 0 else '', border=1, align='R')
                pdf.cell(col_w[5], 5, str(round(pl.install_sqm or 0, 1)), border=1, align='R')
                pdf.cell(col_w[6], 5, (str(round(e.delay_hours or 0, 1)) if e.delay_hours else '-') if i == 0 else '', border=1, align='R')
                pdf.ln()

            note_parts = []
            if e.delay_reason and e.delay_hours and e.delay_hours > 0:
                note_parts.append(safe(f'Delay: {e.delay_reason}'))
            if e.delay_description:
                note_parts.append(safe(e.delay_description))
            if e.notes:
                note_parts.append(safe(e.notes))
            if e.other_work_description:
                note_parts.append(safe(f'Other work: {e.other_work_description}'))
            if note_parts:
                pdf.set_font('Helvetica', 'I', 7)
                pdf.set_fill_color(248, 248, 248)
                pdf.cell(sum(col_w), 4, safe(' | '.join(note_parts)), border=1, fill=True)
                pdf.ln()
                pdf.set_font('Helvetica', '', 8)
        pdf.ln(4)
    else:
        pdf.set_font('Helvetica', 'I', 9)
        pdf.cell(0, 6, 'No entries recorded for this week.', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(4)

    pdf.set_font('Helvetica', '', 8)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(0, 5, safe(f'Generated: {date.today().strftime("%d/%m/%Y")}'),
             new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')

    return bytes(pdf.output())
