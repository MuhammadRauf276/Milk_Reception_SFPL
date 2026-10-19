import os
import json
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import parse_xml, OxmlElement
from docx.oxml.ns import nsdecls, qn

def set_cell_background(cell, hex_color):
    shading_xml = f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>'
    cell._tc.get_or_add_tcPr().append(parse_xml(shading_xml))

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = OxmlElement('w:tcMar')
    for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        node = OxmlElement(f'w:{m}')
        node.set(qn('w:w'), str(val))
        node.set(qn('w:type'), 'dxa')
        tcMar.append(node)
    tcPr.append(tcMar)

def set_table_borders(table, color="D1D5DB", sz="4"):
    tblPr = table._tbl.tblPr
    borders_xml = f'''
    <w:tblBorders {nsdecls("w")}>
        <w:top w:val="single" w:sz="{sz}" w:space="0" w:color="{color}"/>
        <w:left w:val="none"/>
        <w:bottom w:val="single" w:sz="{sz}" w:space="0" w:color="{color}"/>
        <w:right w:val="none"/>
        <w:insideH w:val="single" w:sz="{sz}" w:space="0" w:color="{color}"/>
        <w:insideV w:val="none"/>
    </w:tblBorders>
    '''
    tblPr.append(parse_xml(borders_xml))

def create_document():
    doc = docx.Document()

    # Page Margins (Standard 0.75 in for professional reports)
    for section in doc.sections:
        section.top_margin = Inches(0.75)
        section.bottom_margin = Inches(0.75)
        section.left_margin = Inches(0.75)
        section.right_margin = Inches(0.75)
        section.header_distance = Inches(0.4)
        section.footer_distance = Inches(0.4)

    # Palette
    COLOR_PRIMARY = RGBColor(198, 30, 39)    # Shakarganj Deep Red (#C61E27)
    COLOR_DARK = RGBColor(30, 41, 59)        # Slate 800 (#1E293B)
    COLOR_MUTED = RGBColor(100, 116, 139)    # Slate 500 (#64748B)
    COLOR_PASS = RGBColor(5, 150, 105)       # Emerald Green (#059669)
    COLOR_WARN = RGBColor(217, 119, 6)       # Amber (#D97706)
    COLOR_FAIL = RGBColor(225, 29, 72)       # Rose Red (#E11D48)

    # Title & Header
    title_p = doc.add_paragraph()
    title_p.paragraph_format.space_before = Pt(0)
    title_p.paragraph_format.space_after = Pt(2)
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_sub = title_p.add_run("SHAKARGANJ FOOD PRODUCTS LIMITED (SFPL)\n")
    r_sub.font.name = "Arial"
    r_sub.font.size = Pt(11)
    r_sub.font.bold = True
    r_sub.font.color.rgb = COLOR_PRIMARY

    r_main = title_p.add_run("MILK RECEPTION QUALITY SPECIFICATIONS & SOP EVALUATION RULES\n")
    r_main.font.name = "Arial"
    r_main.font.size = Pt(16)
    r_main.font.bold = True
    r_main.font.color.rgb = COLOR_DARK

    r_desc = title_p.add_run("Complete Laboratory Test Master Catalog, 3-Zone Tolerance Standards (PASS / WARNING / FAIL),\nOperational Thresholds Across All Stages & Authoritative Escalation Hierarchy")
    r_desc.font.name = "Calibri"
    r_desc.font.size = Pt(10)
    r_desc.font.color.rgb = COLOR_MUTED

    doc.add_paragraph().paragraph_format.space_after = Pt(4)

    # Document Control Metadata Box
    meta_table = doc.add_table(rows=2, cols=4)
    meta_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    meta_data = [
        [("Document Code:", "SFPL-SOP-QA-001"), ("Effective Date:", "October 2026"), ("Version:", "2.0 (Authoritative)"), ("Application:", "Milk Reception App")],
        [("System Domain:", "Milk Procurement & QA"), ("Review Cycle:", "Annual / Steering Comm."), ("Status:", "Official Master Standard"), ("Authority:", "Executive QA & MPD")]
    ]
    for r_idx, row in enumerate(meta_data):
        for c_idx, (k, v) in enumerate(row):
            cell = meta_table.cell(r_idx, c_idx)
            set_cell_background(cell, "F8FAFC")
            set_cell_margins(cell, top=60, bottom=60, left=100, right=100)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.space_before = Pt(0)
            rk = p.add_run(f"{k} ")
            rk.font.name = "Calibri"
            rk.font.size = Pt(8.5)
            rk.font.bold = True
            rk.font.color.rgb = COLOR_DARK
            rv = p.add_run(v)
            rv.font.name = "Calibri"
            rv.font.size = Pt(8.5)
            rv.font.color.rgb = COLOR_MUTED
    set_table_borders(meta_table, "E2E8F0", "4")

    doc.add_paragraph().paragraph_format.space_after = Pt(8)

    # -------------------------------------------------------------
    # SECTION 1: EXECUTIVE OVERVIEW
    # -------------------------------------------------------------
    h1 = doc.add_paragraph()
    h1.paragraph_format.space_before = Pt(12)
    h1.paragraph_format.space_after = Pt(4)
    r = h1.add_run("1. Executive Overview & Purpose of Document")
    r.font.name = "Arial"
    r.font.size = Pt(13)
    r.font.bold = True
    r.font.color.rgb = COLOR_PRIMARY

    p_intro = doc.add_paragraph()
    p_intro.paragraph_format.space_after = Pt(6)
    p_intro.paragraph_format.line_spacing = 1.15
    r = p_intro.add_run(
        "This document establishes the official standard operating parameters, quantitative tolerance boundaries, "
        "chemical adulteration screening criteria, and decision escalation lines governing raw milk acceptance for "
        "Shakarganj Food Products Limited (SFPL). It serves as the authoritative blueprint implemented within the Milk "
        "Reception Application to ensure absolute compliance with food safety, dairy processing standards, and audit trails."
    )
    r.font.name = "Calibri"
    r.font.size = Pt(10)
    r.font.color.rgb = COLOR_DARK

    p_keys = doc.add_paragraph()
    p_keys.paragraph_format.space_after = Pt(8)
    p_keys.paragraph_format.line_spacing = 1.15
    r = p_keys.add_run(
        "Key Governance Principles:\n"
        "• Three-Zone Tolerance Engine: Automatic categorization of every test observation into Accepted (PASS), Tolerance Margin (WARNING), or Non-Compliant (FAIL).\n"
        "• Mandatory 2-Picture Live Camera Rule: Lactometer Reading (LR) and Gerber Fat test tubes require direct hardware camera capture with automated cryptographic watermarks (Date/Time, Stage, Token, Vehicle, GPS).\n"
        "• Unambiguous Authority Escalation: Strict role-based escalation lines for any test failure or missing photo—never mixing departments or using personal names.\n"
        "• Standardized Operator/Manager Interactions: Field chemists/operators capture mandatory Reason for Exception *, while designated department heads record mandatory Manager Remarks * upon formal APPROVE or REJECT.\n"
        "• Professional Terminology Mandate: Strict prohibition of non-standard or colloquial vehicle designations across all documentation and software modules. All logistics and milk collection transport units are designated exclusively as 'vehicle' (e.g., collection vehicle, MOT vehicle) or 'tanker' (bulk road tanker)."
    )
    r.font.name = "Calibri"
    r.font.size = Pt(9.5)
    r.font.color.rgb = COLOR_DARK

    # Operational Workflow Clarification
    h1_sub = doc.add_paragraph()
    h1_sub.paragraph_format.space_before = Pt(8)
    h1_sub.paragraph_format.space_after = Pt(3)
    r_sub = h1_sub.add_run("Operational Stations & Milk Movement Architecture")
    r_sub.font.name = "Arial"
    r_sub.font.size = Pt(11)
    r_sub.font.bold = True
    r_sub.font.color.rgb = COLOR_DARK

    p_flow = doc.add_paragraph()
    p_flow.paragraph_format.space_after = Pt(8)
    p_flow.paragraph_format.line_spacing = 1.15
    r = p_flow.add_run(
        "1. MOT at Shop (Field Collection):\n"
        "   The Mobile Tester travels along established rural routes, visiting individual village collection shops. The tester performs rapid on-site screening (Alcohol test, Acidity, Fat, LR, Temperature) on each supplier's milk prior to pouring into milk cans on the collection vehicle. Substandard milk is rejected at the shop gate. Any field exception requires ZMCC Manager authorization.\n\n"
        "2. ZMCC Lab = ZMCC Intake (The Gatekeeper Station):\n"
        "   Operationally and physically, ZMCC Intake and ZMCC Lab constitute the single gatekeeper reception checkpoint. Every vehicle arriving at the ZMCC—including MOT collection vehicles returning with cans, direct contractor vehicles, and local suppliers—must stop at the ZMCC Lab before unloading. The ZMCC Lab Attendant executes composite laboratory testing across all parameters. Milk CANNOT enter the reception dock until ZMCC Lab testing passes (or is formally approved by MPD Head upon documented exception).\n\n"
        "3. Tank Reception (PHE Chilling & Bulk Storage):\n"
        "   Immediately upon ZMCC Lab clearance, milk is transferred from the vehicle/cans through the Plate Heat Exchanger (PHE) chilling unit (cooling to < 4°C) into designated bulk insulated storage tanks. Volume, chilling temperature, and tank assignments are recorded under continuous monitoring.\n\n"
        "4. Dispatch to Plant:\n"
        "   Chilled bulk milk from ZMCC storage tanks is pumped into insulated road tankers for long-haul transfer to the primary processing Plant. Pre-dispatch verification ensures tank chilling temperature and composite quality match required dispatch standards. Any missing data is escalated to the MPD Head.\n\n"
        "5. Plant Reception Lab (Primary Plant Quality Gate):\n"
        "   Upon arrival at the Plant, the road tanker passes First Weight at the weighbridge (establishing the operational business date at 08:00 AM cutoff). The Plant Reception Lab (QAE – Reception Lab) performs comprehensive multi-parameter chemical and microbiological testing. Only upon formal QA clearance does the tanker proceed to Second Weight and unloading into Plant silos."
    )
    r.font.name = "Calibri"
    r.font.size = Pt(9.5)
    r.font.color.rgb = COLOR_DARK

    # -------------------------------------------------------------
    # SECTION 2: 3-ZONE QUALITY EVALUATION ENGINE
    # -------------------------------------------------------------
    h2 = doc.add_paragraph()
    h2.paragraph_format.space_before = Pt(14)
    h2.paragraph_format.space_after = Pt(4)
    r = h2.add_run("2. The Three-Zone Quality Evaluation Engine (PASS / WARNING / FAIL)")
    r.font.name = "Arial"
    r.font.size = Pt(13)
    r.font.bold = True
    r.font.color.rgb = COLOR_PRIMARY

    p_engine = doc.add_paragraph()
    p_engine.paragraph_format.space_after = Pt(6)
    r = p_engine.add_run(
        "The application evaluates every observed parameter through an automated mathematical engine dividing results into three distinct zones:"
    )
    r.font.name = "Calibri"
    r.font.size = Pt(10)
    r.font.color.rgb = COLOR_DARK

    # Table of 3 Zones
    zone_table = doc.add_table(rows=4, cols=4)
    zone_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    col_widths = [Inches(1.2), Inches(1.8), Inches(1.8), Inches(2.2)]
    
    headers = ["Evaluation Zone", "Quantitative Formula", "Qualitative Rule", "Operational Consequence"]
    hdr_row = zone_table.rows[0]
    for c_idx, title in enumerate(headers):
        cell = hdr_row.cells[c_idx]
        set_cell_background(cell, "1E293B")
        set_cell_margins(cell, top=80, bottom=80, left=100, right=100)
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run(title)
        run.font.name = "Arial"
        run.font.size = Pt(9)
        run.font.bold = True
        run.font.color.rgb = RGBColor(255, 255, 255)

    zone_data = [
        ("ACCEPTED\n(PASS)", "min_value ≤ Observed ≤ max_value", "Option = OK / NEGATIVE\n(No adulterants detected)", "Automatic clearance. Milk proceeds directly to weighbridge, chilling tank, or plant reception silos.", "ECFDF5", COLOR_PASS),
        ("WARNING\n(HOLD / TOLERANCE)", "[min - offset, min)\nOR\n(max, max + offset]", "Monitoring parameter variance\n(e.g., BR Value marginal drift)", "Warning notification logged. Operator reviews quality variance before confirmation.", "FFFBEB", COLOR_WARN),
        ("REJECTED\n(FAIL / OUT OF SPEC)", "Observed < (min - offset)\nOR\nObserved > (max + offset)", "Option = NOT_OK / POSITIVE\n(Adulterant or Clotting detected)", "Milk rejected by standard SOP. Acceptance requires mandatory Exception Workflow & designated Manager authorization.", "FFF1F2", COLOR_FAIL)
    ]

    for r_idx, (z_title, q_form, q_rule, o_conseq, bg_hex, text_color) in enumerate(zone_data, start=1):
        row = zone_table.rows[r_idx]
        
        c0 = row.cells[0]
        set_cell_background(c0, bg_hex)
        set_cell_margins(c0, top=70, bottom=70, left=100, right=100)
        p0 = c0.paragraphs[0]
        r0 = p0.add_run(z_title)
        r0.font.name = "Arial"
        r0.font.size = Pt(8.5)
        r0.font.bold = True
        r0.font.color.rgb = text_color

        for idx, text in enumerate([q_form, q_rule, o_conseq], start=1):
            cell = row.cells[idx]
            set_cell_background(cell, "FFFFFF" if r_idx % 2 == 1 else "F8FAFC")
            set_cell_margins(cell, top=70, bottom=70, left=100, right=100)
            p = cell.paragraphs[0]
            r = p.add_run(text)
            r.font.name = "Calibri"
            r.font.size = Pt(8.5)
            r.font.color.rgb = COLOR_DARK

    set_table_borders(zone_table, "CBD5E1", "4")

    doc.add_paragraph().paragraph_format.space_after = Pt(10)

    # -------------------------------------------------------------
    # SECTION 3: COMPLETE MASTER LAB TEST SPECIFICATIONS
    # -------------------------------------------------------------
    h3 = doc.add_paragraph()
    h3.paragraph_format.space_before = Pt(14)
    h3.paragraph_format.space_after = Pt(4)
    r = h3.add_run("3. Complete Master Catalog of Laboratory Tests")
    r.font.name = "Arial"
    r.font.size = Pt(13)
    r.font.bold = True
    r.font.color.rgb = COLOR_PRIMARY

    p_tintro = doc.add_paragraph()
    p_tintro.paragraph_format.space_after = Pt(6)
    r = p_tintro.add_run(
        "Below is the complete inventory of all laboratory parameters configured within the SFPL Milk Reception Application. "
        "Each test is classified by its physical/chemical category, unit of observation, input data type, and testing point applicability."
    )
    r.font.name = "Calibri"
    r.font.size = Pt(10)
    r.font.color.rgb = COLOR_DARK

    test_table = doc.add_table(rows=1, cols=7)
    test_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    test_headers = ["Code", "Parameter Name", "Category", "Result Type", "Unit", "Mandatory Scope", "Live Photo"]
    
    t_hdr = test_table.rows[0]
    for c_idx, title in enumerate(test_headers):
        cell = t_hdr.cells[c_idx]
        set_cell_background(cell, "1E293B")
        set_cell_margins(cell, top=80, bottom=80, left=70, right=70)
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run(title)
        run.font.name = "Arial"
        run.font.size = Pt(8.5)
        run.font.bold = True
        run.font.color.rgb = RGBColor(255, 255, 255)

    # Complete 30 core tests
    tests_catalog = [
        ("LT-000001", "Temperature", "Physical", "NUMERIC", "°C", "ALL STAGES", "Optional"),
        ("LT-000002", "Organoleptic Smell", "Physical", "OK_NOT_OK", "—", "Plant QA", "Optional"),
        ("LT-000003", "Organoleptic Taste", "Physical", "OK_NOT_OK", "—", "Plant QA", "Optional"),
        ("LT-000004", "Clot on Boiling (COB)", "Thermal Stability", "POSITIVE_NEGATIVE", "—", "MOT, ZMCC, Plant", "Optional"),
        ("LT-000005", "Acidity (% Lactic Acid)", "Physicochemical", "NUMERIC", "%", "MOT, ZMCC, Plant", "Optional"),
        ("LT-000006", "pH @ 20°C", "Physicochemical", "NUMERIC", "pH", "Plant QA", "Optional"),
        ("LT-000007", "Alcohol Precip. (APT 60%)", "Protein Stability", "POSITIVE_NEGATIVE", "—", "ZMCC, Plant", "Optional"),
        ("LT-000008", "LR @ 20°C (Lactometer)", "Density & Solids", "NUMERIC", "Reading", "ALL STAGES", "REQUIRED (Live Cam)"),
        ("LT-000009", "SNF to Fat Ratio", "Calculated", "CALCULATED", "Ratio", "ZMCC, Plant", "—"),
        ("LT-000010", "Salt (Sodium Chloride)", "Adulteration", "NUMERIC", "%", "Plant QA", "Optional"),
        ("LT-000011", "Starch", "Adulteration", "POSITIVE_NEGATIVE", "—", "MOT, ZMCC, Plant", "Optional"),
        ("LT-000012", "Urea", "Adulteration", "POSITIVE_NEGATIVE", "—", "MOT, ZMCC, Plant", "Optional"),
        ("LT-000013", "Ammonium Salts", "Adulteration", "POSITIVE_NEGATIVE", "—", "Plant QA", "Optional"),
        ("LT-000014", "Sugar (Cane Sugar / Sucrose)", "Adulteration", "POSITIVE_NEGATIVE", "—", "MOT, ZMCC, Plant", "Optional"),
        ("LT-000015", "Glucose", "Adulteration", "POSITIVE_NEGATIVE", "—", "Plant QA", "Optional"),
        ("LT-000016", "Sorbitol", "Adulteration", "POSITIVE_NEGATIVE", "—", "Plant QA", "Optional"),
        ("LT-000017", "Detergent / Surfactants", "Adulteration", "POSITIVE_NEGATIVE", "—", "MOT, ZMCC, Plant", "Optional"),
        ("LT-000018", "Formalin", "Preservative", "POSITIVE_NEGATIVE", "—", "ZMCC, Plant", "Optional"),
        ("LT-000019", "Hydrogen Peroxide (H2O2)", "Preservative", "POSITIVE_NEGATIVE", "—", "ZMCC, Plant", "Optional"),
        ("LT-000020", "Antibiotic Residues", "Safety / Residue", "POSITIVE_NEGATIVE", "—", "Plant QA", "Optional"),
        ("LT-000021", "BR Value @ 40°C", "Fat Purity", "NUMERIC", "Value", "Plant QA", "Optional"),
        ("LT-000022", "Protein", "Compositional", "NUMERIC", "%", "Plant QA", "Optional"),
        ("LT-000023", "Whey Protein Ratio", "Compositional", "NUMERIC", "Ratio", "Plant QA", "Optional"),
        ("LT-000024", "Sodium per 100g SNF", "Mineral Content", "NUMERIC", "mg/100g", "Plant QA", "Optional"),
        ("LT-000025", "MBRT (Methylene Blue)", "Microbiological", "NUMERIC", "Minutes", "Plant QA", "Optional"),
        ("LT-000026", "Fat (Gerber Method)", "Compositional", "NUMERIC", "%", "ALL STAGES", "REQUIRED (Live Cam)"),
        ("LT-000027", "Raw Lactometer Reading", "Density", "NUMERIC", "Reading", "Field Verification", "Optional"),
        ("LT-000028", "Cup Test (Acid / Neutral)", "Platform", "POSITIVE_NEGATIVE", "—", "Plant QA", "Optional"),
        ("LT-000029", "RM Value (Reichert-Meissl)", "Fat Purity", "NUMERIC", "Value", "Plant QA", "Optional"),
        ("LT-000030", "Aflatoxin M1", "Mycotoxin Safety", "NUMERIC", "ppt", "Plant QA", "Optional")
    ]

    for r_idx, t in enumerate(tests_catalog):
        row = test_table.add_row()
        bg_color = "F8FAFC" if r_idx % 2 == 1 else "FFFFFF"
        for c_idx, val in enumerate(t):
            cell = row.cells[c_idx]
            set_cell_background(cell, bg_color)
            set_cell_margins(cell, top=50, bottom=50, left=70, right=70)
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            run = p.add_run(val)
            run.font.name = "Calibri"
            run.font.size = Pt(8)
            run.font.color.rgb = COLOR_DARK
            if c_idx == 0:
                run.font.bold = True
                run.font.color.rgb = COLOR_PRIMARY
            elif c_idx == 6 and "REQUIRED" in val:
                run.font.bold = True
                run.font.color.rgb = COLOR_FAIL

    set_table_borders(test_table, "CBD5E1", "4")

    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    # -------------------------------------------------------------
    # SECTION 4: COMPLETE ACCEPTED / WARNING / REJECTED SOP THRESHOLDS
    # -------------------------------------------------------------
    h4 = doc.add_paragraph()
    h4.paragraph_format.space_before = Pt(14)
    h4.paragraph_format.space_after = Pt(4)
    r = h4.add_run("4. Authoritative Operational Standards: PASS, WARNING, and FAIL Limits")
    r.font.name = "Arial"
    r.font.size = Pt(13)
    r.font.bold = True
    r.font.color.rgb = COLOR_PRIMARY

    p_sintro = doc.add_paragraph()
    p_sintro.paragraph_format.space_after = Pt(6)
    r = p_sintro.add_run(
        "The following matrix defines the exact quantitative limits and qualitative passing criteria evaluated by the system. "
        "Any observation outside the Accepted (PASS) range triggers automated workflow controls according to the established SOP."
    )
    r.font.name = "Calibri"
    r.font.size = Pt(10)
    r.font.color.rgb = COLOR_DARK

    sop_table = doc.add_table(rows=1, cols=6)
    sop_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    sop_headers = ["Parameter Name", "Unit", "ACCEPTED (PASS)", "WARNING (HOLD)", "REJECTED (FAIL)", "Applicable Stations"]

    s_hdr = sop_table.rows[0]
    for c_idx, title in enumerate(sop_headers):
        cell = s_hdr.cells[c_idx]
        set_cell_background(cell, "1E293B")
        set_cell_margins(cell, top=80, bottom=80, left=70, right=70)
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run(title)
        run.font.name = "Arial"
        run.font.size = Pt(8.5)
        run.font.bold = True
        run.font.color.rgb = RGBColor(255, 255, 255)

    sop_specs = [
        # Physical & Platform
        ("Temperature (Chilled Milk)", "°C", "0.00 – 10.00 °C", "10.01 – 11.50 °C (+1.5° offset)", "> 11.50 °C (Warm milk)", "All (Dispatch, ZMCC, Plant)"),
        ("Temperature (Fresh Morning)", "°C", "Ambient / ≤ 25.0 °C", "25.1 – 28.0 °C", "> 28.0 °C", "MOT Village Collection"),
        ("Organoleptic Smell", "—", "OK (Fresh clean smell)", "Slight sour / feed odor", "NOT OK (Off / sour / foul)", "Plant QA Reception"),
        ("Organoleptic Taste", "—", "OK (Characteristic sweet)", "Flat / slightly off", "NOT OK (Sour, bitter, salty)", "Plant QA Reception"),
        ("Clot on Boiling (COB)", "—", "NEGATIVE (No clotting)", "—", "POSITIVE (Clots / Curds formed)", "MOT, ZMCC Lab, Plant QA"),
        ("Acidity (% Lactic Acid)", "%", "0.10% – 0.16%", "0.161% – 0.170% (+0.01% offset)", "< 0.10% OR > 0.170%", "All Stages"),
        ("pH @ 20°C", "pH", "6.60 – 6.80", "6.50 – 6.59 OR 6.81 – 6.90", "< 6.50 OR > 6.90", "Plant QA Reception"),
        ("Alcohol Precipitation (APT 60%)", "—", "NEGATIVE (No flakes)", "—", "POSITIVE (Precipitates / Flakes)", "ZMCC Intake, Plant QA"),
        ("Cup Test", "—", "NEGATIVE", "—", "POSITIVE", "Plant QA Reception"),
        
        # Compositional & Solids
        ("Fat (Standard Reception)", "%", "3.50% – 5.50%", "3.30% – 3.49% (-0.2% tolerance)", "< 3.30% OR > 6.00%", "MOT, ZMCC Lab, Dispatch"),
        ("Fat (Plant Silo Intake)", "%", "3.50% – 5.00%", "3.40% – 3.49% (-0.1% tolerance)", "< 3.40% OR > 5.50%", "Plant QA Reception"),
        ("LR @ 20°C (Lactometer)", "Deg", "26.00 – 32.00", "25.00 – 25.99 (-1.0 tolerance)", "< 25.00 (Watered) OR > 33.00", "All Stages"),
        ("Solids-Not-Fat (SNF)", "%", "8.00% – 9.50%", "7.75% – 7.99% (-0.25% tolerance)", "< 7.75%", "Calculated (All Stages)"),
        ("Total Solids (TS)", "%", "11.50% – 15.00%", "11.00% – 11.49%", "< 11.00%", "Calculated (All Stages)"),
        ("SNF to Fat Ratio", "Ratio", "1.80 – 2.40", "1.70 – 1.79 OR 2.41 – 2.50", "< 1.70 OR > 2.50", "Calculated (All Stages)"),
        
        # Chemical Adulterants (Zero Tolerance)
        ("Salt (Sodium Chloride)", "%", "< 0.09%", "0.09% – 0.11%", "> 0.11% (Added salt)", "Plant QA Reception"),
        ("Starch / Flour", "—", "NEGATIVE (No blue color)", "—", "POSITIVE (Blue ring / complex)", "MOT, ZMCC Lab, Plant QA"),
        ("Urea (Added Nitrogen)", "—", "NEGATIVE (Normal trace)", "—", "POSITIVE (Yellow/Red complex)", "MOT, ZMCC Lab, Plant QA"),
        ("Ammonium Salts", "—", "NEGATIVE", "—", "POSITIVE (Ammonia detected)", "Plant QA Reception"),
        ("Sugar / Sucrose", "—", "NEGATIVE", "—", "POSITIVE (Red resorcinol test)", "MOT, ZMCC Lab, Plant QA"),
        ("Glucose", "—", "NEGATIVE", "—", "POSITIVE", "Plant QA Reception"),
        ("Sorbitol", "—", "NEGATIVE", "—", "POSITIVE", "Plant QA Reception"),
        ("Detergent / Washing Powder", "—", "NEGATIVE (No dye shift)", "—", "POSITIVE (Methylene blue dye)", "MOT, ZMCC Lab, Plant QA"),
        ("Formalin (Preservative)", "—", "NEGATIVE (No violet ring)", "—", "POSITIVE (Violet ring formed)", "ZMCC Intake, Plant QA"),
        ("Hydrogen Peroxide (H2O2)", "—", "NEGATIVE (No blue/green)", "—", "POSITIVE (Peroxide present)", "ZMCC Intake, Plant QA"),
        
        # Food Safety & Advanced Testing
        ("Antibiotic Residues", "—", "NEGATIVE (Clear / No halo)", "—", "POSITIVE (Inhibitor present)", "Plant QA Reception"),
        ("Aflatoxin M1", "ppt", "≤ 500.0 ppt", "501.0 – 550.0 ppt", "> 550.0 ppt (Exceeds limit)", "Plant QA Reception"),
        ("BR Value @ 40°C", "Val", "39.00 – 42.00", "42.01 – 43.00 (Monitoring)", "< 38.50 OR > 43.00 (Foreign Fat)", "Plant QA Reception"),
        ("RM Value (Reichert-Meissl)", "Val", "≥ 24.00", "22.00 – 23.99", "< 22.00 (Adulterated Fat)", "Plant QA Reception"),
        ("Protein Content", "%", "2.90% – 3.60%", "2.75% – 2.89%", "< 2.75%", "Plant QA Reception"),
        ("MBRT (Microbial Quality)", "Min", "≥ 30 Minutes", "20 – 29 Minutes", "< 20 Minutes (High bacterial)", "Plant QA Reception")
    ]

    for r_idx, (p_name, u_name, p_acc, p_warn, p_rej, p_stat) in enumerate(sop_specs):
        row = sop_table.add_row()
        bg_color = "F8FAFC" if r_idx % 2 == 1 else "FFFFFF"

        for c_idx, val in enumerate([p_name, u_name, p_acc, p_warn, p_rej, p_stat]):
            cell = row.cells[c_idx]
            set_cell_background(cell, bg_color)
            set_cell_margins(cell, top=50, bottom=50, left=70, right=70)
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            run = p.add_run(val)
            run.font.name = "Calibri"
            run.font.size = Pt(8)
            run.font.color.rgb = COLOR_DARK
            
            if c_idx == 0:
                run.font.bold = True
            elif c_idx == 2:
                run.font.bold = True
                run.font.color.rgb = COLOR_PASS
            elif c_idx == 3:
                run.font.color.rgb = COLOR_WARN
            elif c_idx == 4:
                run.font.bold = True
                run.font.color.rgb = COLOR_FAIL

    set_table_borders(sop_table, "CBD5E1", "4")

    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    # -------------------------------------------------------------
    # SECTION 5: 2-PICTURE LIVE CAMERA EVIDENCE PROTOCOL
    # -------------------------------------------------------------
    h5 = doc.add_paragraph()
    h5.paragraph_format.space_before = Pt(14)
    h5.paragraph_format.space_after = Pt(4)
    r = h5.add_run("5. Two-Picture Live Camera Rule & Watermarking Protocol")
    r.font.name = "Arial"
    r.font.size = Pt(13)
    r.font.bold = True
    r.font.color.rgb = COLOR_PRIMARY

    p_cam = doc.add_paragraph()
    p_cam.paragraph_format.space_after = Pt(6)
    p_cam.paragraph_format.line_spacing = 1.15
    r = p_cam.add_run(
        "To prevent fraudulent data entry and guarantee visual auditability, SFPL enforces the strict 2-Picture Live Camera Rule:\n"
        "1. Eligible Parameters: Exactly TWO tests require photographic evidence during milk examination:\n"
        "   • Lactometer Reading (LR): Photograph of the lactometer bulb and stem immersed in the milk testing cylinder at eye-level.\n"
        "   • Gerber Fat Reading: Photograph of the graduated butyrometer column after centrifugation showing the clear fat column separation.\n"
        "2. Hardware Camera Trigger: Gallery selection or pre-existing photo upload is strictly blocked on field devices. Devices trigger the physical environment camera directly (<input type=\"file\" capture=\"environment\" accept=\"image/*\" />).\n"
        "3. Cryptographic Watermark: Every captured image is rendered on an in-memory HTML5 Canvas and stamped with:\n"
        "   • Operational Pakistan Date & Time (PKT)\n"
        "   • Testing Stage (MOT Shop / ZMCC Lab / Plant QA Reception)\n"
        "   • Active Vehicle Number & Scale Token Number\n"
        "   • High-Precision GPS Coordinates (Latitude, Longitude, Live Accuracy in meters)\n"
        "   • STRICT RULE: No personal employee names appear on the visual watermark (auditable via encrypted system user ID only).\n"
        "4. Missing Camera Fallback: If hardware camera fails or is unavailable on a mobile device, the system does not crash or permit bypass; it converts the session into an Authoritative Exception, requiring mandatory Reason for Exception * and escalating to the designated authority."
    )
    r.font.name = "Calibri"
    r.font.size = Pt(9.5)
    r.font.color.rgb = COLOR_DARK

    doc.add_paragraph().paragraph_format.space_after = Pt(8)

    # -------------------------------------------------------------
    # SECTION 6: AUTHORITATIVE DECISION ESCALATION HIERARCHY
    # -------------------------------------------------------------
    h6 = doc.add_paragraph()
    h6.paragraph_format.space_before = Pt(14)
    h6.paragraph_format.space_after = Pt(4)
    r = h6.add_run("6. Authoritative Decision Conflict Escalation Hierarchy")
    r.font.name = "Arial"
    r.font.size = Pt(13)
    r.font.bold = True
    r.font.color.rgb = COLOR_PRIMARY

    p_esc = doc.add_paragraph()
    p_esc.paragraph_format.space_after = Pt(6)
    r = p_esc.add_run(
        "When milk fails an SOP rule (FAIL) or a test photo is missing, field personnel cannot accept or bypass the failure. "
        "The system routes the session to designated management authorities following the approved hierarchy:"
    )
    r.font.name = "Calibri"
    r.font.size = Pt(10)
    r.font.color.rgb = COLOR_DARK

    esc_table = doc.add_table(rows=5, cols=5)
    esc_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    esc_headers = ["Testing Stage", "Primary Operating Role", "Conflict / Exception Condition", "Authorizing Authority", "Interaction Pattern"]

    e_hdr = esc_table.rows[0]
    for c_idx, title in enumerate(esc_headers):
        cell = e_hdr.cells[c_idx]
        set_cell_background(cell, "1E293B")
        set_cell_margins(cell, top=80, bottom=80, left=70, right=70)
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run(title)
        run.font.name = "Arial"
        run.font.size = Pt(8.5)
        run.font.bold = True
        run.font.color.rgb = RGBColor(255, 255, 255)

    esc_matrix = [
        ("Stage 1: MOT Shop Collection", "Mobile Tester", "Failed field test (Acidity, Fat, LR, Adulteration) OR missing photo", "ZMCC Manager", "Tester enters Reason for Exception * → Button: 'Confirm & Send to ZMCC Manager' → ZMCC Manager enters Manager Remarks * upon APPROVE / REJECT"),
        ("Stage 2: ZMCC Intake Lab", "ZMCC Lab Attendant", "Failed intake test from MOT Journey, Contractor, or Local Supplier OR missing photo", "MPD Head", "Attendant enters Reason for Exception * → Button: 'Confirm & Send to MPD Head' → MPD Head enters Manager Remarks * upon APPROVE / REJECT"),
        ("Stage 3: Dispatch to Plant", "PHE Operator / ZMCC Attendant", "Missing required analysis or test data when preparing chilled road tanker dispatch", "MPD Head", "Operator records Dispatch Remarks / Exception Note → Routed directly to MPD Head for authorization"),
        ("Stage 4: Plant QA Reception Lab", "QAE – Reception Lab", "Failed laboratory test on inbound tanker portion OR missing photo", "Manager – QA Reception Lab (Sole & Final Authority)", "Chemist enters Reason for Exception * → Button: 'Confirm & Send to Manager – QA Reception Lab' → Manager enters Manager Remarks * upon APPROVE / REJECT")
    ]

    for r_idx, row_vals in enumerate(esc_matrix, start=1):
        row = esc_table.rows[r_idx]
        bg_color = "F8FAFC" if r_idx % 2 == 1 else "FFFFFF"
        for c_idx, val in enumerate(row_vals):
            cell = row.cells[c_idx]
            set_cell_background(cell, bg_color)
            set_cell_margins(cell, top=60, bottom=60, left=70, right=70)
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            run = p.add_run(val)
            run.font.name = "Calibri"
            run.font.size = Pt(8)
            run.font.color.rgb = COLOR_DARK
            if c_idx == 0:
                run.font.bold = True
            elif c_idx == 3:
                run.font.bold = True
                run.font.color.rgb = COLOR_PRIMARY

    set_table_borders(esc_table, "CBD5E1", "4")

    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    # -------------------------------------------------------------
    # SECTION 7: GOVERNANCE & SIGN-OFF
    # -------------------------------------------------------------
    h7 = doc.add_paragraph()
    h7.paragraph_format.space_before = Pt(14)
    h7.paragraph_format.space_after = Pt(4)
    r = h7.add_run("7. Policy Governance & Management Sign-Off")
    r.font.name = "Arial"
    r.font.size = Pt(13)
    r.font.bold = True
    r.font.color.rgb = COLOR_PRIMARY

    p_gov = doc.add_paragraph()
    p_gov.paragraph_format.space_after = Pt(8)
    p_gov.paragraph_format.line_spacing = 1.15
    r = p_gov.add_run(
        "• Exclusive Rule Modification Authority: In accordance with SFPL security policies, lab test threshold limits, tolerance margins, and passing options can strictly only be created, modified, or superseded by Super Admin and Data Executive roles.\n"
        "• Auditable Immutability: When a test rule is updated, previous rules are never overwritten; they are version-controlled with effective start/end timestamps to ensure historical inspection batches remain verifiable.\n"
        "• Review Purpose: This document is submitted to the SFPL Milk Procurement Directorate (MPD) and Quality Assurance (QA) Steering Committee for formal operational review, concurrence, and final sign-off."
    )
    r.font.name = "Calibri"
    r.font.size = Pt(9.5)
    r.font.color.rgb = COLOR_DARK

    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    # Sign-off Blocks Table
    sign_table = doc.add_table(rows=3, cols=3)
    sign_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    sign_headers = ["Prepared By", "Reviewed By", "Approved By"]
    
    s_hdr = sign_table.rows[0]
    for c_idx, title in enumerate(sign_headers):
        cell = s_hdr.cells[c_idx]
        set_cell_background(cell, "1E293B")
        set_cell_margins(cell, top=70, bottom=70, left=80, right=80)
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run(title)
        run.font.name = "Arial"
        run.font.size = Pt(9)
        run.font.bold = True
        run.font.color.rgb = RGBColor(255, 255, 255)

    sign_data = [
        ("Designation:", "Lead Software Architect\n& QA Automation Team", "Manager – QA Reception Lab\n& ZMCC Operations", "AVP – QA Reception Lab\n& MPD Head"),
        ("Signature & Date:", "\n_________________________\nDate: ____ / ____ / 2026", "\n_________________________\nDate: ____ / ____ / 2026", "\n_________________________\nDate: ____ / ____ / 2026")
    ]

    for r_idx, (label, col1, col2, col3) in enumerate(sign_data, start=1):
        row = sign_table.rows[r_idx]
        for c_idx, text in enumerate([col1, col2, col3]):
            cell = row.cells[c_idx]
            set_cell_background(cell, "F8FAFC" if r_idx == 1 else "FFFFFF")
            set_cell_margins(cell, top=60, bottom=60, left=80, right=80)
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            run = p.add_run(text)
            run.font.name = "Calibri"
            run.font.size = Pt(8.5)
            run.font.color.rgb = COLOR_DARK

    set_table_borders(sign_table, "CBD5E1", "4")

    # Output path
    output_dir = r"D:\workflow"
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "lab test.docx")
    doc.save(output_path)
    print(f"Document successfully created at: {output_path}")

if __name__ == "__main__":
    create_document()
