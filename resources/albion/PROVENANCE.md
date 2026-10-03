# Approved Albion artwork

The owner supplied the F1 HTML export on 2026-10-03 and explicitly requested these native sprites in Session/PvE. Currency, activity and available chest sprites are copied byte-for-byte from that export. Eight mob portraits retain their original bytes from the approved F3 export supplied on 2026-10-02. On 2026-10-03 the owner requested broader mob portrait coverage; 498 additional exact matches were imported from the source below. These are Albion Online game assets; no ownership or new asset licence is claimed.

Only portraits referenced by the pinned mob table and the approved sprites are bundled. Exported HTML, JavaScript, vendor code, example equipment and example player data are not executed or packaged. The icon lookup is a generated static allowlist of exact avatar keys; unavailable or failed mob images use the native skull, and unavailable chest rarities retain the outline fallback. No lookalike family aliases are guessed. Dynamic item art still uses the existing restricted official image service.

This records the owner's private implementation choice; the wider public redistribution question in raid-bot Q58 remains unresolved. No release or merge is part of this correction.

## Mob portrait source and coverage

- Source: [Statistics Analysis Tool's MobAvatars](https://github.com/Triky313/AlbionOnline-StatisticsAnalysis/tree/3c90f930f742118ee6ffc8977f2f7f376af97016/src/StatisticsAnalysisTool/Assets/MobAvatars), pinned at `3c90f930f742118ee6ffc8977f2f7f376af97016`.
- The source contains 552 PNGs; 506 match exact avatar identities in our pinned ao-bin-dumps table. The 46 unreferenced source images are excluded. Eight approved F3 files are preserved; the other 498 are copied byte-for-byte. All downloaded source files were verified against their Git blob hashes.
- The 506 portraits cover 5,255 of 5,479 mob entries. Tiers/variants share the game's avatar identity. The remaining 80 identities (224 entries) are listed in [mob-portraits.json](mob-portraits.json); the skull remains until exact artwork is available. Summoned Imp (`1833`, `MORGANADEMONIMP1`) is covered.
- [mob-portraits.json](mob-portraits.json) records the source revision, name-table hash, coverage, exact filename, packaged SHA-256, source SHA-256/Git blob hash and dimensions for every portrait. [MOB-ASSET-SOURCE-LICENSE.txt](MOB-ASSET-SOURCE-LICENSE.txt) retains the source repository's GPL-3.0 licence text; the game artwork remains Sandbox Interactive's.
- The supplied F3 files are 128px portraits without the upstream 256px canvas padding. Imported files retain their bytes; the renderer displays their central 128px medallion using a clipped CSS viewport. This gives both sources the same visual weight at F3's 56px mob / 44px standout sizes. The manifest records each file's full/central-medallion frame; unknown source dimensions fail the importer for review.
- Re-import from that revision's `Assets/MobAvatars` folder with `node tools/mob-portraits.mjs <folder> <revision>`. It preserves approved F3 bytes and generates the renderer's allowlist. Build and run `pnpm check:portraits` to decode every packaged PNG in Chromium and check the recorded PvE/feed sinks, failed-image skull and recovery. Builds and runtime never fetch mob art from the network.

## Original approved export hashes

- `i-T5_FISH_FRESHWATER_STEPPE_RARE.png` — `6ba3f3c7444f2d00f659e00d4120474b234ea86b65f816f46e303d820343a084`
- `i-T8_2H_TOOL_SICKLE.png` — `d24784c47ac941ee7d774144e303b10b1037257404e08ded069d99b5e6d6c978`
- `mob-HERETICMAGE1.png` — `1ab8eef56b7c4dd361b9ee3abe9525a44089755d8a3199ae0ed69eccb27fd9a7`
- `mob-KEEPERDRUID1.png` — `114278e4eadb9ebe74d97f43cce756e65c47280d418926831c5fa27c3211ee9f`
- `mob-KEEPEREARTHCHILD1.png` — `bcc3b0f0893a933b754ebea3a86adf94212ff3ae36d84573fe03f316a5139478`
- `mob-MORGANACULTIST1.png` — `56abc254a748819dce7564bb9760b839017b15297c135c937d7532705eda3d62`
- `mob-MORGANASOLDIER1.png` — `b5326986e9ba83bd0e02adc5abd4ae85b3d2d8450d03ff4751f8ded288c0576b`
- `mob-MORGANASOLDIERMINIBOSS1.png` — `ac810fac33bdf1fe1dd58ce896ee3a446143386ef4d728d3d2504810c9a36d81`
- `mob-UNDEADARCHER1.png` — `3cc9f790322a418d49a5aadd4f92b9be6f6d3e5d400879ea9f84ca078d33454b`
- `mob-UNDEADMAGE1.png` — `f760b9ee647471f3b8cc0293bbd509fa126ac1d06dd2ff8b9260624515e86fba`
- `u-bag.png` — `71c79fa502c241ca3fe67513dda62759cb461a4bf22b0948ed31ec074e87722a`
- `u-chest_blue.png` — `676587a60172c14b0c7ac59d8af97501f9eedeeb21d9501bbff5aa5c8a7b17e3`
- `u-chest_green.png` — `971a70204cfd24b2b05452118eb6f6763dc335da9061a10f4006ee742fcf334e`
- `u-chest_purple.png` — `28d7882ef78f5b44458da1b11ee5c5997ff5811922cd6666f9de2450aa53aa33`
- `u-fame.png` — `5f6b540a6811e539062d456f141da52271ff46b5e40b5a522eaa70fe9972fab1`
- `u-favor.png` — `d1edb3f0667cff5816c35e14145568dd01bdbca52668616a566a0ac89454f665`
- `u-might.png` — `27b9a2ffdf65902276e7772d4e2c4849e693b9059b1922db210f419413d06840`
- `u-respec.png` — `d4a4f3193d6ed708e6364f6cbd2e59395ef30832049a2172d144a1e80fef84f0`
- `u-silver.png` — `b6a5ef65d7fdcebd18a0e419a11daf1bc3517df978c6fcf42d8e5783022b603f`
- `u-skull_gold.png` — `9703f981a1f4454322194b7cc57110bee5460aae358d02f5193157f371a9d38f`
