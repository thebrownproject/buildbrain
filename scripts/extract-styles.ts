import { chromium } from "playwright";

async function extractStyles() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Linear's marketing site uses the same design system
  await page.goto("https://linear.app", { waitUntil: "networkidle" });

  const styles = await page.evaluate(() => {
    const result: Record<string, any> = {};

    // 1. Extract ALL CSS custom properties from all stylesheets
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
      } catch (e) {
        // Cross-origin stylesheet, skip
      }
    }
    result.cssVariables = cssVars;

    // 2. Extract computed styles from :root
    const rootStyles = getComputedStyle(document.documentElement);
    const rootVars: Record<string, string> = {};
    for (let i = 0; i < rootStyles.length; i++) {
      const prop = rootStyles[i];
      if (prop.startsWith("--")) {
        rootVars[prop] = rootStyles.getPropertyValue(prop).trim();
      }
    }
    result.rootVariables = rootVars;

    // 3. Extract styles from key UI elements by selector patterns
    const elementSelectors = [
      // Buttons
      "button",
      "a[href]",
      // Inputs
      "input",
      "textarea",
      // Headings
      "h1", "h2", "h3", "h4", "h5", "h6",
      // Paragraphs
      "p", "span",
      // Navigation
      "nav", "nav a",
      // Cards/containers
      "div[class*='card']", "div[class*='Card']",
      "section",
      // Lists
      "li",
      // Code
      "code", "pre",
    ];

    const propsToExtract = [
      // Typography
      "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
      "text-transform", "text-decoration",
      // Colors
      "color", "background-color", "border-color",
      // Spacing
      "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
      "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
      "gap",
      // Borders
      "border", "border-width", "border-style", "border-radius",
      // Shadows
      "box-shadow", "text-shadow",
      // Layout
      "display", "flex-direction", "align-items", "justify-content",
      // Effects
      "opacity", "backdrop-filter", "transition",
    ];

    const elementStyles: Record<string, any[]> = {};

    for (const selector of elementSelectors) {
      const elements = document.querySelectorAll(selector);
      const samples: any[] = [];

      // Sample up to 5 elements per selector
      const limit = Math.min(elements.length, 5);
      for (let i = 0; i < limit; i++) {
        const el = elements[i] as HTMLElement;
        const computed = getComputedStyle(el);
        const styles: Record<string, string> = {};

        for (const prop of propsToExtract) {
          const val = computed.getPropertyValue(prop).trim();
          if (val && val !== "none" && val !== "normal" && val !== "0px" && val !== "rgba(0, 0, 0, 0)") {
            styles[prop] = val;
          }
        }

        // Get element info
        const classes = el.className?.toString().slice(0, 100) || "";
        const text = el.textContent?.slice(0, 50) || "";

        if (Object.keys(styles).length > 0) {
          samples.push({ classes, text, styles });
        }
      }

      if (samples.length > 0) {
        elementStyles[selector] = samples;
      }
    }
    result.elementStyles = elementStyles;

    // 4. Extract all unique colors used on the page
    const allElements = document.querySelectorAll("*");
    const colors = new Set<string>();
    const bgColors = new Set<string>();
    const borderColors = new Set<string>();
    const fontFamilies = new Set<string>();
    const fontSizes = new Set<string>();
    const borderRadii = new Set<string>();

    for (let i = 0; i < Math.min(allElements.length, 500); i++) {
      const computed = getComputedStyle(allElements[i]);
      const color = computed.color;
      const bg = computed.backgroundColor;
      const border = computed.borderColor;
      const font = computed.fontFamily;
      const size = computed.fontSize;
      const radius = computed.borderRadius;

      if (color && color !== "rgba(0, 0, 0, 0)") colors.add(color);
      if (bg && bg !== "rgba(0, 0, 0, 0)") bgColors.add(bg);
      if (border && border !== "rgba(0, 0, 0, 0)") borderColors.add(border);
      if (font) fontFamilies.add(font);
      if (size) fontSizes.add(size);
      if (radius && radius !== "0px") borderRadii.add(radius);
    }

    result.uniqueColors = {
      text: [...colors],
      background: [...bgColors],
      border: [...borderColors],
    };
    result.typography = {
      fontFamilies: [...fontFamilies],
      fontSizes: [...fontSizes].sort((a, b) => parseFloat(a) - parseFloat(b)),
    };
    result.borders = {
      radii: [...borderRadii],
    };

    // 5. Extract all @font-face declarations
    const fontFaces: any[] = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSFontFaceRule) {
            fontFaces.push(rule.cssText);
          }
        }
      } catch (e) {}
    }
    result.fontFaces = fontFaces;

    return result;
  });

  // Also capture a screenshot for visual reference
  await page.screenshot({ path: "output/linear-reference.png", fullPage: true });

  // Write the extracted styles
  const fs = require("fs");
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(
    "output/linear-design-tokens.json",
    JSON.stringify(styles, null, 2)
  );

  // Generate a human-readable summary
  const summary = generateSummary(styles);
  fs.writeFileSync("output/linear-design-reference.md", summary);

  console.log(`Extracted:`);
  console.log(`  CSS variables: ${Object.keys(styles.cssVariables || {}).length}`);
  console.log(`  Root variables: ${Object.keys(styles.rootVariables || {}).length}`);
  console.log(`  Element selectors sampled: ${Object.keys(styles.elementStyles || {}).length}`);
  console.log(`  Unique text colors: ${styles.uniqueColors?.text?.length || 0}`);
  console.log(`  Unique bg colors: ${styles.uniqueColors?.background?.length || 0}`);
  console.log(`  Font families: ${styles.typography?.fontFamilies?.length || 0}`);
  console.log(`  Font sizes: ${styles.typography?.fontSizes?.length || 0}`);
  console.log(`  Border radii: ${styles.borders?.radii?.length || 0}`);
  console.log(`\nSaved to output/linear-design-tokens.json`);
  console.log(`Saved to output/linear-design-reference.md`);
  console.log(`Screenshot: output/linear-reference.png`);

  await browser.close();
}

function generateSummary(styles: any): string {
  let md = `# Linear Design Reference\n\nExtracted from linear.app on ${new Date().toISOString().split("T")[0]}\n\n`;

  md += `## CSS Custom Properties\n\n`;
  const vars = styles.cssVariables || {};
  for (const [key, value] of Object.entries(vars)) {
    md += `- \`${key}\`: \`${value}\`\n`;
  }

  md += `\n## Typography\n\n`;
  md += `### Font Families\n`;
  for (const font of styles.typography?.fontFamilies || []) {
    md += `- \`${font}\`\n`;
  }
  md += `\n### Font Sizes\n`;
  for (const size of styles.typography?.fontSizes || []) {
    md += `- \`${size}\`\n`;
  }

  md += `\n## Colors\n\n`;
  md += `### Text Colors\n`;
  for (const color of styles.uniqueColors?.text || []) {
    md += `- \`${color}\`\n`;
  }
  md += `\n### Background Colors\n`;
  for (const color of styles.uniqueColors?.background || []) {
    md += `- \`${color}\`\n`;
  }
  md += `\n### Border Colors\n`;
  for (const color of styles.uniqueColors?.border || []) {
    md += `- \`${color}\`\n`;
  }

  md += `\n## Border Radii\n\n`;
  for (const radius of styles.borders?.radii || []) {
    md += `- \`${radius}\`\n`;
  }

  md += `\n## Element Styles\n\n`;
  for (const [selector, samples] of Object.entries(styles.elementStyles || {})) {
    md += `### \`${selector}\`\n`;
    for (const sample of samples as any[]) {
      md += `\n**Text:** "${sample.text}"\n`;
      for (const [prop, val] of Object.entries(sample.styles)) {
        md += `- ${prop}: \`${val}\`\n`;
      }
    }
    md += `\n`;
  }

  return md;
}

extractStyles().catch(console.error);
