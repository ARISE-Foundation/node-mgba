# Homebrew Test Fixtures

This directory contains open-source test ROMs and fixtures used for automated regression and integration testing in `node-mgba`.

## Files & Licensing

### 1. `test_gb.gb`
- **Description:** Mooneye GB boot registers acceptance test ROM for Game Boy / DMG hardware.
- **Source:** Mooneye Test Suite by Joonas Javanainen ([https://github.com/Gekkio/mooneye-test-suite](https://github.com/Gekkio/mooneye-test-suite)).
- **License:** MIT License (see [LICENSE-MIT.txt](./LICENSE-MIT.txt)).

### 2. `test_gba.gba`
- **Description:** mGBA key interrupt and display test ROM for Game Boy Advance (AGB) hardware.
- **Source:** mGBA Test Suite by Jeffrey Pfau and the mGBA project ([https://github.com/mgba-emu/mgba](https://github.com/mgba-emu/mgba)).
- **License:** Mozilla Public License 2.0 (see [LICENSE-MPL-2.0.txt](./LICENSE-MPL-2.0.txt)).
- **Source Code:** Available at [https://github.com/mgba-emu/mgba](https://github.com/mgba-emu/mgba) in accordance with MPL 2.0 Section 3.2.

### 3. `test_gba.ss0`
- **Description:** Savestate generated from `test_gba.gba` including an upscaled 5× (1200×800) PNG thumbnail to test stride downsampling regression protection.
