import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

async function extractAppStyles() {
  const browser = await chromium.launch({ headless: false }); // Visible browser
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto("https://linear.app/login");

  console.log("\n========================================");
  console.log("  LOG INTO LINEAR IN THE BROWSER WINDOW");
  console.log("  Once you're in the app, press Enter here");
  console.log("========================================\n");

  // Wait for user to log in and press enter
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  console.log("Waiting for app to fully load...");
  await page.waitForTimeout(3000);

  // Take screenshots of different views
  const outputDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outputDir, { recursive: true });

  console.log("Taking screenshots...");
  await page.screenshot({ path: path.join(outputDir, "linear-app-main.png"), fullPage: false });

  // Extract ALL styles from the actual app
  console.log("Extracting styles from the app...");
  const styles = await page.evaluate(() => {
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

    // 3. Extract FULL stylesheets as raw CSS text
    const rawCSS: string[] = [];
    for (const sheet of document.styleSheets) {
      try {
        const rules: string[] = [];
        for (const rule of sheet.cssRules) {
          rules.push(rule.cssText);
        }
        if (rules.length > 0) {
          rawCSS.push(rules.join("\n\n"));
        }
      } catch (e) {}
    }
    result.rawCSSRuleCount = rawCSS.reduce((sum, css) => sum + css.split("\n\n").length, 0);

    // 4. Comprehensive element sampling - find EVERY unique component type
    const propsToExtract = [
      "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
      "text-transform", "color", "background-color", "background",
      "border", "border-width", "border-style", "border-color", "border-radius",
      "box-shadow", "text-shadow", "outline",
      "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
      "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
      "gap", "row-gap", "column-gap",
      "width", "height", "min-width", "min-height", "max-width", "max-height",
      "display", "flex-direction", "align-items", "justify-content", "flex-wrap",
      "position", "top", "right", "bottom", "left",
      "opacity", "backdrop-filter", "filter", "mix-blend-mode",
      "transition", "animation", "transform",
      "cursor", "user-select", "pointer-events",
      "overflow", "overflow-x", "overflow-y",
      "z-index",
    ];

    // App-specific selectors - target Linear's actual UI components
    const appSelectors = [
      // Sidebar
      "[class*='sidebar']", "[class*='Sidebar']", "[data-testid*='sidebar']",
      "nav", "nav a", "nav button",
      // Main content area
      "main", "[class*='content']", "[class*='Content']",
      // Issue list / table rows
      "[class*='issue']", "[class*='Issue']", "[class*='row']", "[class*='Row']",
      "tr", "td", "th", "table",
      // Buttons
      "button", "[role='button']", "a[class*='button']", "a[class*='Button']",
      // Inputs
      "input", "textarea", "select", "[contenteditable]",
      "[class*='input']", "[class*='Input']",
      // Dropdowns/menus
      "[class*='menu']", "[class*='Menu']", "[class*='dropdown']", "[class*='Dropdown']",
      "[role='menu']", "[role='menuitem']", "[role='listbox']", "[role='option']",
      // Badges/labels/tags
      "[class*='badge']", "[class*='Badge']", "[class*='label']", "[class*='Label']",
      "[class*='tag']", "[class*='Tag']", "[class*='status']", "[class*='Status']",
      "[class*='priority']", "[class*='Priority']",
      // Cards/panels
      "[class*='card']", "[class*='Card']", "[class*='panel']", "[class*='Panel']",
      // Headers
      "h1", "h2", "h3", "h4", "h5", "h6",
      "[class*='header']", "[class*='Header']", "[class*='title']", "[class*='Title']",
      // Text
      "p", "span", "label", "[class*='text']", "[class*='Text']",
      "[class*='description']", "[class*='Description']",
      // Icons
      "svg", "[class*='icon']", "[class*='Icon']",
      // Tabs
      "[role='tab']", "[role='tablist']", "[class*='tab']", "[class*='Tab']",
      // Tooltips
      "[class*='tooltip']", "[class*='Tooltip']", "[role='tooltip']",
      // Avatars
      "[class*='avatar']", "[class*='Avatar']", "img[class*='avatar']",
      // Dividers
      "hr", "[class*='divider']", "[class*='Divider']", "[class*='separator']",
      // Scrollbars
      "[class*='scroll']", "[class*='Scroll']",
      // Command palette / modals
      "[class*='modal']", "[class*='Modal']", "[class*='dialog']", "[class*='Dialog']",
      "[role='dialog']", "[class*='command']", "[class*='Command']",
      // Filters
      "[class*='filter']", "[class*='Filter']",
      // Breadcrumbs
      "[class*='breadcrumb']", "[class*='Breadcrumb']",
      // Progress
      "[class*='progress']", "[class*='Progress']",
      // Toggle/switch
      "[class*='toggle']", "[class*='Toggle']", "[class*='switch']", "[class*='Switch']",
      "[role='switch']",
      // Checkbox/radio
      "[class*='checkbox']", "[class*='Checkbox']", "[role='checkbox']",
      // Generic interactive
      "[class*='hover']", "[class*='active']", "[class*='focus']",
      // Layout containers
      "[class*='container']", "[class*='Container']",
      "[class*='layout']", "[class*='Layout']",
      "[class*='wrapper']", "[class*='Wrapper']",
    ];

    const elementStyles: Record<string, any[]> = {};

    for (const selector of appSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) continue;

        const samples: any[] = [];
        const limit = Math.min(elements.length, 8);

        for (let i = 0; i < limit; i++) {
          const el = elements[i] as HTMLElement;
          const computed = getComputedStyle(el);
          const extractedStyles: Record<string, string> = {};

          for (const prop of propsToExtract) {
            const val = computed.getPropertyValue(prop).trim();
            if (val && val !== "none" && val !== "normal" && val !== "auto" &&
                val !== "0px" && val !== "rgba(0, 0, 0, 0)" && val !== "transparent" &&
                val !== "0s" && val !== "0" && val !== "visible" && val !== "static" &&
                val !== "stretch" && val !== "start") {
              extractedStyles[prop] = val;
            }
          }

          const tagName = el.tagName.toLowerCase();
          const classes = (typeof el.className === 'string' ? el.className : '').slice(0, 200);
          const role = el.getAttribute("role") || "";
          const text = (el.textContent || "").trim().slice(0, 80);
          const dataAttrs: Record<string, string> = {};
          for (const attr of el.attributes) {
            if (attr.name.startsWith("data-")) {
              dataAttrs[attr.name] = attr.value.slice(0, 50);
            }
          }

          if (Object.keys(extractedStyles).length > 2) {
            samples.push({
              tag: tagName,
              classes,
              role,
              text: text || undefined,
              dataAttrs: Object.keys(dataAttrs).length > 0 ? dataAttrs : undefined,
              styles: extractedStyles,
            });
          }
        }

        if (samples.length > 0) {
          elementStyles[selector] = samples;
        }
      } catch (e) {}
    }
    result.elementStyles = elementStyles;

    // 5. Collect ALL unique values across the page
    const allElements = document.querySelectorAll("*");
    const uniqueValues: Record<string, Set<string>> = {
      colors: new Set(),
      bgColors: new Set(),
      borderColors: new Set(),
      fontFamilies: new Set(),
      fontSizes: new Set(),
      fontWeights: new Set(),
      lineHeights: new Set(),
      letterSpacings: new Set(),
      borderRadii: new Set(),
      boxShadows: new Set(),
      gaps: new Set(),
      paddings: new Set(),
      transitions: new Set(),
      opacities: new Set(),
    };

    const sampleSize = Math.min(allElements.length, 2000);
    for (let i = 0; i < sampleSize; i++) {
      const computed = getComputedStyle(allElements[i]);

      const color = computed.color;
      const bg = computed.backgroundColor;
      const border = computed.borderColor;
      const font = computed.fontFamily;
      const size = computed.fontSize;
      const weight = computed.fontWeight;
      const lh = computed.lineHeight;
      const ls = computed.letterSpacing;
      const radius = computed.borderRadius;
      const shadow = computed.boxShadow;
      const gap = computed.gap;
      const padding = computed.padding;
      const transition = computed.transition;
      const opacity = computed.opacity;

      if (color && color !== "rgba(0, 0, 0, 0)") uniqueValues.colors.add(color);
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") uniqueValues.bgColors.add(bg);
      if (border && border !== "rgba(0, 0, 0, 0)") uniqueValues.borderColors.add(border);
      if (font) uniqueValues.fontFamilies.add(font);
      if (size) uniqueValues.fontSizes.add(size);
      if (weight && weight !== "400") uniqueValues.fontWeights.add(weight);
      if (lh && lh !== "normal") uniqueValues.lineHeights.add(lh);
      if (ls && ls !== "normal" && ls !== "0px") uniqueValues.letterSpacings.add(ls);
      if (radius && radius !== "0px") uniqueValues.borderRadii.add(radius);
      if (shadow && shadow !== "none") uniqueValues.boxShadows.add(shadow);
      if (gap && gap !== "normal" && gap !== "0px") uniqueValues.gaps.add(gap);
      if (padding && padding !== "0px") uniqueValues.paddings.add(padding);
      if (transition && transition !== "none" && transition !== "all 0s ease 0s") uniqueValues.transitions.add(transition);
      if (opacity && opacity !== "1") uniqueValues.opacities.add(opacity);
    }

    // Convert sets to arrays
    result.uniqueValues = {};
    for (const [key, set] of Object.entries(uniqueValues)) {
      result.uniqueValues[key] = [...set];
    }

    // 6. Pseudo-element styles (::before, ::after) on key elements
    const pseudoStyles: any[] = [];
    const keyElements = document.querySelectorAll("button, a, input, [role='button'], [role='tab'], [role='menuitem']");
    for (let i = 0; i < Math.min(keyElements.length, 30); i++) {
      const el = keyElements[i] as HTMLElement;
      for (const pseudo of ["::before", "::after"]) {
        const pComputed = getComputedStyle(el, pseudo);
        const content = pComputed.content;
        if (content && content !== "none" && content !== "normal" && content !== '""') {
          pseudoStyles.push({
            selector: el.tagName.toLowerCase() + (el.className ? "." + (typeof el.className === 'string' ? el.className.split(" ")[0] : '') : ""),
            pseudo,
            content,
            background: pComputed.backgroundColor,
            width: pComputed.width,
            height: pComputed.height,
          });
        }
      }
    }
    result.pseudoStyles = pseudoStyles;

    return result;
  });

  // Save raw JSON
  fs.writeFileSync(
    path.join(outputDir, "linear-app-tokens.json"),
    JSON.stringify(styles, null, 2)
  );

  // Save raw CSS file
  const rawCSS = await page.evaluate(() => {
    const allCSS: string[] = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          allCSS.push(rule.cssText);
        }
      } catch (e) {}
    }
    return allCSS.join("\n\n");
  });
  fs.writeFileSync(path.join(outputDir, "linear-app-raw.css"), rawCSS);

  // Generate summary
  const summary = generateSummary(styles);
  fs.writeFileSync(path.join(outputDir, "linear-app-reference.md"), summary);

  // Try to navigate to different views for more screenshots
  console.log("\nTaking additional screenshots...");
  console.log("Navigate to different views in Linear (settings, issue detail, etc.)");
  console.log("Press Enter after each view to capture it, or type 'done' to finish.\n");

  let viewCount = 1;
  while (true) {
    const input = await new Promise<string>((resolve) => {
      process.stdin.once("data", (data) => resolve(data.toString().trim()));
    });

    if (input.toLowerCase() === "done") break;

    viewCount++;
    await page.screenshot({
      path: path.join(outputDir, `linear-app-view-${viewCount}.png`),
      fullPage: false
    });
    console.log(`Captured view ${viewCount}`);
  }

  console.log(`\nExtraction complete!`);
  console.log(`  CSS variables: ${Object.keys(styles.cssVariables || {}).length}`);
  console.log(`  Root variables: ${Object.keys(styles.rootVariables || {}).length}`);
  console.log(`  Element selectors sampled: ${Object.keys(styles.elementStyles || {}).length}`);
  console.log(`  Unique colors: ${styles.uniqueValues?.colors?.length || 0}`);
  console.log(`  Unique bg colors: ${styles.uniqueValues?.bgColors?.length || 0}`);
  console.log(`  Unique border radii: ${styles.uniqueValues?.borderRadii?.length || 0}`);
  console.log(`  Unique box shadows: ${styles.uniqueValues?.boxShadows?.length || 0}`);
  console.log(`  Unique transitions: ${styles.uniqueValues?.transitions?.length || 0}`);
  console.log(`  Raw CSS rules: ${styles.rawCSSRuleCount || 0}`);
  console.log(`\nSaved to:`);
  console.log(`  output/linear-app-tokens.json (structured data)`);
  console.log(`  output/linear-app-reference.md (readable summary)`);
  console.log(`  output/linear-app-raw.css (full CSS)`);
  console.log(`  output/linear-app-main.png + views`);

  await browser.close();
}

function generateSummary(styles: any): string {
  let md = `# Linear App Design Reference\n\nExtracted from app.linear.app on ${new Date().toISOString().split("T")[0]}\n\n`;

  md += `## CSS Custom Properties (${Object.keys(styles.cssVariables || {}).length})\n\n`;
  const vars = Object.entries(styles.cssVariables || {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, value] of vars) {
    md += `\`${key}\`: \`${value}\`\n`;
  }

  md += `\n## Root Computed Variables (${Object.keys(styles.rootVariables || {}).length})\n\n`;
  const rootVars = Object.entries(styles.rootVariables || {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, value] of rootVars) {
    md += `\`${key}\`: \`${value}\`\n`;
  }

  md += `\n## Typography\n\n`;
  md += `### Font Families\n`;
  for (const font of styles.uniqueValues?.fontFamilies || []) {
    md += `- \`${font}\`\n`;
  }
  md += `\n### Font Sizes (sorted)\n`;
  const sizes = (styles.uniqueValues?.fontSizes || []).sort((a: string, b: string) => parseFloat(a) - parseFloat(b));
  for (const size of sizes) {
    md += `- \`${size}\`\n`;
  }
  md += `\n### Font Weights\n`;
  for (const weight of styles.uniqueValues?.fontWeights || []) {
    md += `- \`${weight}\`\n`;
  }
  md += `\n### Line Heights\n`;
  for (const lh of styles.uniqueValues?.lineHeights || []) {
    md += `- \`${lh}\`\n`;
  }
  md += `\n### Letter Spacings\n`;
  for (const ls of styles.uniqueValues?.letterSpacings || []) {
    md += `- \`${ls}\`\n`;
  }

  md += `\n## Colors\n\n`;
  md += `### Text Colors (${styles.uniqueValues?.colors?.length || 0})\n`;
  for (const c of styles.uniqueValues?.colors || []) {
    md += `- \`${c}\`\n`;
  }
  md += `\n### Background Colors (${styles.uniqueValues?.bgColors?.length || 0})\n`;
  for (const c of styles.uniqueValues?.bgColors || []) {
    md += `- \`${c}\`\n`;
  }
  md += `\n### Border Colors (${styles.uniqueValues?.borderColors?.length || 0})\n`;
  for (const c of styles.uniqueValues?.borderColors || []) {
    md += `- \`${c}\`\n`;
  }

  md += `\n## Spacing\n\n`;
  md += `### Gaps\n`;
  for (const g of styles.uniqueValues?.gaps || []) {
    md += `- \`${g}\`\n`;
  }
  md += `\n### Unique Paddings (${styles.uniqueValues?.paddings?.length || 0})\n`;
  const paddings = (styles.uniqueValues?.paddings || []).slice(0, 30);
  for (const p of paddings) {
    md += `- \`${p}\`\n`;
  }

  md += `\n## Borders\n\n`;
  md += `### Border Radii\n`;
  for (const r of styles.uniqueValues?.borderRadii || []) {
    md += `- \`${r}\`\n`;
  }

  md += `\n## Effects\n\n`;
  md += `### Box Shadows (${styles.uniqueValues?.boxShadows?.length || 0})\n`;
  for (const s of styles.uniqueValues?.boxShadows || []) {
    md += `- \`${s}\`\n`;
  }
  md += `\n### Opacities\n`;
  for (const o of styles.uniqueValues?.opacities || []) {
    md += `- \`${o}\`\n`;
  }
  md += `\n### Transitions (${styles.uniqueValues?.transitions?.length || 0})\n`;
  const transitions = (styles.uniqueValues?.transitions || []).slice(0, 20);
  for (const t of transitions) {
    md += `- \`${t}\`\n`;
  }

  md += `\n## Component Styles\n\n`;
  for (const [selector, samples] of Object.entries(styles.elementStyles || {})) {
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

  return md;
}

extractAppStyles().catch(console.error);
