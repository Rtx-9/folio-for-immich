"""Draw fake hockey frames for the sample cards (dev only, needs Pillow).

Reads a JSON list of jobs on stdin. Each job writes one plain JPEG (no metadata)
or raw RGB bytes, with the scene drawn upright and stored rotated like a camera
held in portrait would store it.
"""
import json
import sys

from PIL import Image, ImageDraw, ImageFont


def font(size):
    for name in ("arialbd.ttf", "DejaVuSans-Bold.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def scene(w, h, job):
    # Ice with a cool cast, boards, lines and two players with numbers.
    cast = job.get("cast", [196, 214, 236])
    img = Image.new("RGB", (w, h), tuple(cast))
    d = ImageDraw.Draw(img)
    s = min(w, h)
    d.rectangle([0, 0, w, int(h * 0.22)], fill=(40, 44, 58))  # crowd
    d.rectangle([0, int(h * 0.22), w, int(h * 0.28)], fill=(250, 250, 250))  # boards
    d.rectangle([0, int(h * 0.27), w, int(h * 0.285)], fill=(230, 180, 30))  # kick plate
    d.rectangle([int(w * 0.48), int(h * 0.28), int(w * 0.5), h], fill=(200, 30, 40))  # red line
    d.rectangle([int(w * 0.15), int(h * 0.28), int(w * 0.165), h], fill=(30, 70, 170))
    d.rectangle([int(w * 0.83), int(h * 0.28), int(w * 0.845), h], fill=(30, 70, 170))
    for i, (num, color) in enumerate(job.get("players", [])):
        x = int(w * (0.25 + 0.4 * i))
        y = int(h * 0.45)
        pw, ph = int(s * 0.16), int(s * 0.4)
        d.ellipse([x + pw // 4, y - pw // 2, x + pw * 3 // 4, y], fill=(30, 30, 30))
        d.rectangle([x, y, x + pw, y + ph], fill=tuple(color))
        d.text((x + pw // 2, y + ph // 3), str(num), fill=(255, 255, 255), font=font(int(s * 0.1)), anchor="mm")
    d.text((int(w * 0.03), int(h * 0.92)), job.get("label", ""), fill=(20, 20, 20), font=font(int(s * 0.045)), anchor="ls")
    # A small "up" arrow so orientation mistakes are obvious.
    d.polygon([(w - s * 0.08, h * 0.95), (w - s * 0.05, h * 0.95 - s * 0.08), (w - s * 0.02, h * 0.95)], fill=(220, 20, 20))
    return img


def main():
    for job in json.load(sys.stdin):
        w, h = job["w"], job["h"]
        portrait = job.get("orientation", 1) in (6, 8)
        img = scene(h, w, job) if portrait else scene(w, h, job)
        if job.get("tilt"):
            # A crooked camera: the scene turned counter-clockwise by `tilt` degrees.
            img = img.rotate(job["tilt"], resample=Image.BICUBIC, expand=False, fillcolor=(20, 20, 25))
        if job.get("orientation") == 6:
            img = img.rotate(90, expand=True)  # stored = upright turned left
        elif job.get("orientation") == 8:
            img = img.rotate(-90, expand=True)
        img = img.resize((w, h), Image.BILINEAR) if img.size != (w, h) else img
        if job.get("rgb"):
            with open(job["out"], "wb") as f:
                f.write(img.tobytes())
        else:
            img.save(job["out"], "JPEG", quality=job.get("quality", 85), subsampling=2)


if __name__ == "__main__":
    main()
