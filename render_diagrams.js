const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let PDFDocument;
try {
  ({ PDFDocument } = require('pdf-lib'));
} catch (e) {
  console.error('pdf-lib is not installed. Run: npm install --prefix "C:\\Users\\Raymond\\CascadeProjects\\BudgetApp"');
  process.exit(1);
}

const sourceDir = '\\\\fs1\\Services\\SEP\\Artifacts\\Docs\\process-flows\\processes';
const networkOutputDir = '\\\\fs1\\Services\\SEP\\Artifacts\\Docs\\process-flows\\training';
const localOutputDir = path.join('C:', 'Users', 'Raymond', 'CascadeProjects', 'BudgetApp', 'training-output');
const plantumlJar = 'C:\\Users\\Raymond\\CascadeProjects\\BudgetApp\\plantuml.jar';

let outputDir = localOutputDir;
try {
  fs.mkdirSync(networkOutputDir, { recursive: true });
  outputDir = networkOutputDir;
} catch (e) {
  console.warn(`Network output path not writable, falling back to ${localOutputDir}`);
}

const pumlDir = path.join(outputDir, 'puml');
const pngDir = path.join(outputDir, 'png');
const pdfDir = path.join(outputDir, 'pdf');
const simpleDir = path.join(outputDir, 'simplified-visuals');

for (const d of [pumlDir, pngDir, pdfDir, simpleDir]) {
  fs.mkdirSync(d, { recursive: true });
}

if (!fs.existsSync(plantumlJar)) {
  console.error(`PlantUML JAR not found at ${plantumlJar}`);
  process.exit(1);
}

function plantumlCmd(fmt, outDir, inputPath) {
  return `java -jar "${plantumlJar}" -t${fmt} -o "${outDir}" "${inputPath}"`;
}

function renderPng(outDir, inputPath) {
  const outFile = path.join(outDir, `${path.basename(inputPath, '.puml')}.png`);
  try { fs.unlinkSync(outFile); } catch (e) { /* ignore */ }
  const cmd = plantumlCmd('png', outDir, inputPath);
  try {
    execSync(cmd, { stdio: 'pipe' });
    return outFile;
  } catch (e) {
    console.error(`Failed to render ${inputPath} to png: ${e.message}`);
    if (e.stderr) console.error(e.stderr.toString());
    return null;
  }
}

async function pngToPdf(pngPath, pdfPath) {
  try {
    const pdfDoc = await PDFDocument.create();
    const pngBytes = fs.readFileSync(pngPath);
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([pngImage.width, pngImage.height]);
    page.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pngImage.width,
      height: pngImage.height,
    });
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(pdfPath, pdfBytes);
    return true;
  } catch (e) {
    console.error(`Failed to convert ${pngPath} to pdf: ${e.message}`);
    return false;
  }
}

function removeErrorPaths(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#Pink:/.test(line)) continue;
    if (/^\s*stop\s*$/.test(line)) continue;
    if (/^\s*goto\s+\w+\s*;?\s*$/.test(line)) continue;
    if (/^\s*if\s*\([^)]*(?:error|fail|failed|Error|Fail|Failed)[^)]*\)\s*then\s*\([^)]*\)\s*$/.test(line)) {
      let depth = 1;
      while (i < lines.length - 1 && depth > 0) {
        i++;
        const next = lines[i];
        if (/^\s*if\s*\(/.test(next)) depth++;
        if (/^\s*endif\s*$/.test(next)) { depth--; break; }
        if (/^\s*else\s*\(/.test(next)) { depth--; break; }
      }
      continue;
    }
    if (/^\s*note\s+right\s*$/.test(line)) {
      while (i < lines.length - 1) {
        i++;
        if (/^\s*end\s*note\s*$/.test(lines[i])) break;
      }
      continue;
    }
    if (/^\s*:\s*<<[^>]+>>/.test(line)) continue;
    if (/^\s*\|\s*[^|]+\s*\|\s*$/.test(line)) continue;
    result.push(line);
  }
  return result.join('\n');
}

async function main() {
  const mdFiles = fs.readdirSync(sourceDir)
    .filter(f => f.endsWith('.md') && !f.toLowerCase().startsWith('process-template'))
    .sort();

  for (const mdFile of mdFiles) {
    const content = fs.readFileSync(path.join(sourceDir, mdFile), 'utf8');
    const matches = [...content.matchAll(/```plantuml\s*\n(.*?)\n```/gs)];
    const baseName = path.basename(mdFile, '.md');

    for (let i = 0; i < matches.length; i++) {
      const suffix = matches.length > 1 ? `_${i + 1}` : '';
      const pumlName = `${baseName}${suffix}.puml`;
      const pumlPath = path.join(pumlDir, pumlName);
      const simplePumlPath = path.join(simpleDir, pumlName);

      let diagram = matches[i][1].trim() + '\n';
      fs.writeFileSync(pumlPath, diagram, 'utf8');

      let simplified = removeErrorPaths(diagram);
      simplified = simplified.replace(/\n\s*\n+/g, '\n');
      fs.writeFileSync(simplePumlPath, simplified.trim() + '\n', 'utf8');

      const fullPng = renderPng(pngDir, pumlPath);
      if (fullPng) {
        const pdfPath = path.join(pdfDir, `${baseName}${suffix}.pdf`);
        try { fs.unlinkSync(pdfPath); } catch (e) { /* ignore */ }
        await pngToPdf(fullPng, pdfPath);
      }

      renderPng(simpleDir, simplePumlPath);
    }
  }

  console.log('Diagram extraction and rendering complete.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
