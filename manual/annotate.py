#!/usr/bin/env python3
"""Annotate AIMS screenshots with red highlights, arrows, and numbered badges.

Usage:
  python3 annotate.py <input.png> <output.png> '<json-spec>'

JSON spec: {"annotations": [ ... ]}, each annotation one of:
  {"kind":"highlight","x":..,"y":..,"w":..,"h":..,"pad":8}     # rounded-rect outline around a box
  {"kind":"arrow","x":..,"y":..,"w":..,"h":..,"from":"bottom","len":110}  # arrow pointing AT box from a side
  {"kind":"badge","x":..,"y":..,"n":1}                          # numbered circle centered at (x,y)
  {"kind":"label","x":..,"y":..,"text":"...","anchor":"lt"}     # text caption

Coordinates are CSS/screenshot pixels (1:1 at DPR=1).
"""
import sys, json, math
from PIL import Image, ImageDraw, ImageFont

RED = (224, 49, 49)
WHITE = (255, 255, 255)
STROKE = 4

def font(size, bold=True):
    paths = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()

def rounded_rect(draw, box, radius, outline, width):
    draw.rounded_rectangle(box, radius=radius, outline=outline, width=width)

def arrow(draw, start, end, color=RED, width=STROKE+1):
    draw.line([start, end], fill=color, width=width)
    # arrowhead
    ang = math.atan2(end[1]-start[1], end[0]-start[0])
    L = 18
    for da in (math.radians(28), -math.radians(28)):
        x = end[0] - L*math.cos(ang+da)
        y = end[1] - L*math.sin(ang+da)
        draw.line([end, (x, y)], fill=color, width=width)

def center(a):
    return (a["x"]+a["w"]/2, a["y"]+a["h"]/2)

def main():
    inp, outp, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
    img = Image.open(inp).convert("RGB")
    d = ImageDraw.Draw(img)
    for a in spec["annotations"]:
        k = a["kind"]
        if k == "highlight":
            pad = a.get("pad", 8)
            rounded_rect(d, [a["x"]-pad, a["y"]-pad, a["x"]+a["w"]+pad, a["y"]+a["h"]+pad],
                         a.get("radius", 10), RED, a.get("width", STROKE))
        elif k == "arrow":
            cx, cy = center(a)
            side = a.get("from", "bottom"); L = a.get("len", 110); pad = a.get("pad", 10)
            if side == "bottom":
                end = (cx, a["y"]+a["h"]+pad); start = (cx, end[1]+L)
            elif side == "top":
                end = (cx, a["y"]-pad); start = (cx, end[1]-L)
            elif side == "left":
                end = (a["x"]-pad, cy); start = (end[0]-L, cy)
            else:  # right
                end = (a["x"]+a["w"]+pad, cy); start = (end[0]+L, cy)
            arrow(d, start, end)
        elif k == "badge":
            r = a.get("r", 18); x, y = a["x"], a["y"]
            d.ellipse([x-r, y-r, x+r, y+r], fill=RED, outline=WHITE, width=2)
            f = font(int(r*1.2))
            t = str(a["n"]); tb = d.textbbox((0,0), t, font=f)
            d.text((x-(tb[2]-tb[0])/2, y-(tb[3]-tb[1])/2-tb[1]), t, fill=WHITE, font=f)
        elif k == "label":
            f = font(a.get("size", 22))
            d.text((a["x"], a["y"]), a["text"], fill=a.get("color", RED), font=f)
    img.save(outp)
    print(f"wrote {outp} ({img.width}x{img.height})")

if __name__ == "__main__":
    main()
