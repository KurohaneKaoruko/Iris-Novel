import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();

async function readText(filePath) {
  return await fs.readFile(filePath, "utf8");
}

async function writeText(filePath, content) {
  await fs.writeFile(filePath, content, "utf8");
}

function stringifyJson(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

function updateHtmlTitle(html, title) {
  if (!/<title>[\s\S]*?<\/title>/i.test(html)) {
    throw new Error("index.html missing <title> tag");
  }
  return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
}

function updateTomlKeysInSections(toml, updatesBySection) {
  const lines = toml.split(/\r?\n/);
  let currentSection = "";

  const sectionHeaderRegex = /^\s*\[([^\]]+)\]\s*$/;
  const keyValueRegex = /^\s*([A-Za-z0-9_.-]+)\s*=\s*"(.*)"\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const headerMatch = lines[i].match(sectionHeaderRegex);
    if (headerMatch) {
      currentSection = headerMatch[1];
      continue;
    }

    const kvMatch = lines[i].match(keyValueRegex);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const updates = updatesBySection[currentSection];
    if (!updates) continue;
    if (!(key in updates)) continue;

    lines[i] = `${key} = "${updates[key]}"`;
  }

  return `${lines.join("\n")}\n`;
}

function escapeRustString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function generateRustBrandingSource(branding) {
  const displayName = branding.displayName ?? "";
  const dataDirName = branding.dataDirName ?? displayName;
  const legacyDataDirName = branding.legacyDataDirName ?? "";
  const gitName = branding?.gitSignature?.name ?? displayName;
  const gitEmail = branding?.gitSignature?.email ?? "";

  return (
    `pub const DISPLAY_NAME: &str = "${escapeRustString(displayName)}";\n` +
    `pub const DATA_DIR_NAME: &str = "${escapeRustString(dataDirName)}";\n` +
    `pub const LEGACY_DATA_DIR_NAME: &str = "${escapeRustString(legacyDataDirName)}";\n` +
    `pub const GIT_SIGNATURE_NAME: &str = "${escapeRustString(gitName)}";\n` +
    `pub const GIT_SIGNATURE_EMAIL: &str = "${escapeRustString(gitEmail)}";\n`
  );
}

function tsStringLiteral(value) {
  return JSON.stringify(String(value ?? ""));
}

function generateFrontendBrandingSource(branding) {
  const displayName = branding.displayName ?? "";
  const editorNamespace = branding?.editor?.namespace ?? "";
  const editorConfigStorageKey = branding?.editor?.configStorageKey ?? "";
  const legacyEditorConfigStorageKey = branding?.editor?.legacyConfigStorageKey ?? "";

  return (
    `export const DISPLAY_NAME = ${tsStringLiteral(displayName)} as const\n` +
    `export const EDITOR_NAMESPACE = ${tsStringLiteral(editorNamespace)} as const\n` +
    `export const EDITOR_CONFIG_STORAGE_KEY = ${tsStringLiteral(editorConfigStorageKey)} as const\n` +
    `export const LEGACY_EDITOR_CONFIG_STORAGE_KEY = ${tsStringLiteral(legacyEditorConfigStorageKey)} as const\n`
  );
}

async function main() {
  const brandingPath = path.join(repoRoot, "branding.json");
  const branding = JSON.parse(await readText(brandingPath));

  const displayName = branding.displayName;
  const npmName = branding.npmName;
  const crateName = branding.crateName;
  const tauriIdentifier = branding.tauriIdentifier;

  {
    const packageJsonPath = path.join(repoRoot, "package.json");
    const pkg = JSON.parse(await readText(packageJsonPath));
    pkg.name = npmName;
    await writeText(packageJsonPath, stringifyJson(pkg));
  }

  {
    const indexHtmlPath = path.join(repoRoot, "index.html");
    const html = await readText(indexHtmlPath);
    await writeText(indexHtmlPath, updateHtmlTitle(html, displayName));
  }

  {
    const tauriConfPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
    const tauriConf = JSON.parse(await readText(tauriConfPath));

    tauriConf.productName = displayName;
    tauriConf.identifier = tauriIdentifier;

    if (tauriConf?.app?.windows?.length) {
      for (const win of tauriConf.app.windows) {
        if (win && typeof win === "object" && "title" in win) {
          win.title = displayName;
        }
      }
    }

    await writeText(tauriConfPath, stringifyJson(tauriConf));
  }

  {
    const cargoTomlPath = path.join(repoRoot, "src-tauri", "Cargo.toml");
    const cargoToml = await readText(cargoTomlPath);
    const updated = updateTomlKeysInSections(cargoToml, {
      package: { name: crateName, description: displayName },
      "package.metadata.tauri": { productName: displayName }
    });
    await writeText(cargoTomlPath, updated);
  }

  {
    const rustBrandingPath = path.join(repoRoot, "src-tauri", "src", "branding.rs");
    await writeText(rustBrandingPath, generateRustBrandingSource(branding));
  }

  {
    const frontendBrandingPath = path.join(repoRoot, "src", "branding.ts");
    await writeText(frontendBrandingPath, generateFrontendBrandingSource(branding));
  }
}

await main();
