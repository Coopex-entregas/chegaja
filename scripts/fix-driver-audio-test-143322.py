from pathlib import Path

path = Path('scripts/test-v14153-logo-google-maps.mjs')
text = path.read_text(encoding='utf-8')
text = text.replace(
    "chegaja-final\\.js\\?v=14\\.33\\.22&recovery=143322",
    "chegaja-final\\.js\\?v=14\\.33\\.21&recovery=143321",
)
path.write_text(text, encoding='utf-8')
print('Expectativa do chegaja-final.js preservada em 14.33.21.')
