"""Read exported JPEGs (and sample NEFs) with Pillow, independently of RinkSide,
and print what a wire service or Lightroom would see, as JSON.

    python dev/rinkside/check_metadata.py <file-or-folder> [...]
"""
import json
import os
import sys
import xml.etree.ElementTree as ET

from PIL import ExifTags, Image, ImageStat, IptcImagePlugin

NS = {
    "x": "adobe:ns:meta/",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "dc": "http://purl.org/dc/elements/1.1/",
    "photoshop": "http://ns.adobe.com/photoshop/1.0/",
    "xmp": "http://ns.adobe.com/xap/1.0/",
    "Iptc4xmpCore": "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/",
    "Iptc4xmpExt": "http://iptc.org/std/Iptc4xmpExt/2008-02-29/",
    "lr": "http://ns.adobe.com/lightroom/1.0/",
}
IPTC_NAMES = {(2, 5): "ObjectName", (2, 25): "Keywords", (2, 55): "DateCreated", (2, 60): "TimeCreated", (2, 80): "By-line", (2, 90): "City", (2, 92): "Sub-location", (2, 101): "Country", (2, 105): "Headline", (2, 110): "Credit", (2, 116): "CopyrightNotice", (2, 120): "Caption-Abstract", (1, 90): "CodedCharacterSet"}


def xmp_fields(raw):
    root = ET.fromstring(raw)
    out = {}
    for desc in root.iter(f"{{{NS['rdf']}}}Description"):
        for k, v in desc.attrib.items():
            for p, uri in NS.items():
                if k.startswith(f"{{{uri}}}"):
                    out[f"{p}:{k.split('}')[1]}"] = v
        for child in desc:
            tag = child.tag
            for p, uri in NS.items():
                if tag.startswith(f"{{{uri}}}"):
                    tag = f"{p}:{tag.split('}')[1]}"
            items = [li.text for li in child.iter(f"{{{NS['rdf']}}}li")]
            out[tag] = items if len(items) != 1 else items[0]
    return out


def check(path):
    info = {"file": os.path.basename(path)}
    with Image.open(path) as im:
        info["format"] = im.format
        info["size"] = list(im.size)
        exif = im.getexif()
        named = {ExifTags.TAGS.get(k, hex(k)): v for k, v in exif.items()}
        sub = exif.get_ifd(0x8769)
        named.update({ExifTags.TAGS.get(k, hex(k)): v for k, v in sub.items()})
        keep = ["Make", "Model", "Orientation", "Software", "ImageDescription", "Artist", "Copyright", "DateTimeOriginal", "SubsecTimeOriginal", "OffsetTimeOriginal", "ExposureTime", "FNumber", "ISOSpeedRatings", "FocalLength", "LensModel", "ExifImageWidth", "ExifImageHeight", "BodySerialNumber"]
        info["exif"] = {k: (float(named[k]) if hasattr(named[k], "numerator") and not isinstance(named[k], int) else named[k]) for k in keep if k in named}
        info["makernote"] = 0x927C in sub
        if im.format == "JPEG":
            iptc = IptcImagePlugin.getiptcinfo(im) or {}
            out = {}
            for key, val in iptc.items():
                name = IPTC_NAMES.get(key, str(key))
                vals = val if isinstance(val, list) else [val]
                vals = [v.decode("utf-8", "replace") for v in vals]
                out[name] = vals if name == "Keywords" else vals[0]
            info["iptc"] = out
            raw = im.info.get("xmp")
            info["xmp"] = xmp_fields(raw) if raw else None
            info["mean"] = [round(v, 1) for v in ImageStat.Stat(im.convert("RGB")).mean]
            # Top rows are the crowd in the samples: dark if the photo is upright.
            top = im.convert("L").crop((0, 0, im.size[0], max(1, im.size[1] // 20)))
            info["top_brightness"] = round(ImageStat.Stat(top).mean[0], 1)
        elif im.format in ("TIFF",):
            info["tiff_thumbnail"] = list(im.size)
    return info


def main():
    files = []
    for arg in sys.argv[1:]:
        if os.path.isdir(arg):
            files += [os.path.join(arg, f) for f in sorted(os.listdir(arg)) if f.lower().endswith((".jpg", ".jpeg", ".nef"))]
        else:
            files.append(arg)
    print(json.dumps([check(f) for f in files], default=str))


if __name__ == "__main__":
    main()
