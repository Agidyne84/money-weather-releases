import os
import re
import subprocess
import sys

# Paths
SOURCE_DIR = r"\\fs1\Services\SEP\Artifacts\Docs\process-flows\processes"
OUTPUT_DIR = r"\\fs1\Services\SEP\Artifacts\Docs\process-flows\training"
PUML_DIR = os.path.join(OUTPUT_DIR, "puml")
PNG_DIR = os.path.join(OUTPUT_DIR, "png")
PDF_DIR = os.path.join(OUTPUT_DIR, "pdf")
SIMPLE_PUML_DIR = os.path.join(OUTPUT_DIR, "simplified-visuals")

for d in [PUML_DIR, PNG_DIR, PDF_DIR, SIMPLE_PUML_DIR]:
    os.makedirs(d, exist_ok=True)

# Simplification patterns
ERROR_PATTERNS = [
    re.compile(r'^\s*#Pink:.*$', re.MULTILINE),
    re.compile(r'^\s*if\s*\([^)]*(?:error|fail|failed|Error|Fail|Failed)[^)]*\)\s*then\s*\([^)]*\)\s*\n(?:.*?\n)*?\s*else\s*\([^)]*\)\s*\n', re.MULTILINE | re.IGNORECASE | re.DOTALL),
    re.compile(r'^\s*if\s*\([^)]*(?:error|fail|failed|Error|Fail|Failed)[^)]*\)\s*then\s*\([^)]*\)\s*\n(?:.*?\n)*?\s*endif\s*\n', re.MULTILINE | re.IGNORECASE | re.DOTALL),
    re.compile(r'^\s*goto\s+\w+\s*;?\s*$', re.MULTILINE | re.IGNORECASE),
    re.compile(r'^\s*stop\s*$', re.MULTILINE | re.IGNORECASE),
]

# Find all markdown files
md_files = sorted([f for f in os.listdir(SOURCE_DIR) if f.endswith('.md')])

for md_file in md_files:
    path = os.path.join(SOURCE_DIR, md_file)
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find all plantuml blocks
    diagrams = re.findall(r'```plantuml\s*\n(.*?)\n```', content, re.DOTALL)

    base_name = os.path.splitext(md_file)[0]

    for i, diagram in enumerate(diagrams, start=1):
        suffix = f"_{i}" if len(diagrams) > 1 else ""
        puml_name = f"{base_name}{suffix}.puml"
        puml_path = os.path.join(PUML_DIR, puml_name)
        simple_puml_path = os.path.join(SIMPLE_PUML_DIR, puml_name)

        with open(puml_path, 'w', encoding='utf-8') as f:
            f.write(diagram.strip() + '\n')

        # Create simplified version
        simplified = diagram
        for pattern in ERROR_PATTERNS:
            simplified = pattern.sub('', simplified)

        # Remove some technical details
        simplified = re.sub(r'^\s*note\s+right\s*\n(?:.*?\n)*?\s*end\s*note\s*$', '', simplified, flags=re.MULTILINE | re.DOTALL)
        simplified = re.sub(r'^\s*:\s*<<[^>]+>>\s*[^;]*;\s*$', '', simplified, flags=re.MULTILINE)
        simplified = re.sub(r'^\s*\|\s*[^|]+\s*\|\s*\n', '', simplified, flags=re.MULTILINE)
        simplified = re.sub(r'\n\s*\n+', '\n', simplified)

        with open(simple_puml_path, 'w', encoding='utf-8') as f:
            f.write(simplified.strip() + '\n')

        # Render PNG and PDF
        for fmt, out_dir in [('png', PNG_DIR), ('pdf', PDF_DIR)]:
            out_file = os.path.join(out_dir, f"{base_name}{suffix}.{fmt}")
            cmd = ['plantuml', f'-t{fmt}', '-o', out_dir, puml_path]
            subprocess.run(cmd, check=False, capture_output=True)

        # Render simplified PNG
        simple_out = os.path.join(SIMPLE_PUML_DIR, f"{base_name}{suffix}.png")
        cmd = ['plantuml', '-tpng', '-o', SIMPLE_PUML_DIR, simple_puml_path]
        subprocess.run(cmd, check=False, capture_output=True)

print("Diagram extraction and rendering complete.")
