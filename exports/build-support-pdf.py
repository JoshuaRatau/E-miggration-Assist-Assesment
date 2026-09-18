from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Preformatted
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4

root = Path(__file__).parent
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="TitleCustom", fontName="Helvetica-Bold", fontSize=28, leading=33, textColor=colors.HexColor("#0a1628"), spaceAfter=16))
styles.add(ParagraphStyle(name="SectionCustom", fontName="Helvetica-Bold", fontSize=15, leading=20, textColor=colors.HexColor("#176775"), spaceBefore=17, spaceAfter=9, keepWithNext=True))
styles.add(ParagraphStyle(name="SubCustom", fontName="Helvetica-Bold", fontSize=11, leading=15, spaceBefore=10, spaceAfter=6, keepWithNext=True))
styles.add(ParagraphStyle(name="BodyCustom", fontName="Helvetica", fontSize=10, leading=15, textColor=colors.HexColor("#233344"), spaceAfter=8))
styles.add(ParagraphStyle(name="BulletCustom", parent=styles["BodyCustom"], leftIndent=12, firstLineIndent=-8, spaceAfter=5))
styles.add(ParagraphStyle(name="QuoteCustom", parent=styles["BodyCustom"], leftIndent=12, borderPadding=8, backColor=colors.HexColor("#eef6f7"), spaceBefore=4, spaceAfter=10))
styles.add(ParagraphStyle(name="CodeCustom", fontName="Courier", fontSize=8, leading=11, leftIndent=8, spaceBefore=5, spaceAfter=10, textColor=colors.HexColor("#183343")))

story = []
in_code = False
code = []
for line in (root / "support-centre-implementation-prompt.md").read_text().splitlines():
    if line.startswith("```"):
        if in_code:
            story.append(Preformatted("\n".join(code), styles["CodeCustom"]))
            code = []
        in_code = not in_code
        continue
    if in_code:
        code.append(line)
        continue
    if not line.strip():
        continue
    if line.startswith("# "):
        text, style = line[2:], "TitleCustom"
    elif line.startswith("## "):
        text, style = line[3:], "SectionCustom"
    elif line.startswith("### "):
        text, style = line[4:], "SubCustom"
    elif line.startswith("> "):
        text, style = line[2:], "QuoteCustom"
    elif line.startswith("- "):
        text, style = "\u2022 " + line[2:], "BulletCustom"
    else:
        text, style = line, "BodyCustom"
    story.append(Paragraph(escape(text), styles[style]))

def footer(canvas, doc):
    w, h = A4
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#cee0e5"))
    canvas.line(44, 40, w - 44, 40)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#536575"))
    canvas.drawString(44, 27, "Support Centre | Implementation prompt")
    canvas.drawRightString(w - 44, 27, str(doc.page))
    canvas.restoreState()

doc = SimpleDocTemplate(str(root / "Support-Centre-Implementation-Prompt.pdf"), pagesize=A4, rightMargin=44, leftMargin=44, topMargin=42, bottomMargin=55, title="Support Centre - Implementation Prompt", author="E-Migration Assist")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(root / "Support-Centre-Implementation-Prompt.pdf")