from PIL import Image
import os

src = "RSUPPORT_logo.png"
img = Image.open(src).convert("RGBA")
print("orig size:", img.size, "mode:", img.mode)

ico_sizes = [(16, 16), (32, 32), (48, 48)]

# src/app/favicon.ico (Next.js App Router - highest priority)
img.save("src/app/favicon.ico", format="ICO", sizes=ico_sizes)
print("OK src/app/favicon.ico:", os.path.getsize("src/app/favicon.ico"), "bytes")

# public/favicon.ico (fallback)
img.save("public/favicon.ico", format="ICO", sizes=ico_sizes)
print("OK public/favicon.ico:", os.path.getsize("public/favicon.ico"), "bytes")

# apple-touch-icon 180x180
img_180 = img.resize((180, 180), Image.LANCZOS)
img_180.save("public/apple-touch-icon.png", format="PNG")
print("OK public/apple-touch-icon.png:", os.path.getsize("public/apple-touch-icon.png"), "bytes")

# favicon-32x32.png
img_32 = img.resize((32, 32), Image.LANCZOS)
img_32.save("public/favicon-32x32.png", format="PNG")
print("OK public/favicon-32x32.png:", os.path.getsize("public/favicon-32x32.png"), "bytes")

print("DONE")
