import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

async function extractViaExistingBrowser() {
  console.log("Connecting to existing Chrome session...");

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const contexts = browser.contexts();

  if (contexts.length === 0) {
    console.log("No browser contexts found. Make sure Chrome is open.");
    await browser.close();
    return;
  }

  // Find the Linear tab
  let linearPage = null;
  for (const context of contexts) {
    for (const page of context.pages()) {
      const url = page.url();
      if (url.includes("linear.app")) {
        linearPage = page;
        console.log(`Found Linear tab: ${url}`);
        break;
      }
    }
    if (linearPage) break;
  }

  if (!linearPage) {
    console.log("No Linear tab found. Open linear.app in Chrome first, then rerun.");
    // List all open tabs
    for (const context of contexts) {
      for (const page of context.pages()) {
        console.log(`  Tab: ${page.url()}`);
      }
    }
    await browser.close();
    return;
  }

  const outputDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outputDir, { recursive: true });

  // Screenshot
  console.log("Taking screenshot...");
  await linearPage.screenshot({ path: path.join(outputDir, "linear-app-actual.png"), fullPage: false });

  // Extract everything
  console.log("Extracting all styles...");
  const styles = await linearPage.evaluate(() => {
    const result: Record<string, any> = {};

    // 1. ALL CSS custom properties from all stylesheets
    const cssVars: Record<string, string> = {};
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          const text = rule.cssText;
          const varMatches = text.matchAll(/--([\w-]+)\s*:\s*([^;]+)/g);
          for (const match of varMatches) {
            cssVars[`--${match[1]}`] = match[2].trim();
          }
        }
      } catch (e) {}
    }
    result.cssVariables = cssVars;

    // 2. ALL computed root variables
    const rootStyles = getComputedStyle(document.documentElement);
    const rootVars: Record<string, string> = {};
    for (let i = 0; i < rootStyles.length; i++) {
      const prop = rootStyles[i];
      if (prop.startsWith("--")) {
        rootVars[prop] = rootStyles.getPropertyValue(prop).trim();
      }
    }
    result.rootVariables = rootVars;

    // 3. Full raw CSS
    const allCSS: string[] = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          allCSS.push(rule.cssText);
        }
      } catch (e) {}
    }
    result.rawCSSRuleCount = allCSS.length;

    // 4. Comprehensive element sampling
    const propsToExtract = [
      "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
      "text-transform", "color", "background-color", "background",
      "border", "border-width", "border-style", "border-color", "border-radius",
      "box-shadow", "text-shadow", "outline",
      "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
      "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
      "gap", "row-gap", "column-gap",
      "width", "height", "min-width", "min-height", "max-width",
      "display", "flex-direction", "align-items", "justify-content",
      "opacity", "backdrop-filter", "transition", "cursor",
    ];

    const appSelectors = [
      "button", "[role='button']", "a", "input", "textarea", "select",
      "nav", "nav a", "nav button", "aside", "main", "header",
      "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "label",
      "table", "tr", "td", "th",
      "[role='tab']", "[role='tablist']", "[role='menu']", "[role='menuitem']",
      "[role='dialog']", "[role='switch']", "[role='checkbox']", "[role='option']",
      "[role='listbox']", "[role='toolbar']", "[role='tooltip']",
      "[class*='sidebar']", "[class*='Sidebar']",
      "[class*='issue']", "[class*='Issue']",
      "[class*='badge']", "[class*='Badge']",
      "[class*='status']", "[class*='Status']",
      "[class*='priority']", "[class*='Priority']",
      "[class*='avatar']", "[class*='Avatar']",
      "[class*='menu']", "[class*='Menu']",
      "[class*='modal']", "[class*='Modal']",
      "[class*='panel']", "[class*='Panel']",
      "[class*='card']", "[class*='Card']",
      "[class*='filter']", "[class*='Filter']",
      "[class*='toggle']", "[class*='Toggle']",
      "[class*='tab']", "[class*='Tab']",
      "[class*='button']", "[class*='Button']",
      "[class*='input']", "[class*='Input']",
      "[class*='dropdown']", "[class*='Dropdown']",
      "[class*='tooltip']", "[class*='Tooltip']",
      "[class*='divider']", "[class*='Divider']",
      "[class*='header']", "[class*='Header']",
      "[class*='title']", "[class*='Title']",
      "[class*='icon']", "[class*='Icon']",
      "[class*='label']", "[class*='Label']",
      "[class*='tag']", "[class*='Tag']",
      "svg",
    ];

    const elementStyles: Record<string, any[]> = {};
    for (const selector of appSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) continue;
        const samples: any[] = [];
        const limit = Math.min(elements.length, 10);
        for (let i = 0; i < limit; i++) {
          const el = elements[i] as HTMLElement;
          const computed = getComputedStyle(el);
          const extractedStyles: Record<string, string> = {};
          for (const prop of propsToExtract) {
            const val = computed.getPropertyValue(prop).trim();
            if (val && val !== "none" && val !== "normal" && val !== "auto" &&
                val !== "0px" && val !== "rgba(0, 0, 0, 0)" && val !== "transparent" &&
                val !== "0s" && val !== "0" && val !== "visible" && val !== "static") {
              extractedStyles[prop] = val;
            }
          }
          if (Object.keys(extractedStyles).length > 2) {
            samples.push({
              tag: el.tagName.toLowerCase(),
              classes: (typeof el.className === 'string' ? el.className : '').slice(0, 200),
              role: el.getAttribute("role") || undefined,
              text: (el.textContent || "").trim().slice(0, 60) || undefined,
              styles: extractedStyles,
            });
          }
        }
        if (samples.length > 0) elementStyles[selector] = samples;
      } catch (e) {}
    }
    result.elementStyles = elementStyles;

    // 5. Unique values across ALL elements
    const props2 = ['color','background-color','border-color','font-family','font-size',
      'font-weight','line-height','letter-spacing','border-radius','box-shadow',
      'padding','gap','opacity','transition'];
    const uniques: Record<string, Set<string>> = {};
    props2.forEach(p => uniques[p] = new Set());
    const allEls = document.querySelectorAll('*');
    for (let i = 0; i < Math.min(allEls.length, 3000); i++) {
      const c = getComputedStyle(allEls[i]);
      props2.forEach(p => {
        const v = c.getPropertyValue(p).trim();
        if (v && v !== 'none' && v !== 'normal' && v !== 'rgba(0, 0, 0, 0)' &&
            v !== '0px' && v !== 'transparent' && v !== '0s' && v !== '400') {
          uniques[p].add(v);
        }
      });
    }
    result.uniqueValues = {};
    for (const [k, s] of Object.entries(uniques)) result.uniqueValues[k] = [...s];

    return result;
  });

  // Save raw CSS separately
  console.log("Extracting raw CSS...");
  const rawCSS = await linearPage.evaluate(() => {
    const allCSS: string[] = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) allCSS.push(rule.cssText);
      } catch (e) {}
    }
    return allCSS.join("\n\n");
  });

  // Write files
  fs.writeFileSync(path.join(outputDir, "linear-app-tokens.json"), JSON.stringify(styles, null, 2));
  fs.writeFileSync(path.join(outputDir, "linear-app-raw.css"), rawCSS);

  // Generate readable summary
  let md = `# Linear App Design Tokens\n\nExtracted from live app on ${new Date().toISOString().split("T")[0]}\n\n`;

  md += `## CSS Custom Properties (${Object.keys(styles.cssVariables).length})\n\n`;
  for (const [k, v] of Object.entries(styles.cssVariables).sort(([a], [b]) => (a as string).localeCompare(b as string))) {
    md += `\`${k}\`: \`${v}\`\n`;
  }

  md += `\n## Root Variables (${Object.keys(styles.rootVariables).length})\n\n`;
  for (const [k, v] of Object.entries(styles.rootVariables).sort(([a], [b]) => (a as string).localeCompare(b as string))) {
    md += `\`${k}\`: \`${v}\`\n`;
  }

  md += `\n## Typography\n\n`;
  md += `### Font Families\n`;
  for (const f of styles.uniqueValues['font-family'] || []) md += `- \`${f}\`\n`;
  md += `\n### Font Sizes\n`;
  for (const s of (styles.uniqueValues['font-size'] || []).sort((a: string, b: string) => parseFloat(a) - parseFloat(b))) md += `- \`${s}\`\n`;
  md += `\n### Font Weights\n`;
  for (const w of styles.uniqueValues['font-weight'] || []) md += `- \`${w}\`\n`;
  md += `\n### Line Heights\n`;
  for (const l of styles.uniqueValues['line-height'] || []) md += `- \`${l}\`\n`;
  md += `\n### Letter Spacings\n`;
  for (const l of styles.uniqueValues['letter-spacing'] || []) md += `- \`${l}\`\n`;

  md += `\n## Colors\n\n### Text\n`;
  for (const c of styles.uniqueValues['color'] || []) md += `- \`${c}\`\n`;
  md += `\n### Backgrounds\n`;
  for (const c of styles.uniqueValues['background-color'] || []) md += `- \`${c}\`\n`;
  md += `\n### Borders\n`;
  for (const c of styles.uniqueValues['border-color'] || []) md += `- \`${c}\`\n`;

  md += `\n## Border Radii\n`;
  for (const r of styles.uniqueValues['border-radius'] || []) md += `- \`${r}\`\n`;
  md += `\n## Box Shadows\n`;
  for (const s of styles.uniqueValues['box-shadow'] || []) md += `- \`${s}\`\n`;
  md += `\n## Gaps\n`;
  for (const g of styles.uniqueValues['gap'] || []) md += `- \`${g}\`\n`;
  md += `\n## Paddings\n`;
  for (const p of (styles.uniqueValues['padding'] || []).slice(0, 40)) md += `- \`${p}\`\n`;
  md += `\n## Transitions\n`;
  for (const t of (styles.uniqueValues['transition'] || []).slice(0, 30)) md += `- \`${t}\`\n`;

  md += `\n## Component Styles\n\n`;
  for (const [selector, samples] of Object.entries(styles.elementStyles)) {
    md += `### \`${selector}\` (${(samples as any[]).length} samples)\n\n`;
    for (const sample of samples as any[]) {
      md += `**<${sample.tag}>** ${sample.role ? `role="${sample.role}"` : ""} ${sample.text ? `"${sample.text}"` : ""}\n`;
      if (sample.classes) md += `classes: \`${sample.classes}\`\n`;
      for (const [prop, val] of Object.entries(sample.styles)) {
        md += `  ${prop}: \`${val}\`\n`;
      }
      md += `\n`;
    }
  }

  fs.writeFileSync(path.join(outputDir, "linear-app-reference.md"), md);

  console.log(`\nExtraction complete!`);
  console.log(`  CSS variables: ${Object.keys(styles.cssVariables).length}`);
  console.log(`  Root variables: ${Object.keys(styles.rootVariables).length}`);
  console.log(`  Element selectors: ${Object.keys(styles.elementStyles).length}`);
  console.log(`  Unique text colors: ${styles.uniqueValues?.color?.length || 0}`);
  console.log(`  Unique bg colors: ${styles.uniqueValues?.['background-color']?.length || 0}`);
  console.log(`  Font sizes: ${styles.uniqueValues?.['font-size']?.length || 0}`);
  console.log(`  Border radii: ${styles.uniqueValues?.['border-radius']?.length || 0}`);
  console.log(`  Box shadows: ${styles.uniqueValues?.['box-shadow']?.length || 0}`);
  console.log(`  Raw CSS rules: ${styles.rawCSSRuleCount}`);
  console.log(`\nFiles saved to output/`);

  // Don't close browser - it's the user's Chrome!
}

extractViaExistingBrowser().catch(console.error);
