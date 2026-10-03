/** Import exact native mob portraits; no runtime download or guessed family aliases.
 * node tools/mob-portraits.mjs <SAT Assets/MobAvatars folder> <40-character source revision>
 * The eight approved F3 portraits keep their original bytes. The manifest records both
 * the packaged hash and upstream hash; later imports preserve the approved exports.
 */
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [folder, revision] = process.argv.slice(2);
if (!folder || !/^[a-f0-9]{40}$/.test(revision ?? "")) {
  throw new Error("Usage: node tools/mob-portraits.mjs <MobAvatars folder> <40-character revision>");
}
const assets = join(root, "resources/albion");
const manifestFile = join(assets, "mob-portraits.json");
const previous = JSON.parse(readFileSync(manifestFile, "utf8"));
const approved = new Map(
  previous.portraits.filter((row) => row.origin === "approved-f3").map((row) => [row.avatar, row]),
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const blobSha1 = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const arrayLiteral = (values) => JSON.stringify(values, null, 2).replace(/\n\]$/, ",\n]");
const pngSize = (bytes) => {
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error("Portrait is not a PNG");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 1024 || height > 1024) {
    throw new Error("Portrait dimensions are invalid");
  }
  return { width, height };
};
const { outputFiles } = buildSync({
  entryPoints: [join(root, "src/shared/session/nameTables.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", outputFiles[0].text)(loaded, loaded.exports);
const mobs = Object.values(loaded.exports.MOBS);
const avatars = [...new Set(mobs.map((mob) => mob.avatar).filter(Boolean))].sort();
if (avatars.some((avatar) => !/^[A-Z0-9_]+$/.test(avatar))) {
  throw new Error("Mob table contains an unsafe avatar key");
}
const available = new Set(readdirSync(resolve(folder)).filter((file) => /^[A-Z0-9_]+\.png$/.test(file)));
const portraits = avatars
  .filter((avatar) => available.has(`${avatar}.png`) || approved.has(avatar))
  .map((avatar) => {
    const file = `mob-${avatar}.png`;
    const upstream = available.has(`${avatar}.png`) ? readFileSync(join(resolve(folder), `${avatar}.png`)) : null;
    if (upstream != null) {
      pngSize(upstream);
    }
    const preserved = approved.get(avatar);
    const packaged = preserved ? readFileSync(join(assets, file)) : upstream;
    if (packaged == null || (preserved && sha256(packaged) !== preserved.sha256)) {
      throw new Error(`Approved portrait changed or source is missing: ${avatar}`);
    }
    const dimensions = pngSize(packaged);
    if (!preserved && (dimensions.width !== 256 || dimensions.height !== 256)) {
      throw new Error(`Unreviewed source portrait frame: ${avatar}`);
    }
    return {
      avatar,
      file,
      origin: preserved ? "approved-f3" : "statistics-analysis",
      sha256: sha256(packaged),
      ...dimensions,
      // F3's supplied 128px portraits show the source's central medallion without its padding.
      // Crop in CSS, keeping original upstream bytes and hashes intact.
      frame: preserved ? "full" : "central-medallion",
      upstream: upstream == null ? null : { sha256: sha256(upstream), blobSha1: blobSha1(upstream) },
    };
  });
const selected = new Set(portraits.map((row) => row.avatar));
// Validate all inputs before replacing any assets. Only managed mob PNGs can be removed.
for (const row of portraits) {
  if (row.origin !== "approved-f3") {
    copyFileSync(join(resolve(folder), `${row.avatar}.png`), join(assets, row.file));
  }
}
for (const file of readdirSync(assets)) {
  if (/^mob-[A-Z0-9_]+\.png$/.test(file) && !portraits.some((row) => row.file === file)) {
    rmSync(join(assets, file));
  }
}
const manifest = {
  schema: 1,
  source: {
    repository: "https://github.com/Triky313/AlbionOnline-StatisticsAnalysis",
    revision,
    path: "src/StatisticsAnalysisTool/Assets/MobAvatars",
  },
  nameTableSha256: sha256(readFileSync(join(root, "src/shared/session/nameTables.ts"))),
  coverage: {
    mobEntries: mobs.length,
    avatarIdentities: avatars.length,
    portraits: portraits.length,
    coveredMobEntries: mobs.filter((mob) => selected.has(mob.avatar)).length,
    mobEntriesWithoutAvatar: mobs.filter((mob) => mob.avatar == null).length,
  },
  missingAvatars: avatars.filter((avatar) => !selected.has(avatar)),
  portraits,
};
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  join(root, "src/app/mobPortraits.ts"),
  `// Generated by tools/mob-portraits.mjs; see resources/albion/mob-portraits.json. Do not edit.\nexport const MOB_PORTRAIT_AVATARS = ${arrayLiteral([...selected])} as const;\nexport const FULL_FRAME_MOB_AVATARS = ${arrayLiteral(portraits.filter((row) => row.frame === "full").map((row) => row.avatar))} as const;\n`,
);
console.log(JSON.stringify(manifest.coverage));
