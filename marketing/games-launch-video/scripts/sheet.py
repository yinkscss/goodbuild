"""Contact sheet of out/still-*.png (dev helper)."""
import sys, glob
from PIL import Image, ImageDraw
files = sys.argv[1:]
ims = [Image.open(f) for f in files]
w, h = ims[0].size
cols = min(4, len(ims))
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (w + 10), rows * (h + 10)), "#777")
for k, (f, im) in enumerate(zip(files, ims)):
    x, y = (k % cols) * (w + 10), (k // cols) * (h + 10)
    sheet.paste(im, (x, y))
    d = ImageDraw.Draw(sheet)
    # safe-area guide
    d.rectangle([x + w * .08, y + h * .12, x + w * .92, y + h * .88], outline="#00ffff")
    d.text((x + 6, y + 6), f.split("still-")[-1], fill="#ff0")
sheet.save("out/sheet.png")
