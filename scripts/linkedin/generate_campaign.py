#!/usr/bin/env python3
"""Generate two daily EzProctor LinkedIn infographic posts."""

from __future__ import annotations

import argparse
import json
import textwrap
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
NAVY = "#081629"
PANEL = "#10243d"
PANEL_2 = "#142d4b"
WHITE = "#f7f9fc"
MUTED = "#afbed3"
AMBER = "#ffb323"
CYAN = "#25c5d4"
CORAL = "#ff6267"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default(size=size)


def wrapped(draw: ImageDraw.ImageDraw, text: str, box: tuple[int, int, int, int], text_font: ImageFont.FreeTypeFont, fill: str, spacing: int = 10) -> int:
    x, y, right, _ = box
    average_width = max(1, int(text_font.getlength("ABCDEFGHIJKLMNOPQRSTUVWXYZ") / 26))
    width = max(10, int((right - x) / average_width))
    lines = textwrap.wrap(text, width=width, break_long_words=False)
    line_height = text_font.size + spacing
    for line in lines:
        draw.text((x, y), line, font=text_font, fill=fill)
        y += line_height
    return y


def rounded(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: str, outline: str | None = None, radius: int = 24, width: int = 2) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def render_post(item: dict, post_type: str, output_path: Path) -> dict:
    image = Image.new("RGB", (1200, 1200), NAVY)
    draw = ImageDraw.Draw(image)

    # Subtle technical grid gives the campaign visual depth without reducing readability.
    for coordinate in range(0, 1201, 80):
        draw.line((coordinate, 0, coordinate, 1200), fill="#0d2138", width=1)
        draw.line((0, coordinate, 1200, coordinate), fill="#0d2138", width=1)

    accent = CORAL if post_type == "pain" else CYAN
    label = "EDUCATOR PAIN POINT" if post_type == "pain" else "EZPROCTOR WORKFLOW"
    title = item[f"{post_type}_title"] if post_type == "pain" else item["solution_title"]
    intro = item[f"{post_type}_intro"] if post_type == "pain" else item["solution_intro"]
    points = item[f"{post_type}_points"] if post_type == "pain" else item["solution_points"]

    label_right = 64 + int(draw.textlength(label, font=font(23, True))) + 62
    rounded(draw, (64, 56, label_right, 112), accent, radius=28)
    draw.text((94, 70), label, font=font(23, True), fill=NAVY)
    draw.text((1050, 69), "EP", font=font(25, True), fill=MUTED)

    y = wrapped(draw, title, (64, 164, 1135, 420), font(57, True), WHITE, spacing=8)
    y = wrapped(draw, intro, (64, y + 28, 1100, 520), font(29), MUTED, spacing=8)

    rounded(draw, (64, 555, 1136, 930), PANEL, outline="#365472", radius=32, width=2)
    draw.text((104, 595), "WHAT THIS MEANS" if post_type == "pain" else "HOW IT HELPS", font=font(22, True), fill=AMBER)
    point_y = 660
    for index, point in enumerate(points, start=1):
        circle_color = CORAL if post_type == "pain" else CYAN
        draw.ellipse((104, point_y, 146, point_y + 42), fill=circle_color)
        number_text = str(index)
        number_width = draw.textlength(number_text, font=font(22, True))
        draw.text((125 - number_width / 2, point_y + 7), number_text, font=font(22, True), fill=NAVY)
        wrapped(draw, point, (174, point_y + 3, 1080, point_y + 70), font(30, True), WHITE, spacing=5)
        point_y += 92

    rounded(draw, (64, 965, 1136, 1050), accent, radius=22)
    feature_width = draw.textlength(item["feature"], font=font(28, True))
    draw.text(((1200 - feature_width) / 2, 991), item["feature"], font=font(28, True), fill=NAVY)

    logo = Image.open(ROOT / "assets" / "brand" / "ezproctor-logo.png").convert("RGBA")
    shield = logo.crop((85, 45, 315, 280))
    shield.thumbnail((86, 86), Image.Resampling.LANCZOS)
    image.paste(shield, (64, 1080), shield)
    draw.text((166, 1092), "EzProctor", font=font(28, True), fill=WHITE)
    draw.text((166, 1129), "Secure assessment. Practical coding. Educator control.", font=font(17), fill=MUTED)
    draw.text((918, 1102), "ezproctor.ejoetso.com", font=font(18, True), fill=CYAN)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, "PNG", optimize=True)

    if post_type == "pain":
        commentary = (
            f"{title}\n\n{intro}\n\n"
            + "\n".join(f"• {point}" for point in points)
            + "\n\nAssessment technology should reduce educator administration, not add to it. "
              "EzProctor is being built with educators for secure written and coding assessment.\n\n"
              "Explore the open-source beta: https://ezproctor.ejoetso.com\n\n"
              "#EducationTechnology #Assessment #Educators #DigitalAssessment #EdTech #EzProctor"
        )
    else:
        commentary = (
            f"{title}\n\n{intro}\n\n"
            + "\n".join(f"✓ {point}" for point in points)
            + "\n\nEzProctor keeps assessment evidence organised while the educator remains in control. "
              "Join the beta drill test or explore the open-source project.\n\n"
              "https://ezproctor.ejoetso.com\n"
              "https://github.com/edutech-ET/EzProctor\n\n"
              "#OpenSource #EducationTechnology #CodingAssessment #Teachers #HigherEducation #EzProctor"
        )

    return {
        "type": post_type,
        "theme": item["theme"],
        "image": output_path.name,
        "alt_text": f"EzProctor infographic: {title}",
        "commentary": commentary,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=date.today().isoformat(), help="Campaign date in YYYY-MM-DD format")
    parser.add_argument("--output", default="campaign-output", help="Output directory")
    args = parser.parse_args()

    campaign_date = date.fromisoformat(args.date)
    content = json.loads((Path(__file__).with_name("content.json")).read_text(encoding="utf-8"))
    index = campaign_date.toordinal() % len(content)
    pain_item = content[index]
    solution_item = content[(index + 5) % len(content)]
    output = Path(args.output).resolve()

    posts = [
        render_post(pain_item, "pain", output / "post-1-educator-pain-point.png"),
        render_post(solution_item, "solution", output / "post-2-ezproctor-workflow.png"),
    ]
    manifest = {
        "campaign_date": campaign_date.isoformat(),
        "organization": "urn:li:organization:14490214",
        "posts": posts,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=True), encoding="utf-8")
    print(f"Generated {len(posts)} EzProctor posts in {output}")


if __name__ == "__main__":
    main()
