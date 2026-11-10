"""Recolor fixed error artwork without changing geometry. Requires Pillow.

Run from any directory: python frontend/scripts/generate-error-themes.py
Only the green clothing/object palette changes; skin, cream equipment and alpha stay fixed.
"""
import colorsys
from pathlib import Path

from PIL import Image

FRONTEND = Path(__file__).resolve().parents[1]
CODES = (403, 404, 500, 502, 503, 504, 505)
THEMES = ("green", "peach", "black", "discord")


def recolor(pixel, theme):
    red, green, blue, alpha = pixel
    hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
    # Warm skin/hair and ivory equipment fall outside this green-only range.
    if not alpha or saturation < 0.065 or not 0.18 <= hue <= 0.52 or theme == "green":
        return pixel
    if theme == "black":
        gray = round(red * 0.2126 + green * 0.7152 + blue * 0.0722)
        return gray, gray, gray, alpha
    target_hue = 30 / 360 if theme == "peach" else 240 / 360
    target_saturation = min(0.65, saturation * 1.1 + (0.15 if theme == "peach" else 0.12))
    channels = colorsys.hsv_to_rgb(target_hue, target_saturation, value)
    return *(round(channel * 255) for channel in channels), alpha


def main():
    destination = FRONTEND / "public" / "illustrations" / "themes"
    destination.mkdir(parents=True, exist_ok=True)
    for code in CODES:
        source_name = "error-connection-source.png" if code == 502 else f"error-{code}-source.png"
        image = Image.open(FRONTEND / "assets" / "branding" / source_name).convert("RGBA")
        image.thumbnail((800, 600), Image.Resampling.LANCZOS)
        pixels = list(getattr(image, "get_flattened_data", image.getdata)())
        for theme in THEMES:
            variant = Image.new("RGBA", image.size)
            variant.putdata([recolor(pixel, theme) for pixel in pixels])
            output = destination / f"{theme}-error-{code}.webp"
            variant.save(output, "WEBP", lossless=True, exact=True, method=6)
            # Independently verify that encoding did not alter silhouette or dimensions.
            decoded = Image.open(output).convert("RGBA")
            assert decoded.size == image.size, output
            assert decoded.getchannel("A").tobytes() == image.getchannel("A").tobytes(), output
        print(f"{code}: same geometry and alpha in all four themes")


if __name__ == "__main__":
    main()
