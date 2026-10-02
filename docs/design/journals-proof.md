# Journal completions — built proof

The opt-in v5 Session feed, at 0.8.8, from the independent September 16 excerpt:
three genuine completion packets (`1, 4, 1`), six full books. Item names come from
the pinned localization source. It is not combined with the September 21 evening.
No fame, progress, price or unseen journal count is inferred. Empty metric/source
wrappers do not reserve space; the first cards align across both columns.
OS controls are marked stand-ins; the stub version says 0.0.0.

| Theme | 1440 × 900 | 1024 × 768 | 768 × 620 |
| --- | --- | --- | --- |
| Obsidian | [Proof](journals/obsidian-1440.png) | [Proof](journals/obsidian-1024.png) | [Proof](journals/obsidian-768.png) |
| Parchment | [Proof](journals/parchment-1440.png) | [Proof](journals/parchment-1024.png) | [Proof](journals/parchment-768.png) |

The layout gate measures this excerpt in every theme, language and platform at
768/1024/1280/1440, asserting the rendered three-event/six-book feed without a
fame tile and with no gap reserved above its first card. Runtime file/snapshot
checks and limitations are in [slice 2](../slice2.md).
Regenerate after a build:

```sh
ONLY=journal-completions OUT=<folder> pnpm exec electron --no-sandbox tools/shell-shots.cjs
```
