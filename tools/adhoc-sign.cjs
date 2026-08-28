// electron-builder `afterPack` hook: ad-hoc sign the macOS bundle.
//
// WHY THIS EXISTS. `mac.identity: null` in electron-builder.mac-ci.yml was
// believed to mean "sign ad-hoc". It does not. app-builder-lib's MacPackager
// reads it and bails before signing anything:
//
//   if (qualifier === null) { log.info(... "skipped macOS code signing"); return false }
//
// and that exact line is in the log of the first macOS build on main:
//
//   • skipped macOS code signing  reason=identity explicitly is set to null
//
// Nothing else in app-builder-lib signs, so the .app shipped with no
// signature of its own. Electron's prebuilt binaries arrive ad-hoc signed by
// the Electron project, but electron-builder renames the bundle and its
// executable, rewrites Info.plist and adds Contents/Resources — which
// invalidates that seal. On Apple Silicon the kernel requires a valid
// signature to execute, and the usual symptom is Finder reporting the app as
// "damaged".
//
// So: sign it ad-hoc here, which is what the config always meant to say.
// Ad-hoc buys launchability, not trust — Gatekeeper still shows the
// unidentified-developer prompt until there is a Developer ID and
// notarization.
//
// WHY `afterPack` AND NOT `afterSign`. app-builder-lib's doPack runs
// copyFiles(extraResources) → afterPack → sanityCheck → doSignAfterPack, so
// this hook sees a complete bundle (the engine included) and any real signing
// happens afterwards and supersedes us. `afterSign` would never fire at all:
// electron-builder skips it when no signing occurred, and logs exactly that —
// "skipping afterSign hook as no signing occurred, perhaps you intended
// afterPack?".
//
// WHY IT VERIFIES. An ad-hoc sign that silently fails leaves precisely the
// bug it was added to fix, and a green build either way. The verify is what
// makes a bad signature a failed build rather than a member's problem.

const { execFileSync } = require("node:child_process");
const path = require("node:path");

module.exports = async (context) => {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  // A real certificate is configured, so electron-builder is about to sign
  // properly (inner binaries first, with entitlements and the hardened
  // runtime). Ad-hoc signing here would only be overwritten.
  if (process.env.CSC_LINK) {
    console.log("  • ad-hoc signing skipped  reason=CSC_LINK is set, real signing follows");
    return;
  }

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing  app=${app}`);

  // `--deep` is Apple's "emergency repair" flag and is the wrong tool for a
  // Developer ID signature, where each nested binary needs its own
  // entitlements. For an ad-hoc signature there are no entitlements to get
  // wrong, and it is the one call that reaches every nested Mach-O —
  // including the engine's cap.node under Contents/Resources.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });

  console.log("  • ad-hoc signing successful");
};
