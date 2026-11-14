"""Generate the extension icons (icons/icon{16,32,48,128}.png) and the
Chrome Web Store promo tiles in store/. Requires Pillow: pip install pillow"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024  # master size


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def gradient(size, c1, c2):
    w, h = size
    img = Image.new("RGBA", size)
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / w * 0.55 + y / h * 0.45)
            px[x, y] = lerp(c1, c2, t) + (255,)
    return img


def curve_points(x0, y0, x1, y1, n=200, db=34):
    k = 10 ** (db / 20)
    pts = []
    for i in range(n + 1):
        p = i / n
        g = (k ** p - 1) / (k - 1)
        pts.append((x0 + (x1 - x0) * p, y0 - (y0 - y1) * g))
    return pts


def master_icon():
    grad = gradient((256, 256), (255, 78, 69), (255, 150, 72)).resize((S, S), Image.BICUBIC)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((40, 40, S - 40, S - 40), radius=230, fill=255)
    icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    icon.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(icon)
    # curve
    pts = curve_points(215, 660, 810, 215)
    dense = curve_points(215, 660, 810, 215, n=1600)
    for p in dense:
        d.ellipse((p[0] - 32, p[1] - 32, p[0] + 32, p[1] + 32), fill=(255, 255, 255, 255))
    # slider
    d.rounded_rectangle((215, 775, 810, 815), radius=20, fill=(255, 255, 255, 110))
    d.rounded_rectangle((215, 775, 600, 815), radius=20, fill=(255, 255, 255, 255))
    d.ellipse((600 - 62, 795 - 62, 600 + 62, 795 + 62), fill=(255, 255, 255, 255))
    d.ellipse((600 - 30, 795 - 30, 600 + 30, 795 + 30), fill=(255, 110, 70, 255))
    return icon


def save_icons(icon):
    os.makedirs(os.path.join(ROOT, "icons"), exist_ok=True)
    icon.save(os.path.join(ROOT, "icons", "icon-1024.png"))
    for size in (16, 32, 48, 128):
        im = icon.resize((size, size), Image.LANCZOS)
        if size <= 32:
            im = im.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=0))
        im.save(os.path.join(ROOT, "icons", f"icon{size}.png"))


def font(size, bold=True):
    for name in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
    ):
        if os.path.exists(name):
            return ImageFont.truetype(name, size)
    return ImageFont.load_default()


def promo(icon, w, h, path, title_size, sub_size):
    bg = gradient((w // 4, h // 4), (28, 22, 40), (12, 12, 16)).resize((w, h), Image.BICUBIC)
    d = ImageDraw.Draw(bg)
    isz = int(h * 0.52)
    bg.paste(icon.resize((isz, isz), Image.LANCZOS), (int(h * 0.16), (h - isz) // 2), icon.resize((isz, isz), Image.LANCZOS))
    tx = int(h * 0.16) + isz + int(h * 0.1)
    d.text((tx, h * 0.33), "Volume Curve", font=font(title_size), fill=(255, 255, 255))
    d.text((tx, h * 0.33 + title_size * 1.15), "Slider", font=font(title_size), fill=(255, 140, 92))
    d.text((tx, h * 0.33 + title_size * 2.45), "Custom volume curves for YouTube", font=font(sub_size, False), fill=(200, 200, 210))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bg.convert("RGB").save(path)


if __name__ == "__main__":
    ic = master_icon()
    save_icons(ic)
    promo(ic, 440, 280, os.path.join(ROOT, "store", "promo-small-440x280.png"), 25, 12)
    promo(ic, 1400, 560, os.path.join(ROOT, "store", "promo-marquee-1400x560.png"), 74, 30)
    print("icons + promo tiles written")
