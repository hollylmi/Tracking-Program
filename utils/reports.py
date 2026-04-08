import os
import tempfile
from collections import defaultdict
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
    pdf.set_margins(12, 12, 12)
    page_w = pdf.w - pdf.l_margin - pdf.r_margin

    def section_header(title):
        pdf.set_font('Helvetica', 'B', 8)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(0, 5, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_draw_color(200, 200, 200)
        pdf.set_line_width(0.2)
        pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
        pdf.set_text_color(0, 0, 0)

    def detail_row(label, value):
        pdf.set_font('Helvetica', '', 7)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(45, 4, safe(str(label)))
        pdf.set_text_color(30, 30, 30)
        pdf.set_font('Helvetica', 'B', 7)
        pdf.cell(0, 4, safe(str(value)) if value is not None else '-',
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    # ── Header ────────────────────────────────────────────────────
    _static = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'static')
    logo_path = None
    for ext in ('png', 'jpg', 'jpeg', 'gif'):
        _p = os.path.join(_static, f'logo.{ext}')
        if os.path.exists(_p):
            logo_path = _p
            break

    header_y = pdf.get_y()
    text_x = pdf.l_margin
    if logo_path:
        pdf.image(logo_path, x=pdf.l_margin, y=header_y, h=14, keep_aspect_ratio=True)
        text_x = pdf.l_margin + 38
    pdf.set_xy(text_x, header_y)
    tw = page_w - (38 if logo_path else 0)
    pdf.set_font('Helvetica', 'B', 12)
    pdf.cell(tw, 5, 'PROGRESS REPORT', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(text_x)
    pdf.set_font('Helvetica', '', 9)
    pdf.cell(tw, 4, safe(project.name), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(text_x)
    pdf.set_font('Helvetica', '', 7)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(tw, 3, header_period, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_text_color(0, 0, 0)
    pdf.set_y(max(pdf.get_y(), header_y + 15))
    pdf.set_draw_color(135, 200, 235)
    pdf.set_line_width(0.6)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(2)

    # ── Status (if available) ─────────────────────────────────────
    if progress and progress.get('should_be_pct') is not None:
        total_planned_days = progress.get('total_planned_days', 0)
        site_delay_days = progress.get('site_delay_days', 0)
        variation_delay_days = progress.get('variation_delay_days', 0)
        total_delay_days = site_delay_days + variation_delay_days
        actual_pct = progress['overall_pct']
        should_pct = progress['should_be_pct']
        diff = round(actual_pct - should_pct, 1)

        col3 = page_w / 3
        pdf.set_font('Helvetica', 'B', 16)
        pdf.set_text_color(30, 30, 30)
        pdf.cell(col3, 7, safe(f'{actual_pct}%'), align='C')
        pdf.cell(col3, 7, safe(f'{should_pct}%'), align='C')
        if diff >= 0:
            pdf.set_text_color(0, 140, 60)
        else:
            pdf.set_text_color(180, 0, 0)
        pdf.cell(col3, 7, safe(f'{"+%.1f" % diff if diff >= 0 else "%.1f" % diff}%'),
                 align='C', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_text_color(100, 100, 100)
        pdf.set_font('Helvetica', '', 6)
        pdf.cell(col3, 3, 'Actual Progress', align='C')
        pdf.cell(col3, 3, 'Expected Progress', align='C')
        pdf.cell(col3, 3, 'Ahead' if diff >= 0 else 'Behind',
                 align='C', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_text_color(0, 0, 0)
        pdf.set_font('Helvetica', '', 6)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(0, 3,
                 safe(f'{total_planned_days} planned days  |  '
                      f'{total_delay_days} delay days  |  '
                      f'{total_planned_days - total_delay_days} workable days'),
                 align='C', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_text_color(0, 0, 0)
        pdf.ln(2)

    # ── Project Summary ───────────────────────────────────────────
    section_header('PROJECT SUMMARY')
    col2 = page_w / 2
    # Row 1
    pdf.set_font('Helvetica', '', 7)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(45, 4, 'Start Date')
    pdf.set_text_color(30, 30, 30)
    pdf.set_font('Helvetica', 'B', 7)
    pdf.cell(col2 - 45, 4, safe(project.start_date.strftime('%d/%m/%Y') if project.start_date else '-'))
    pdf.set_font('Helvetica', '', 7)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(35, 4, 'Quoted Days')
    pdf.set_text_color(30, 30, 30)
    pdf.set_font('Helvetica', 'B', 7)
    pdf.cell(0, 4, safe(str(project.quoted_days or '-')), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    if progress:
        # Row 2
        pdf.set_font('Helvetica', '', 7)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(45, 4, 'Planned')
        pdf.set_text_color(30, 30, 30)
        pdf.set_font('Helvetica', 'B', 7)
        pdf.cell(col2 - 45, 4, safe(f'{progress["total_planned"]} m\u00b2'))
        pdf.set_font('Helvetica', '', 7)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(35, 4, 'Installed')
        pdf.set_text_color(30, 30, 30)
        pdf.set_font('Helvetica', 'B', 7)
        pdf.cell(0, 4, safe(f'{progress["total_actual"]} m\u00b2'),
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        # Row 3
        pdf.set_font('Helvetica', '', 7)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(45, 4, 'Remaining')
        pdf.set_text_color(30, 30, 30)
        pdf.set_font('Helvetica', 'B', 7)
        pdf.cell(col2 - 45, 4, safe(f'{progress["total_remaining"]} m\u00b2'))
        if progress.get('install_rate'):
            pdf.set_font('Helvetica', '', 7)
            pdf.set_text_color(100, 100, 100)
            pdf.cell(35, 4, 'Rate')
            pdf.set_text_color(30, 30, 30)
            pdf.set_font('Helvetica', 'B', 7)
            pdf.cell(0, 4, safe(f'{progress["install_rate"]} m\u00b2/hr'),
                     new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        else:
            pdf.ln()

    if gantt_data:
        pdf.set_font('Helvetica', '', 7)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(45, 4, 'Target Finish')
        pdf.set_text_color(30, 30, 30)
        pdf.set_font('Helvetica', 'B', 7)
        pdf.cell(col2 - 45, 4, safe(gantt_data.get('target_finish') or '-'))
        pdf.set_font('Helvetica', '', 7)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(35, 4, 'Est. Finish')
        pdf.set_text_color(30, 30, 30)
        pdf.set_font('Helvetica', 'B', 7)
        v = gantt_data.get('variance_days')
        est = gantt_data.get('est_finish') or '-'
        if v is not None and v != 0:
            if v > 0:
                pdf.set_text_color(180, 0, 0)
            else:
                pdf.set_text_color(0, 140, 60)
            est += f' ({"+%d" % v if v > 0 else "%d" % v}d)'
        pdf.cell(0, 4, safe(est), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_text_color(0, 0, 0)
    pdf.ln(1)

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

        cw = [24, 22, page_w - 24 - 22]  # Date, SQM, Detail

        def da_header():
            pdf.set_fill_color(50, 55, 65)
            pdf.set_text_color(255, 255, 255)
            pdf.set_font('Helvetica', 'B', 7)
            pdf.cell(cw[0], 5, ' Date', border=1, fill=True)
            pdf.cell(cw[1], 5, ' Total m2', border=1, fill=True)
            pdf.cell(cw[2], 5, ' Production / Delays / Variations', border=1, fill=True)
            pdf.ln()
            pdf.set_text_color(0, 0, 0)

        da_header()

        for idx, entry in enumerate(period_entries):
            # Build detail text
            lines = []
            prod_lines = entry.production_lines if entry.production_lines else [
                type('PL', (), {'lot_number': entry.lot_number, 'material': entry.material,
                                'install_sqm': entry.install_sqm})()
            ] if (entry.lot_number or entry.material) else []
            for pl in prod_lines:
                p = []
                if pl.lot_number:
                    p.append(f'Lot {pl.lot_number}')
                if pl.material:
                    p.append(pl.material)
                if pl.install_sqm:
                    p.append(f'{pl.install_sqm} m\u00b2')
                if p:
                    lines.append(('P', ' - '.join(p)))

            if entry.delay_lines:
                for dl in entry.delay_lines:
                    if (dl.hours or 0) > 0:
                        lines.append(('D', f'{dl.reason} {dl.hours}h'))
            elif (entry.delay_hours or 0) > 0:
                lines.append(('D', f'{entry.delay_reason or "Delay"} {entry.delay_hours}h'))

            if entry.variation_lines:
                for vl in entry.variation_lines:
                    if (vl.hours or 0) > 0:
                        vn = f'V{vl.variation_number}' if vl.variation_number else 'Var'
                        lines.append(('V', f'{vn} {vl.hours}h'))

            if entry.machines_stood_down:
                lines.append(('S', 'Machines stood down'))

            detail = '; '.join(t for _, t in lines) if lines else '-'
            # Truncate to fit cell
            if len(detail) > 90:
                detail = detail[:87] + '...'

            # Page break
            if pdf.get_y() + 5 > pdf.h - pdf.b_margin - 3:
                pdf.add_page()
                section_header('DAILY ACTIVITIES (cont.)')
                da_header()

            bg = (245, 247, 252) if idx % 2 == 0 else (255, 255, 255)
            pdf.set_fill_color(*bg)
            pdf.set_font('Helvetica', 'B', 7)
            pdf.set_text_color(30, 30, 30)
            pdf.cell(cw[0], 5, safe(f' {entry.entry_date.strftime("%a %d/%m")}'), border=1, fill=True)
            pdf.set_font('Helvetica', 'B', 7)
            pdf.cell(cw[1], 5, safe(f' {entry.total_sqm}'), border=1, fill=True, align='R')
            pdf.set_font('Helvetica', '', 7)
            pdf.cell(cw[2], 5, safe(f' {detail}'), border=1, fill=True)
            pdf.ln()

        pdf.set_text_color(0, 0, 0)

        # ── Delay & Variation Register (separate page) ──────────────
        delay_entries_all = [e for e in period_entries
                             if (e.delay_lines or (e.delay_hours and e.delay_hours > 0)
                                 or e.variation_lines)]
        if delay_entries_all:
            pdf.add_page()
            section_header('DELAY & VARIATION REGISTER')

            rcw = [24, 28, 14, page_w - 24 - 28 - 14]

            def reg_header():
                pdf.set_fill_color(50, 55, 65)
                pdf.set_text_color(255, 255, 255)
                pdf.set_font('Helvetica', 'B', 7)
                pdf.cell(rcw[0], 5, ' Date', border=1, fill=True)
                pdf.cell(rcw[1], 5, ' Type', border=1, fill=True)
                pdf.cell(rcw[2], 5, ' Hours', border=1, fill=True, align='C')
                pdf.cell(rcw[3], 5, ' Description', border=1, fill=True)
                pdf.ln()
                pdf.set_text_color(0, 0, 0)

            reg_header()
            ri = 0

            def reg_row(dt, typ, color, hrs, desc):
                nonlocal ri
                if pdf.get_y() + 5 > pdf.h - pdf.b_margin - 3:
                    pdf.add_page()
                    section_header('DELAY & VARIATION REGISTER (cont.)')
                    reg_header()
                bg = (245, 247, 252) if ri % 2 == 0 else (255, 255, 255)
                pdf.set_fill_color(*bg)
                pdf.set_font('Helvetica', '', 7)
                pdf.set_text_color(30, 30, 30)
                pdf.cell(rcw[0], 5, safe(f' {dt}'), border=1, fill=True)
                pdf.set_text_color(*color)
                pdf.set_font('Helvetica', 'B', 7)
                pdf.cell(rcw[1], 5, safe(f' {typ}'), border=1, fill=True)
                pdf.set_text_color(30, 30, 30)
                pdf.set_font('Helvetica', '', 7)
                pdf.cell(rcw[2], 5, safe(f'{hrs}h'), border=1, fill=True, align='C')
                pdf.set_text_color(60, 60, 60)
                # Truncate desc to fit
                d = safe(desc or '-')
                if len(d) > 65:
                    d = d[:62] + '...'
                pdf.cell(rcw[3], 5, safe(f' {d}'), border=1, fill=True)
                pdf.ln()
                ri += 1

            for entry in delay_entries_all:
                dt = entry.entry_date.strftime('%a %d/%m')
                if entry.delay_lines:
                    for dl in entry.delay_lines:
                        if (dl.hours or 0) > 0:
                            reg_row(dt, dl.reason or 'Delay', (180, 50, 50),
                                    dl.hours, dl.description or '')
                elif (entry.delay_hours or 0) > 0:
                    reg_row(dt, entry.delay_reason or 'Delay', (180, 50, 50),
                            entry.delay_hours, entry.delay_description or '')
                if entry.variation_lines:
                    for vl in entry.variation_lines:
                        if (vl.hours or 0) > 0:
                            vn = f'V{vl.variation_number}' if vl.variation_number else 'Variation'
                            reg_row(dt, vn, (160, 100, 0), vl.hours, vl.description or '')

            pdf.set_text_color(0, 0, 0)

    # ════════════════════════════════════════════════════════════════════
    # Delay Details in Period
    # ════════════════════════════════════════════════════════════════════
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

    # ════════════════════════════════════════════════════════════════════
    # Signature Block
    # ════════════════════════════════════════════════════════════════════
    if pdf.get_y() + 40 > pdf.h - pdf.b_margin:
        pdf.add_page()
    pdf.ln(6)
    pdf.set_draw_color(180, 180, 180)
    pdf.set_line_width(0.2)

    pdf.set_font('Helvetica', 'B', 8)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 5, 'AUTHORISATION', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(3)

    pdf.set_font('Helvetica', '', 8)
    pdf.set_text_color(100, 100, 100)
    half_sig = page_w / 2 - 5
    pdf.cell(half_sig, 5, 'Prepared by:')
    pdf.cell(10, 5, '')
    pdf.cell(half_sig, 5, 'Approved by:', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(8)
    pdf.cell(half_sig, 5, '________________________________')
    pdf.cell(10, 5, '')
    pdf.cell(half_sig, 5, '________________________________', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.cell(half_sig, 4, 'Name / Signature')
    pdf.cell(10, 4, '')
    pdf.cell(half_sig, 4, 'Name / Signature', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(5)
    pdf.cell(half_sig, 5, 'Date: ____________________')
    pdf.cell(10, 5, '')
    pdf.cell(half_sig, 5, 'Date: ____________________', new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.ln(6)
    pdf.set_font('Helvetica', '', 6)
    pdf.set_text_color(160, 160, 160)
    pdf.cell(0, 3, safe(f'Generated {today.strftime("%d/%m/%Y")} | {company}'),
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


def generate_client_delay_report_pdf(project, settings):
    """Generate a Client Delay & Variation Report PDF with full descriptions and schedule impact."""
    today = date.today()
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_margins(12, 12, 12)

    company = safe(settings.get('company_name', '') or 'Project Tracker')
    hrs_per_day = project.hours_per_day or 8

    all_entries = (DailyEntry.query
                   .filter_by(project_id=project.id)
                   .order_by(DailyEntry.entry_date)
                   .all())

    # ════════════════════════════════════════════════════════════════════
    # PAGE 1 — Header + Delay Register
    # ════════════════════════════════════════════════════════════════════
    pdf.add_page()
    page_w = pdf.w - pdf.l_margin - pdf.r_margin

    def section_header(title):
        pdf.set_font('Helvetica', 'B', 8)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(page_w, 4, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_draw_color(135, 200, 235)
        pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + page_w, pdf.get_y())
        pdf.ln(2)
        pdf.set_text_color(0, 0, 0)

    # ── Logo + Header ────────────────────────────────────────────────
    _static = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'static')
    logo_path = None
    for ext in ('png', 'jpg', 'jpeg', 'gif'):
        _p = os.path.join(_static, f'logo.{ext}')
        if os.path.exists(_p):
            logo_path = _p
            break

    header_y = pdf.get_y()
    text_x = pdf.l_margin
    if logo_path:
        pdf.image(logo_path, x=pdf.l_margin, y=header_y, h=14, keep_aspect_ratio=True)
        text_x = pdf.l_margin + 38
    pdf.set_xy(text_x, header_y)
    tw = page_w - (38 if logo_path else 0)
    pdf.set_font('Helvetica', 'B', 12)
    pdf.cell(tw, 5, 'CLIENT DELAY & VARIATION REPORT', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(text_x)
    pdf.set_font('Helvetica', '', 9)
    pdf.cell(tw, 4, safe(project.name), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(text_x)
    pdf.set_font('Helvetica', '', 7)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(tw, 3, safe(f'Generated: {today.strftime("%d/%m/%Y")}'),
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_text_color(0, 0, 0)
    pdf.set_y(max(pdf.get_y(), header_y + 15))
    pdf.set_draw_color(135, 200, 235)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + page_w, pdf.get_y())
    pdf.ln(4)

    # ════════════════════════════════════════════════════════════════════
    # REPORT OVERVIEW — what this report is and what each section means
    # ════════════════════════════════════════════════════════════════════
    section_header('REPORT OVERVIEW')
    pdf.set_font('Helvetica', '', 7)
    pdf.set_text_color(50, 50, 50)
    pdf.multi_cell(page_w, 3.5, safe(
        'This report provides a comprehensive record of all site delays and client-directed '
        'variation works encountered during the project. It is intended to support project '
        'scheduling discussions and demonstrate how delay time was managed on site.'
    ), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(1.5)

    pdf.set_font('Helvetica', 'B', 7)
    pdf.cell(page_w, 3.5, 'Sections included:', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font('Helvetica', '', 7)
    for section_desc in [
        '* Delay Register - A chronological log of every delay event with full descriptions, '
        'reasons, and hours lost.',
        '* Variation Register - A chronological log of all client-directed variation works '
        'including crew allocated and hours spent.',
        '* Delay Day Utilisation - Shows how delay time was offset by productive work. On days '
        'where delays prevented primary deployment, the crew were redeployed to client variations '
        'and alternative material deployment/welding where possible.',
        '* All-Time Delay Summary - Delays grouped by reason showing total events, hours, and '
        'equivalent schedule days lost.',
        '* All-Time Variation Summary - Variations grouped by number showing total events, hours, '
        'person-hours, and schedule impact.',
    ]:
        pdf.multi_cell(page_w, 3.5, safe(section_desc), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.ln(1.5)
    pdf.set_font('Helvetica', 'I', 6.5)
    pdf.set_text_color(100, 100, 100)
    pdf.multi_cell(page_w, 3.5, safe(
        'Note: This report only shows data pertinent to deployment progress and client works. '
        'During delay periods, additional site activities such as site clean-ups, equipment '
        'maintenance, safety inductions, and general housekeeping were also carried out but are '
        'not included in this report. The delay day utilisation figures reflect only client '
        'variation work and alternative material deployment/welding.'
    ), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_text_color(0, 0, 0)
    pdf.ln(4)

    # ════════════════════════════════════════════════════════════════════
    # DELAY REGISTER — full descriptions using multi_cell
    # ════════════════════════════════════════════════════════════════════
    delay_entries = [e for e in all_entries
                     if e.delay_lines or (e.delay_hours and e.delay_hours > 0)]

    if delay_entries:
        section_header('DELAY REGISTER')

        col_date = 24
        col_reason = 32
        col_hours = 14
        col_desc = page_w - col_date - col_reason - col_hours

        def delay_table_header():
            pdf.set_fill_color(50, 55, 65)
            pdf.set_text_color(255, 255, 255)
            pdf.set_font('Helvetica', 'B', 7)
            pdf.cell(col_date, 6, ' Date', border=1, fill=True)
            pdf.cell(col_reason, 6, ' Reason', border=1, fill=True)
            pdf.cell(col_hours, 6, ' Hours', border=1, fill=True, align='C')
            pdf.cell(col_desc, 6, ' Description', border=1, fill=True)
            pdf.ln()
            pdf.set_text_color(0, 0, 0)

        delay_table_header()
        ri = 0
        total_delay_hrs = 0.0

        for entry in delay_entries:
            dt = entry.entry_date.strftime('%a %d/%m/%y')
            lines = []
            if entry.delay_lines:
                for dl in entry.delay_lines:
                    if (dl.hours or 0) > 0:
                        lines.append((dl.reason or 'Delay', dl.hours, dl.description or '-'))
            elif (entry.delay_hours or 0) > 0:
                lines.append((entry.delay_reason or 'Delay', entry.delay_hours,
                              entry.delay_description or '-'))

            for reason, hrs, desc in lines:
                total_delay_hrs += hrs or 0
                # Calculate how many lines the description needs
                desc_text = safe(desc)
                pdf.set_font('Helvetica', '', 7)
                desc_lines = pdf.multi_cell(col_desc, 4, desc_text, split_only=True)
                row_h = max(5, len(desc_lines) * 4)

                # Page break check
                if pdf.get_y() + row_h > pdf.h - pdf.b_margin - 5:
                    pdf.add_page()
                    section_header('DELAY REGISTER (cont.)')
                    delay_table_header()

                bg = (245, 247, 252) if ri % 2 == 0 else (255, 255, 255)
                pdf.set_fill_color(*bg)
                y_start = pdf.get_y()

                # Fixed-width cells for date, reason, hours
                pdf.set_font('Helvetica', '', 7)
                pdf.cell(col_date, row_h, safe(f' {dt}'), border=1, fill=True)
                pdf.set_font('Helvetica', 'B', 7)
                pdf.set_text_color(180, 50, 50)
                pdf.cell(col_reason, row_h, safe(f' {reason}'), border=1, fill=True)
                pdf.set_text_color(0, 0, 0)
                pdf.set_font('Helvetica', '', 7)
                pdf.cell(col_hours, row_h, safe(f'{hrs}h'), border=1, fill=True, align='C')

                # Multi-line description cell
                x_desc = pdf.get_x()
                pdf.multi_cell(col_desc, 4, safe(f' {desc_text}'), border=1, fill=True)

                # Ensure we're at the right Y position
                pdf.set_y(y_start + row_h)
                ri += 1

        # Delay total
        pdf.set_font('Helvetica', 'B', 8)
        pdf.set_fill_color(255, 220, 200)
        pdf.cell(col_date + col_reason, 6, ' TOTAL DELAYS', border=1, fill=True)
        pdf.cell(col_hours, 6, safe(f'{round(total_delay_hrs, 1)}h'), border=1, fill=True, align='C')
        impact_days = round(total_delay_hrs / hrs_per_day, 1) if hrs_per_day else 0
        pdf.cell(col_desc, 6, safe(f' Schedule impact: ~{impact_days} day(s)'), border=1, fill=True)
        pdf.ln()
        pdf.ln(4)

    # ════════════════════════════════════════════════════════════════════
    # VARIATION REGISTER — full descriptions
    # ════════════════════════════════════════════════════════════════════
    variation_entries = [e for e in all_entries if e.variation_lines]

    if variation_entries:
        if pdf.get_y() + 40 > pdf.h - pdf.b_margin:
            pdf.add_page()
        section_header('VARIATION REGISTER')

        col_date_v = 24
        col_var = 20
        col_hours_v = 14
        col_crew_v = 14
        col_desc_v = page_w - col_date_v - col_var - col_hours_v - col_crew_v

        def var_table_header():
            pdf.set_fill_color(50, 55, 65)
            pdf.set_text_color(255, 255, 255)
            pdf.set_font('Helvetica', 'B', 7)
            pdf.cell(col_date_v, 6, ' Date', border=1, fill=True)
            pdf.cell(col_var, 6, ' Variation', border=1, fill=True)
            pdf.cell(col_hours_v, 6, ' Hours', border=1, fill=True, align='C')
            pdf.cell(col_crew_v, 6, ' Crew', border=1, fill=True, align='C')
            pdf.cell(col_desc_v, 6, ' Description', border=1, fill=True)
            pdf.ln()
            pdf.set_text_color(0, 0, 0)

        var_table_header()
        ri = 0
        total_var_hrs = 0.0
        total_var_p_hrs = 0.0

        for entry in variation_entries:
            dt = entry.entry_date.strftime('%a %d/%m/%y')
            for vl in entry.variation_lines:
                if (vl.hours or 0) <= 0:
                    continue
                vn = f'V{vl.variation_number}' if vl.variation_number else 'Var'
                desc_text = safe(vl.description or '-')
                crew = vl.num_crew or 0
                p_hrs = vl.person_hours or 0
                total_var_hrs += vl.hours
                total_var_p_hrs += p_hrs

                pdf.set_font('Helvetica', '', 7)
                desc_lines = pdf.multi_cell(col_desc_v, 4, desc_text, split_only=True)
                row_h = max(5, len(desc_lines) * 4)

                if pdf.get_y() + row_h > pdf.h - pdf.b_margin - 5:
                    pdf.add_page()
                    section_header('VARIATION REGISTER (cont.)')
                    var_table_header()

                bg = (245, 247, 252) if ri % 2 == 0 else (255, 255, 255)
                pdf.set_fill_color(*bg)
                y_start = pdf.get_y()

                pdf.set_font('Helvetica', '', 7)
                pdf.cell(col_date_v, row_h, safe(f' {dt}'), border=1, fill=True)
                pdf.set_font('Helvetica', 'B', 7)
                pdf.set_text_color(160, 100, 0)
                pdf.cell(col_var, row_h, safe(f' {vn}'), border=1, fill=True)
                pdf.set_text_color(0, 0, 0)
                pdf.set_font('Helvetica', '', 7)
                pdf.cell(col_hours_v, row_h, safe(f'{vl.hours}h'), border=1, fill=True, align='C')
                pdf.cell(col_crew_v, row_h, safe(str(crew)), border=1, fill=True, align='C')

                x_desc = pdf.get_x()
                pdf.multi_cell(col_desc_v, 4, safe(f' {desc_text}'), border=1, fill=True)
                pdf.set_y(y_start + row_h)
                ri += 1

        # Variation total
        pdf.set_font('Helvetica', 'B', 8)
        pdf.set_fill_color(255, 235, 200)
        pdf.cell(col_date_v + col_var, 6, ' TOTAL VARIATIONS', border=1, fill=True)
        pdf.cell(col_hours_v, 6, safe(f'{round(total_var_hrs, 1)}h'), border=1, fill=True, align='C')
        pdf.cell(col_crew_v, 6, '', border=1, fill=True)
        var_impact = round(total_var_hrs / hrs_per_day, 1) if hrs_per_day else 0
        pdf.cell(col_desc_v, 6, safe(f' Total person-hours: {round(total_var_p_hrs, 1)} | Schedule impact: ~{var_impact} day(s)'),
                 border=1, fill=True)
        pdf.ln()
        pdf.ln(4)

    # ════════════════════════════════════════════════════════════════════
    # DELAY RECOVERY — what productive work happened on delay days
    # ════════════════════════════════════════════════════════════════════
    # A "delay day" = any entry with delay lines/hours > 0
    # Recovery = variation hours + other activity hours on those same days
    delay_day_dates = set()
    total_delay_hrs_all = 0.0
    recovery_variation_hrs = 0.0
    recovery_other_hrs = 0.0
    recovery_production_hrs = 0.0

    for e in all_entries:
        has_delay = False
        if e.delay_lines:
            for dl in e.delay_lines:
                if (dl.hours or 0) > 0:
                    has_delay = True
                    total_delay_hrs_all += dl.hours
        elif (e.delay_hours or 0) > 0:
            has_delay = True
            total_delay_hrs_all += e.delay_hours

        if has_delay:
            delay_day_dates.add(e.entry_date)
            # Count productive work on this delay day
            recovery_variation_hrs += e.total_variation_hours or 0
            recovery_other_hrs += e.total_other_activity_hours or 0
            # Production lines on delay days (e.g. deploying geotextile during rain)
            for pl in (e.production_lines or []):
                recovery_production_hrs += pl.install_hours or 0

    total_recovery_hrs = recovery_variation_hrs + recovery_production_hrs
    recovery_pct = round(total_recovery_hrs / total_delay_hrs_all * 100, 1) if total_delay_hrs_all > 0 else 0

    # ── Delay Recovery Summary section ──
    if delay_day_dates:
        if pdf.get_y() + 35 > pdf.h - pdf.b_margin:
            pdf.add_page()
        section_header('DELAY DAY UTILISATION')

        pdf.set_font('Helvetica', '', 7)
        pdf.set_text_color(80, 80, 80)
        pdf.multi_cell(page_w, 3.5, safe(
            'On days where site delays occurred, the crew were redeployed where possible '
            'to maximise productive time. The table below summarises how delay hours were '
            'offset by productive work including client variations, alternative material '
            'deployment, and other site activities.'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(2)
        pdf.set_text_color(0, 0, 0)

        # Summary boxes
        box_w = page_w / 4
        pdf.set_font('Helvetica', 'B', 7)
        pdf.set_fill_color(255, 220, 220)
        pdf.cell(box_w, 5, ' Total Delay Hours', border=1, fill=True)
        pdf.set_fill_color(220, 245, 220)
        pdf.cell(box_w, 5, ' Recovered Hours', border=1, fill=True)
        pdf.set_fill_color(230, 240, 255)
        pdf.cell(box_w, 5, ' Net Lost Hours', border=1, fill=True)
        pdf.set_fill_color(245, 245, 245)
        pdf.cell(box_w, 5, ' Recovery Rate', border=1, fill=True)
        pdf.ln()

        net_lost = max(0, total_delay_hrs_all - total_recovery_hrs)
        pdf.set_font('Helvetica', 'B', 10)
        pdf.set_fill_color(255, 235, 235)
        pdf.cell(box_w, 8, safe(f' {round(total_delay_hrs_all, 1)}h'), border=1, fill=True)
        pdf.set_fill_color(235, 250, 235)
        pdf.cell(box_w, 8, safe(f' {round(total_recovery_hrs, 1)}h'), border=1, fill=True)
        pdf.set_fill_color(240, 245, 255)
        pdf.cell(box_w, 8, safe(f' {round(net_lost, 1)}h'), border=1, fill=True)
        pdf.set_fill_color(250, 250, 250)
        pdf.cell(box_w, 8, safe(f' {recovery_pct}%'), border=1, fill=True)
        pdf.ln()
        pdf.ln(2)

        # Breakdown of recovery
        pdf.set_font('Helvetica', '', 7)
        rcw = [page_w * 0.5, page_w * 0.25, page_w * 0.25]
        pdf.set_fill_color(50, 55, 65)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font('Helvetica', 'B', 7)
        pdf.cell(rcw[0], 5, ' Activity on Delay Days', border=1, fill=True)
        pdf.cell(rcw[1], 5, ' Hours', border=1, fill=True, align='C')
        pdf.cell(rcw[2], 5, ' % of Delay Time', border=1, fill=True, align='C')
        pdf.ln()
        pdf.set_text_color(0, 0, 0)
        pdf.set_font('Helvetica', '', 7)

        for label, hrs, color in [
            ('Client Variation Work', recovery_variation_hrs, (160, 100, 0)),
            ('Alternative Material Deployment / Welding', recovery_production_hrs, (40, 120, 60)),
        ]:
            if hrs > 0:
                pct_r = round(hrs / total_delay_hrs_all * 100, 1) if total_delay_hrs_all > 0 else 0
                pdf.cell(rcw[0], 5, safe(f' {label}'), border=1)
                pdf.cell(rcw[1], 5, safe(f'{round(hrs, 1)}h'), border=1, align='C')
                pdf.cell(rcw[2], 5, safe(f'{pct_r}%'), border=1, align='C')
                pdf.ln()

        pdf.ln(4)

    # ════════════════════════════════════════════════════════════════════
    # ALL-TIME DELAY SUMMARY — grouped by reason
    # ════════════════════════════════════════════════════════════════════
    delay_by_reason = defaultdict(lambda: {'events': 0, 'hours': 0.0})
    for e in all_entries:
        if e.delay_lines:
            for dl in e.delay_lines:
                if (dl.hours or 0) > 0:
                    reason = dl.reason or 'Other'
                    delay_by_reason[reason]['events'] += 1
                    delay_by_reason[reason]['hours'] += dl.hours
        elif (e.delay_hours or 0) > 0:
            reason = e.delay_reason or 'Other'
            delay_by_reason[reason]['events'] += 1
            delay_by_reason[reason]['hours'] += e.delay_hours

    if delay_by_reason:
        if pdf.get_y() + 30 > pdf.h - pdf.b_margin:
            pdf.add_page()
        section_header('ALL-TIME DELAY SUMMARY')

        scw = [65, 22, 22, 30, 47]
        pdf.set_font('Helvetica', 'B', 7)
        pdf.set_fill_color(220, 50, 50)
        pdf.set_text_color(255, 255, 255)
        for hdr, w in zip(['Reason', 'Events', 'Hours', 'Equiv. Days', '% of Total'], scw):
            pdf.cell(w, 6, safe(f' {hdr}'), border=1, fill=True)
        pdf.ln()
        pdf.set_text_color(0, 0, 0)

        grand_delay_hrs = sum(v['hours'] for v in delay_by_reason.values())
        ri = 0
        for reason in sorted(delay_by_reason, key=lambda r: delay_by_reason[r]['hours'], reverse=True):
            data = delay_by_reason[reason]
            impact = round(data['hours'] / hrs_per_day, 1)
            pct = round(data['hours'] / grand_delay_hrs * 100, 1) if grand_delay_hrs > 0 else 0
            bg = (245, 247, 252) if ri % 2 == 0 else (255, 255, 255)
            pdf.set_fill_color(*bg)
            pdf.set_font('Helvetica', '', 7)
            pdf.cell(scw[0], 5, safe(f' {reason}'), border=1, fill=True)
            pdf.cell(scw[1], 5, str(data['events']), border=1, fill=True, align='R')
            pdf.cell(scw[2], 5, safe(f"{round(data['hours'], 1)}h"), border=1, fill=True, align='R')
            pdf.cell(scw[3], 5, safe(f"~{impact} day(s)"), border=1, fill=True, align='R')
            pdf.cell(scw[4], 5, safe(f' {pct}%'), border=1, fill=True)
            pdf.ln()
            ri += 1

        # Grand total
        pdf.set_font('Helvetica', 'B', 8)
        pdf.set_fill_color(255, 220, 200)
        pdf.cell(scw[0], 6, ' TOTAL', border=1, fill=True)
        pdf.cell(scw[1], 6, str(sum(v['events'] for v in delay_by_reason.values())), border=1, fill=True, align='R')
        pdf.cell(scw[2], 6, safe(f'{round(grand_delay_hrs, 1)}h'), border=1, fill=True, align='R')
        grand_impact = round(grand_delay_hrs / hrs_per_day, 1) if hrs_per_day else 0
        pdf.cell(scw[3], 6, safe(f'~{grand_impact}d'), border=1, fill=True, align='R')
        pdf.cell(scw[4], 6, '100%', border=1, fill=True, align='C')
        pdf.ln()
        pdf.ln(4)

    # ════════════════════════════════════════════════════════════════════
    # ALL-TIME VARIATION SUMMARY — grouped by variation number
    # ════════════════════════════════════════════════════════════════════
    var_by_num = defaultdict(lambda: {'events': 0, 'hours': 0.0, 'person_hours': 0.0, 'description': ''})
    for e in all_entries:
        for vl in (e.variation_lines or []):
            if (vl.hours or 0) > 0:
                vn = f'V{vl.variation_number}' if vl.variation_number else 'Unspecified'
                var_by_num[vn]['events'] += 1
                var_by_num[vn]['hours'] += vl.hours
                var_by_num[vn]['person_hours'] += vl.person_hours or 0
                if vl.description and len(vl.description) > len(var_by_num[vn]['description']):
                    var_by_num[vn]['description'] = vl.description  # keep longest description

    if var_by_num:
        if pdf.get_y() + 30 > pdf.h - pdf.b_margin:
            pdf.add_page()
        section_header('ALL-TIME VARIATION SUMMARY')

        vcw = [20, 60, 18, 24, 24, 40]
        pdf.set_font('Helvetica', 'B', 8)
        pdf.set_fill_color(200, 130, 0)
        pdf.set_text_color(255, 255, 255)
        for hdr, w in zip(['Variation', 'Description', 'Events', 'Hours', 'Person-Hrs', 'Schedule Impact'], vcw):
            pdf.cell(w, 6, safe(f' {hdr}'), border=1, fill=True)
        pdf.ln()
        pdf.set_text_color(0, 0, 0)

        grand_var_hrs = sum(v['hours'] for v in var_by_num.values())
        ri = 0
        for vn in sorted(var_by_num.keys()):
            data = var_by_num[vn]
            impact = round(data['hours'] / hrs_per_day, 1)
            bg = (245, 247, 252) if ri % 2 == 0 else (255, 255, 255)
            pdf.set_fill_color(*bg)
            pdf.set_font('Helvetica', 'B', 7)
            pdf.cell(vcw[0], 5, safe(f' {vn}'), border=1, fill=True)
            pdf.set_font('Helvetica', '', 7)
            desc = safe(data['description'])
            if len(desc) > 45:
                desc = desc[:42] + '...'
            pdf.cell(vcw[1], 5, safe(f' {desc}'), border=1, fill=True)
            pdf.cell(vcw[2], 5, str(data['events']), border=1, fill=True, align='R')
            pdf.cell(vcw[3], 5, safe(f"{round(data['hours'], 1)}h"), border=1, fill=True, align='R')
            pdf.cell(vcw[4], 5, safe(f"{round(data['person_hours'], 1)}"), border=1, fill=True, align='R')
            pdf.cell(vcw[5], 5, safe(f"~{impact} day(s) impact"), border=1, fill=True)
            pdf.ln()
            ri += 1

        # Grand total
        pdf.set_font('Helvetica', 'B', 8)
        pdf.set_fill_color(255, 235, 200)
        pdf.cell(vcw[0] + vcw[1], 6, ' TOTAL', border=1, fill=True)
        pdf.cell(vcw[2], 6, str(sum(v['events'] for v in var_by_num.values())), border=1, fill=True, align='R')
        pdf.cell(vcw[3], 6, safe(f'{round(grand_var_hrs, 1)}h'), border=1, fill=True, align='R')
        grand_p_hrs = sum(v['person_hours'] for v in var_by_num.values())
        pdf.cell(vcw[4], 6, safe(f'{round(grand_p_hrs, 1)}'), border=1, fill=True, align='R')
        grand_impact = round(grand_var_hrs / hrs_per_day, 1) if hrs_per_day else 0
        pdf.cell(vcw[5], 6, safe(f'~{grand_impact}d total'), border=1, fill=True)
        pdf.ln()
        pdf.ln(4)

    # ════════════════════════════════════════════════════════════════════
    # Footer
    # ════════════════════════════════════════════════════════════════════
    pdf.ln(6)
    pdf.set_font('Helvetica', '', 6)
    pdf.set_text_color(160, 160, 160)
    pdf.cell(0, 3, safe(f'Generated {today.strftime("%d/%m/%Y")} | {company}'),
             new_x=XPos.LMARGIN, new_y=YPos.NEXT, align='C')

    return bytes(pdf.output())
