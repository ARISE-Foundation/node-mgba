#define ENABLE_VFS 1
#define ENABLE_DIRECTORIES 1

#include "mgba_shim.h"
#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/core/serialize.h>
#include <mgba/core/interface.h>
#include <mgba/internal/gb/gb.h>
#include <mgba/internal/gb/memory.h>
#include <mgba/internal/gb/video.h>
#include <mgba/internal/gba/gba.h>
#include <mgba/internal/gba/memory.h>
#include <mgba/internal/gba/video.h>
#include <mgba-util/vfs.h>
#include <mgba-util/audio-buffer.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>

#define GB_BUS_ADDRESS_SPACE_LIMIT     0x10000u
#define GBA_BUS_ADDRESS_SPACE_LIMIT    0x100000000ULL

#define GB_ROM_BANK_WINDOW_SIZE        0x4000u
#define GB_WRAM_BANK_WINDOW_SIZE       0x1000u
#define GB_VRAM_BANK_WINDOW_SIZE       0x2000u
#define GB_SRAM_BANK_WINDOW_SIZE       0x2000u

struct mgba_handle {
    struct mCore* core;
    uint32_t* video_buffer;
    unsigned width;
    unsigned height;
    size_t stride;
    char rom_path[1024];
};

mgba_handle_t* mgba_open(const char* rom_path) {
    if (!rom_path) return NULL;

    struct mCore* core = mCoreFind(rom_path);
    if (!core) return NULL;

    if (!core->init(core)) {
        return NULL;
    }

    mgba_handle_t* handle = (mgba_handle_t*) calloc(1, sizeof(mgba_handle_t));
    if (!handle) {
        core->deinit(core);
        return NULL;
    }

    handle->core = core;
    strncpy(handle->rom_path, rom_path, sizeof(handle->rom_path) - 1);

    if (!mCoreLoadFile(core, rom_path)) {
        core->deinit(core);
        free(handle);
        return NULL;
    }

    core->opts.volume = 256;
    core->opts.mute = 0;
    mCoreConfigInit(&core->config, NULL);
    mCoreConfigSetDefaultValue(&core->config, "idleOptimization", "detect");
    mCoreConfigSetDefaultValue(&core->config, "sgb.borders", "0");
    mCoreConfigSetDefaultValue(&core->config, "volume", "256");
    mCoreConfigSetDefaultValue(&core->config, "mute", "0");
    mCoreConfigLoadDefaults(&core->config, &core->opts);
    mCoreLoadConfig(core);
    core->opts.volume = 256;
    core->opts.mute = 0;
    if (core->loadConfig) {
        core->loadConfig(core, &core->config);
    }

    core->currentVideoSize(core, &handle->width, &handle->height);
    handle->stride = handle->width;
    handle->video_buffer = (uint32_t*) calloc(handle->width * handle->height, sizeof(uint32_t));
    if (!handle->video_buffer) {
        mCoreConfigDeinit(&core->config);
        core->deinit(core);
        free(handle);
        return NULL;
    }

    core->setVideoBuffer(core, (mColor*) handle->video_buffer, handle->stride);
    core->setAudioBufferSize(core, 16384);
    core->reset(core);

    if (core->platform(core) == mPLATFORM_GB && core->board) {
        struct GB* gb = (struct GB*) core->board;
        gb->audio.masterVolume = 256;
    }

    return handle;
}

void mgba_close(mgba_handle_t* handle) {
    if (!handle) return;
    if (handle->core) {
        mCoreConfigDeinit(&handle->core->config);
        handle->core->deinit(handle->core);
    }
    if (handle->video_buffer) {
        free(handle->video_buffer);
    }
    free(handle);
}

void mgba_reset(mgba_handle_t* handle) {
    if (!handle || !handle->core) return;
    handle->core->opts.volume = 256;
    handle->core->opts.mute = 0;
    handle->core->reset(handle->core);
    if (handle->core->platform(handle->core) == mPLATFORM_GB && handle->core->board) {
        struct GB* gb = (struct GB*) handle->core->board;
        gb->audio.masterVolume = 256;
    }
    struct mAudioBuffer* buf = handle->core->getAudioBuffer(handle->core);
    if (buf) {
        mAudioBufferClear(buf);
    }
}

int mgba_get_model(mgba_handle_t* handle) {
    if (!handle || !handle->core) return 0;
    if (handle->core->platform(handle->core) == mPLATFORM_GBA) {
        return 2; // AGB
    }
    if (handle->core->platform(handle->core) == mPLATFORM_GB && handle->core->board) {
        struct GB* gb = (struct GB*) handle->core->board;
        if (gb->model == GB_MODEL_SGB || gb->model == GB_MODEL_SGB2) {
            return 3; // SGB
        }
        if (gb->model == GB_MODEL_CGB || gb->model == GB_MODEL_SCGB) {
            return 1; // CGB
        }
    }
    return 0; // DMG
}

bool mgba_get_rom_info(mgba_handle_t* handle, mgba_rom_info_t* info_out) {
    if (!handle || !handle->core || !info_out) return false;
    memset(info_out, 0, sizeof(mgba_rom_info_t));
    info_out->platform = (int) handle->core->platform(handle->core);
    info_out->model = mgba_get_model(handle);
    info_out->rom_size = (uint32_t) handle->core->romSize(handle->core);

    struct mGameInfo game_info;
    memset(&game_info, 0, sizeof(game_info));
    handle->core->getGameInfo(handle->core, &game_info);
    snprintf(info_out->title, sizeof(info_out->title), "%s", game_info.title);
    snprintf(info_out->game_code, sizeof(info_out->game_code), "%s", game_info.code);

    if (handle->core->platform(handle->core) == mPLATFORM_GB && handle->core->board) {
        struct GB* gb = (struct GB*) handle->core->board;
        if (gb->memory.rom && gb->memory.romSize >= 0x0150) {
            uint8_t cart_type = gb->memory.rom[0x0147];
            uint8_t ram_code = gb->memory.rom[0x0149];
            info_out->has_battery = (cart_type == 0x03 || cart_type == 0x06 || cart_type == 0x09 ||
                                     cart_type == 0x0D || cart_type == 0x0F || cart_type == 0x10 ||
                                     cart_type == 0x13 || cart_type == 0x1B || cart_type == 0x1E ||
                                     cart_type == 0x22 || cart_type == 0xFF) ? 1 : 0;
            info_out->has_rtc = (cart_type == 0x0F || cart_type == 0x10) ? 1 : 0;
            if (gb->sramSize > 0) {
                info_out->ram_size = (uint32_t) gb->sramSize;
            } else if (ram_code == 1) {
                info_out->ram_size = 2048;
            } else if (ram_code == 2) {
                info_out->ram_size = 8192;
            } else if (ram_code == 3) {
                info_out->ram_size = 32768;
            } else if (ram_code == 4) {
                info_out->ram_size = 131072;
            } else if (ram_code == 5) {
                info_out->ram_size = 65536;
            } else {
                info_out->ram_size = 0;
            }
        }
    } else if (handle->core->platform(handle->core) == mPLATFORM_GBA && handle->core->board) {
        struct GBA* gba = (struct GBA*) handle->core->board;
        enum GBASavedataType sType = gba->memory.savedata.type;
        info_out->has_battery = (sType >= GBA_SAVEDATA_SRAM || (gba->memory.hw.devices & HW_RTC) != 0) ? 1 : 0;
        info_out->has_rtc = (gba->memory.hw.devices & HW_RTC) ? 1 : 0;
        info_out->ram_size = (uint32_t) GBASavedataSize(&gba->memory.savedata);
    }
    return true;
}

const uint8_t* mgba_get_video_buffer(mgba_handle_t* handle, uint32_t* width, uint32_t* height, uint32_t* stride_bytes) {
    if (!handle) return NULL;
    if (width) *width = handle->width;
    if (height) *height = handle->height;
    if (stride_bytes) *stride_bytes = handle->stride * sizeof(uint32_t);
    return (const uint8_t*) handle->video_buffer;
}

const uint8_t* mgba_get_vram(mgba_handle_t* handle, size_t* out_size) {
    if (!handle || !handle->core || !handle->core->board) return NULL;
    if (handle->core->platform(handle->core) == mPLATFORM_GB) {
        struct GB* gb = (struct GB*) handle->core->board;
        if (gb->video.vram) {
            if (out_size) *out_size = (gb->model == GB_MODEL_CGB) ? GB_SIZE_VRAM : GB_SIZE_VRAM_BANK0;
            return (const uint8_t*) gb->video.vram;
        }
    } else if (handle->core->platform(handle->core) == mPLATFORM_GBA) {
        struct GBA* gba = (struct GBA*) handle->core->board;
        if (gba->video.vram) {
            if (out_size) *out_size = GBA_SIZE_VRAM;
            return (const uint8_t*) gba->video.vram;
        }
    }
    return NULL;
}

const uint8_t* mgba_get_oam(mgba_handle_t* handle, size_t* out_size) {
    if (!handle || !handle->core || !handle->core->board) return NULL;
    if (handle->core->platform(handle->core) == mPLATFORM_GB) {
        struct GB* gb = (struct GB*) handle->core->board;
        if (out_size) *out_size = GB_SIZE_OAM;
        return (const uint8_t*) gb->video.oam.raw;
    } else if (handle->core->platform(handle->core) == mPLATFORM_GBA) {
        struct GBA* gba = (struct GBA*) handle->core->board;
        if (out_size) *out_size = GBA_SIZE_OAM;
        return (const uint8_t*) gba->video.oam.raw;
    }
    return NULL;
}

size_t mgba_copy_video_buffer(mgba_handle_t* handle, uint8_t* out_buffer, size_t max_size) {
    if (!handle || !out_buffer || !handle->video_buffer) return 0;
    size_t total_pixels = (size_t) handle->width * (size_t) handle->height;
    size_t total_bytes = total_pixels * sizeof(uint32_t);
    if (max_size < total_bytes) return 0;

    const uint32_t* src = handle->video_buffer;
    uint32_t* dst = (uint32_t*) out_buffer;
    for (size_t i = 0; i < total_pixels; i++) {
        dst[i] = src[i] | 0xFF000000u;
    }
    return total_bytes;
}

size_t mgba_copy_vram(mgba_handle_t* handle, uint8_t* out_buffer, size_t max_size) {
    if (!handle || !out_buffer || !handle->core || !handle->core->board) return 0;
    size_t size = 0;
    const uint8_t* ptr = mgba_get_vram(handle, &size);
    if (!ptr || size == 0 || max_size < size) return 0;
    memcpy(out_buffer, ptr, size);
    return size;
}

size_t mgba_copy_oam(mgba_handle_t* handle, uint8_t* out_buffer, size_t max_size) {
    if (!handle || !out_buffer || !handle->core || !handle->core->board) return 0;
    size_t size = 0;
    const uint8_t* ptr = mgba_get_oam(handle, &size);
    if (!ptr || size == 0 || max_size < size) return 0;
    memcpy(out_buffer, ptr, size);
    return size;
}

void mgba_step_frame(mgba_handle_t* handle, uint32_t keys) {
    if (!handle || !handle->core) return;
    handle->core->setKeys(handle->core, keys);
    handle->core->runFrame(handle->core);
}

uint32_t mgba_get_frame_counter(mgba_handle_t* handle) {
    if (!handle || !handle->core) return 0;
    return (uint32_t) handle->core->frameCounter(handle->core);
}

uint8_t mgba_bus_read8(mgba_handle_t* handle, uint32_t address) {
    if (!handle || !handle->core) return 0;
    if (handle->core->platform(handle->core) == mPLATFORM_GB && address > 0xFFFFu) {
        return 0;
    }
    if (handle->core->platform(handle->core) == mPLATFORM_GBA && address >= 0x10000000u) {
        return 0;
    }
    return (uint8_t) handle->core->busRead8(handle->core, address);
}

uint16_t mgba_bus_read16(mgba_handle_t* handle, uint32_t address) {
    if (!handle || !handle->core) return 0;
    if (handle->core->platform(handle->core) == mPLATFORM_GB && address > 0xFFFEu) {
        return 0;
    }
    if (handle->core->platform(handle->core) == mPLATFORM_GBA && address > 0x0FFFFFFEu) {
        return 0;
    }
    return (uint16_t) handle->core->busRead16(handle->core, address);
}

uint32_t mgba_bus_read32(mgba_handle_t* handle, uint32_t address) {
    if (!handle || !handle->core) return 0;
    if (handle->core->platform(handle->core) == mPLATFORM_GB && address > 0xFFFCu) {
        return 0;
    }
    if (handle->core->platform(handle->core) == mPLATFORM_GBA && address > 0x0FFFFFFCu) {
        return 0;
    }
    return (uint32_t) handle->core->busRead32(handle->core, address);
}

void mgba_bus_write8(mgba_handle_t* handle, uint32_t address, uint8_t value) {
    if (!handle || !handle->core) return;
    if (handle->core->platform(handle->core) == mPLATFORM_GB && address > 0xFFFFu) {
        return;
    }
    if (handle->core->platform(handle->core) == mPLATFORM_GBA && address >= 0x10000000u) {
        return;
    }
    handle->core->busWrite8(handle->core, address, value);
}

void mgba_bus_write16(mgba_handle_t* handle, uint32_t address, uint16_t value) {
    if (!handle || !handle->core) return;
    if (handle->core->platform(handle->core) == mPLATFORM_GB && address > 0xFFFEu) {
        return;
    }
    if (handle->core->platform(handle->core) == mPLATFORM_GBA && address > 0x0FFFFFFEu) {
        return;
    }
    handle->core->busWrite16(handle->core, address, value);
}

void mgba_bus_write32(mgba_handle_t* handle, uint32_t address, uint32_t value) {
    if (!handle || !handle->core) return;
    if (handle->core->platform(handle->core) == mPLATFORM_GB && address > 0xFFFCu) {
        return;
    }
    if (handle->core->platform(handle->core) == mPLATFORM_GBA && address > 0x0FFFFFFCu) {
        return;
    }
    handle->core->busWrite32(handle->core, address, value);
}

bool mgba_bus_read_range(mgba_handle_t* handle, uint32_t address, uint8_t* out_buffer, size_t length) {
    if (!handle || !handle->core || !out_buffer || length == 0) return false;

    // Platform-aware bus address space bounds validation with subtraction to prevent integer overflow
    if (handle->core->platform(handle->core) == mPLATFORM_GB) {
        if (address > 0xFFFFu || length > (size_t)(0x10000u - address)) {
            return false;
        }
    } else {
        if ((uint64_t) length > 0x100000000ULL - address) {
            return false;
        }
    }

    for (size_t i = 0; i < length; i++) {
        out_buffer[i] = (uint8_t) handle->core->busRead8(handle->core, address + (uint32_t) i);
    }
    return true;
}

static const uint8_t* get_rom_ptr(mgba_handle_t* handle, size_t* out_size) {
    if (!handle || !handle->core || !handle->core->board) return NULL;
    if (handle->core->platform(handle->core) == mPLATFORM_GB) {
        struct GB* gb = (struct GB*) handle->core->board;
        if (gb->memory.rom) {
            if (out_size) *out_size = gb->pristineRomSize ? gb->pristineRomSize : gb->memory.romSize;
            return (const uint8_t*) gb->memory.rom;
        }
    } else if (handle->core->platform(handle->core) == mPLATFORM_GBA) {
        struct GBA* gba = (struct GBA*) handle->core->board;
        if (gba->memory.rom) {
            if (out_size) *out_size = gba->memory.romSize;
            return (const uint8_t*) gba->memory.rom;
        }
    }
    return NULL;
}

uint8_t mgba_rom_read8(mgba_handle_t* handle, uint32_t offset) {
    size_t size = 0;
    const uint8_t* ptr = get_rom_ptr(handle, &size);
    if (ptr && offset < size) {
        return ptr[offset];
    }
    return 0;
}

bool mgba_rom_read_range(mgba_handle_t* handle, uint32_t offset, uint8_t* out_buffer, size_t length) {
    if (!handle || !handle->core || !out_buffer || length == 0) return false;
    size_t size = 0;
    const uint8_t* ptr = get_rom_ptr(handle, &size);
    if (!ptr || offset >= size || length > size - offset) return false;
    memcpy(out_buffer, ptr + offset, length);
    return true;
}

bool mgba_bank_read_range(mgba_handle_t* handle, int space_id, int bank, uint32_t offset, uint8_t* out_buffer, size_t length) {
    if (!handle || !handle->core || !handle->core->board || !out_buffer || length == 0) return false;
    if (handle->core->platform(handle->core) == mPLATFORM_GB) {
        struct GB* gb = (struct GB*) handle->core->board;
        // space_id: 1 = WRAM, 2 = VRAM, 3 = SRAM, 4 = ROM
        if (space_id == 1 && gb->memory.wram) {
            if (bank < 0) return false;
            if (gb->model == GB_MODEL_CGB) {
                if (bank > 7 || offset >= GB_WRAM_BANK_WINDOW_SIZE || length > GB_WRAM_BANK_WINDOW_SIZE - offset) return false;
                uint32_t full_offset = (uint32_t) bank * GB_WRAM_BANK_WINDOW_SIZE + offset;
                if (full_offset >= GB_SIZE_WORKING_RAM || length > GB_SIZE_WORKING_RAM - full_offset) return false;
                memcpy(out_buffer, ((const uint8_t*) gb->memory.wram) + full_offset, length);
                return true;
            } else {
                if (bank > 1 || offset >= GB_WRAM_BANK_WINDOW_SIZE || length > GB_WRAM_BANK_WINDOW_SIZE - offset) return false;
                uint32_t full_offset = (uint32_t) bank * GB_WRAM_BANK_WINDOW_SIZE + offset;
                size_t max_size = GB_SIZE_WORKING_RAM_BANK0 * 2;
                if (full_offset >= max_size || length > max_size - full_offset) return false;
                memcpy(out_buffer, ((const uint8_t*) gb->memory.wram) + full_offset, length);
                return true;
            }
        } else if (space_id == 2 && gb->video.vram) {
            if (bank < 0) return false;
            if (gb->model == GB_MODEL_CGB) {
                if (bank > 1 || offset >= GB_VRAM_BANK_WINDOW_SIZE || length > GB_VRAM_BANK_WINDOW_SIZE - offset) return false;
                uint32_t full_offset = (uint32_t) bank * GB_VRAM_BANK_WINDOW_SIZE + offset;
                if (full_offset >= GB_SIZE_VRAM || length > GB_SIZE_VRAM - full_offset) return false;
                memcpy(out_buffer, ((const uint8_t*) gb->video.vram) + full_offset, length);
                return true;
            } else {
                if (bank > 0 || offset >= GB_VRAM_BANK_WINDOW_SIZE || length > GB_VRAM_BANK_WINDOW_SIZE - offset) return false;
                if (offset >= GB_SIZE_VRAM_BANK0 || length > GB_SIZE_VRAM_BANK0 - offset) return false;
                memcpy(out_buffer, ((const uint8_t*) gb->video.vram) + offset, length);
                return true;
            }
        } else if (space_id == 3 && gb->memory.sram) {
            if (bank < 0 || gb->sramSize == 0) return false;
            size_t max_banks = (gb->sramSize + (GB_SRAM_BANK_WINDOW_SIZE - 1)) / GB_SRAM_BANK_WINDOW_SIZE;
            if ((size_t) bank >= max_banks || offset >= GB_SRAM_BANK_WINDOW_SIZE || length > GB_SRAM_BANK_WINDOW_SIZE - offset) return false;
            size_t full_offset = (size_t) bank * GB_SRAM_BANK_WINDOW_SIZE + offset;
            if (full_offset + length > gb->sramSize) return false;
            memcpy(out_buffer, gb->memory.sram + full_offset, length);
            return true;
        } else if (space_id == 4 && gb->memory.rom) {
            if (bank < 0 || gb->memory.romSize == 0) return false;
            size_t max_banks = (gb->memory.romSize + (GB_ROM_BANK_WINDOW_SIZE - 1)) / GB_ROM_BANK_WINDOW_SIZE;
            if ((size_t) bank >= max_banks || offset >= GB_ROM_BANK_WINDOW_SIZE || length > GB_ROM_BANK_WINDOW_SIZE - offset) return false;
            size_t full_offset = (bank == 0) ? (size_t) offset : ((size_t) bank * GB_ROM_BANK_WINDOW_SIZE + offset);
            if (full_offset + length > gb->memory.romSize) return false;
            memcpy(out_buffer, gb->memory.rom + full_offset, length);
            return true;
        }
    }
    return false;
}

uint8_t mgba_bank_read8(mgba_handle_t* handle, int space_id, int bank, uint32_t offset) {
    uint8_t val = 0;
    if (mgba_bank_read_range(handle, space_id, bank, offset, &val, 1)) {
        return val;
    }
    return 0;
}

bool mgba_bank_write8(mgba_handle_t* handle, int space_id, int bank, uint32_t offset, uint8_t value) {
    if (!handle || !handle->core || !handle->core->board) return false;
    if (handle->core->platform(handle->core) == mPLATFORM_GB) {
        struct GB* gb = (struct GB*) handle->core->board;
        if (space_id == 1 && gb->memory.wram) {
            if (bank < 0) return false;
            if (gb->model == GB_MODEL_CGB) {
                if (bank > 7 || offset >= GB_WRAM_BANK_WINDOW_SIZE) return false;
                uint32_t full_offset = (uint32_t) bank * GB_WRAM_BANK_WINDOW_SIZE + offset;
                if (full_offset >= GB_SIZE_WORKING_RAM) return false;
                ((uint8_t*) gb->memory.wram)[full_offset] = value;
                return true;
            } else {
                if (bank > 1 || offset >= GB_WRAM_BANK_WINDOW_SIZE) return false;
                uint32_t full_offset = (uint32_t) bank * GB_WRAM_BANK_WINDOW_SIZE + offset;
                size_t max_size = GB_SIZE_WORKING_RAM_BANK0 * 2;
                if (full_offset >= max_size) return false;
                ((uint8_t*) gb->memory.wram)[full_offset] = value;
                return true;
            }
        } else if (space_id == 2 && gb->video.vram) {
            if (bank < 0) return false;
            if (gb->model == GB_MODEL_CGB) {
                if (bank > 1 || offset >= GB_VRAM_BANK_WINDOW_SIZE) return false;
                uint32_t full_offset = (uint32_t) bank * GB_VRAM_BANK_WINDOW_SIZE + offset;
                if (full_offset >= GB_SIZE_VRAM) return false;
                ((uint8_t*) gb->video.vram)[full_offset] = value;
                return true;
            } else {
                if (bank > 0 || offset >= GB_VRAM_BANK_WINDOW_SIZE || offset >= GB_SIZE_VRAM_BANK0) return false;
                ((uint8_t*) gb->video.vram)[offset] = value;
                return true;
            }
        } else if (space_id == 3 && gb->memory.sram) {
            if (bank < 0 || gb->sramSize == 0) return false;
            size_t max_banks = (gb->sramSize + (GB_SRAM_BANK_WINDOW_SIZE - 1)) / GB_SRAM_BANK_WINDOW_SIZE;
            if ((size_t) bank >= max_banks || offset >= GB_SRAM_BANK_WINDOW_SIZE) return false;
            size_t full_offset = (size_t) bank * GB_SRAM_BANK_WINDOW_SIZE + offset;
            if (full_offset >= gb->sramSize) return false;
            gb->memory.sram[full_offset] = value;
            return true;
        }
    }
    return false;
}

bool mgba_read_region(mgba_handle_t* handle, int region_id, uint32_t offset, uint8_t* out_buffer, size_t length) {
    if (!handle || !handle->core || !handle->core->board || !out_buffer || length == 0) return false;

    if (handle->core->platform(handle->core) == mPLATFORM_GB) {
        struct GB* gb = (struct GB*) handle->core->board;
        const uint8_t* src = NULL;
        size_t size = 0;

        switch (region_id) {
            case 0: // ROM
                return mgba_rom_read_range(handle, offset, out_buffer, length);
            case 1: // WRAM
                src = (const uint8_t*) gb->memory.wram;
                size = (gb->model == GB_MODEL_CGB) ? GB_SIZE_WORKING_RAM : GB_SIZE_WORKING_RAM_BANK0 * 2;
                break;
            case 2: // VRAM
                src = (const uint8_t*) gb->video.vram;
                size = (gb->model == GB_MODEL_CGB) ? GB_SIZE_VRAM : GB_SIZE_VRAM_BANK0;
                break;
            case 3: // SRAM
                src = (const uint8_t*) gb->memory.sram;
                size = gb->sramSize;
                break;
            case 4: // OAM
                src = (const uint8_t*) gb->video.oam.raw;
                size = GB_SIZE_OAM;
                break;
            case 5: // HRAM
                src = (const uint8_t*) gb->memory.hram;
                size = GB_SIZE_HRAM;
                break;
            case 6: // IO
                src = (const uint8_t*) gb->memory.io;
                size = GB_SIZE_IO;
                break;
            default:
                return false;
        }

        if (!src || offset >= size || length > size - offset) return false;
        memcpy(out_buffer, src + offset, length);
        return true;
    } else if (handle->core->platform(handle->core) == mPLATFORM_GBA) {
        struct GBA* gba = (struct GBA*) handle->core->board;
        const uint8_t* src = NULL;
        size_t size = 0;

        switch (region_id) {
            case 0: // ROM
                return mgba_rom_read_range(handle, offset, out_buffer, length);
            case 1: // EWRAM (256KB)
                src = (const uint8_t*) gba->memory.wram;
                size = GBA_SIZE_EWRAM;
                break;
            case 2: // VRAM (96KB)
                src = (const uint8_t*) gba->video.vram;
                size = GBA_SIZE_VRAM;
                break;
            case 3: // SRAM / Savedata
                src = (const uint8_t*) gba->memory.savedata.data;
                size = GBASavedataSize(&gba->memory.savedata);
                break;
            case 4: // OAM (1KB)
                src = (const uint8_t*) gba->video.oam.raw;
                size = GBA_SIZE_OAM;
                break;
            case 5: // IWRAM (32KB)
                src = (const uint8_t*) gba->memory.iwram;
                size = GBA_SIZE_IWRAM;
                break;
            case 6: // IO (1KB)
                src = (const uint8_t*) gba->memory.io;
                size = GBA_SIZE_IO;
                break;
            case 7: // PALETTE (1KB)
                src = (const uint8_t*) gba->video.palette;
                size = GBA_SIZE_PALETTE_RAM;
                break;
            case 8: // BIOS (16KB)
                src = (const uint8_t*) gba->memory.bios;
                size = GBA_SIZE_BIOS;
                break;
            default:
                return false;
        }

        if (!src || offset >= size || length > size - offset) return false;
        memcpy(out_buffer, src + offset, length);
        return true;
    }
    return false;
}

bool mgba_read_batch(mgba_handle_t* handle, const mgba_batch_request_t* requests, size_t count, uint8_t* out_buffer, size_t out_size) {
    if (!handle || !handle->core || !requests || !out_buffer || count == 0 || out_size == 0) return false;

    size_t out_cursor = 0;
    for (size_t i = 0; i < count; i++) {
        const mgba_batch_request_t* req = &requests[i];
        if (req->length == 0 || req->length > out_size || out_cursor > out_size - req->length) {
            return false;
        }

        switch (req->read_type) {
            case 0: // Bus read
                if (handle->core->platform(handle->core) == mPLATFORM_GB) {
                    if (req->address >= GB_BUS_ADDRESS_SPACE_LIMIT || req->length > GB_BUS_ADDRESS_SPACE_LIMIT - req->address) {
                        return false;
                    }
                } else if (handle->core->platform(handle->core) == mPLATFORM_GBA) {
                    if ((uint64_t) req->length > GBA_BUS_ADDRESS_SPACE_LIMIT - req->address) {
                        return false;
                    }
                }
                if (req->length == 1) {
                    out_buffer[out_cursor] = (uint8_t) handle->core->busRead8(handle->core, req->address);
                } else if (req->length == 2) {
                    uint16_t val = (uint16_t) handle->core->busRead16(handle->core, req->address);
                    out_buffer[out_cursor] = (uint8_t) (val & 0xFF);
                    out_buffer[out_cursor + 1] = (uint8_t) ((val >> 8) & 0xFF);
                } else if (req->length == 4) {
                    uint32_t val = (uint32_t) handle->core->busRead32(handle->core, req->address);
                    out_buffer[out_cursor] = (uint8_t) (val & 0xFF);
                    out_buffer[out_cursor + 1] = (uint8_t) ((val >> 8) & 0xFF);
                    out_buffer[out_cursor + 2] = (uint8_t) ((val >> 16) & 0xFF);
                    out_buffer[out_cursor + 3] = (uint8_t) ((val >> 24) & 0xFF);
                } else {
                    for (size_t k = 0; k < req->length; k++) {
                        out_buffer[out_cursor + k] = (uint8_t) handle->core->busRead8(handle->core, req->address + (uint32_t) k);
                    }
                }
                break;
            case 1: // Linear ROM read
                if (!mgba_rom_read_range(handle, req->address, out_buffer + out_cursor, req->length)) {
                    return false;
                }
                break;
            case 2: // Banked WRAM (GB)
            case 3: // Banked VRAM (GB)
            case 4: // Banked SRAM (GB)
            case 6: // Banked ROM (GB)
                {
                    int space_id = (req->read_type == 2) ? 1 : (req->read_type == 3 ? 2 : (req->read_type == 4 ? 3 : 4));
                    if (!mgba_bank_read_range(handle, space_id, req->bank, req->address, out_buffer + out_cursor, req->length)) {
                        return false;
                    }
                }
                break;
            case 5: // Region read (req->bank holds region_id)
                if (!mgba_read_region(handle, (int) req->bank, req->address, out_buffer + out_cursor, req->length)) {
                    return false;
                }
                break;
            default:
                return false;
        }
        out_cursor += req->length;
    }
    return true;
}

bool mgba_save_state(mgba_handle_t* handle, const char* filepath) {
    if (!handle || !handle->core || !filepath) return false;

    char temp_path[1100];
    snprintf(temp_path, sizeof(temp_path), "%s.tmp", filepath);

    struct VFile* vf = VFileOpen(temp_path, O_CREAT | O_TRUNC | O_RDWR);
    if (!vf) return false;

    bool success = mCoreSaveStateNamed(handle->core, vf, SAVESTATE_ALL);
    vf->close(vf);

    if (success) {
        if (rename(temp_path, filepath) != 0) {
            unlink(temp_path);
            return false;
        }
        return true;
    }

    unlink(temp_path);
    return false;
}

bool mgba_load_state(mgba_handle_t* handle, const char* filepath) {
    if (!handle || !handle->core || !filepath) return false;

    struct VFile* vf = VFileOpen(filepath, O_RDONLY);
    if (!vf) return false;

    bool success = mCoreLoadStateNamed(handle->core, vf, SAVESTATE_ALL);
    vf->close(vf);

    if (success) {
        struct mAudioBuffer* buf = handle->core->getAudioBuffer(handle->core);
        if (buf) {
            mAudioBufferClear(buf);
        }
    }

    return success;
}

size_t mgba_save_state_buffer(mgba_handle_t* handle, uint8_t* out_buffer, size_t max_size) {
    if (!handle || !handle->core || !out_buffer || max_size == 0) return 0;
    struct VFile* vf = VFileMemChunk(NULL, 0);
    if (!vf) return 0;

    bool success = mCoreSaveStateNamed(handle->core, vf, SAVESTATE_ALL);
    size_t written = 0;
    if (success) {
        ssize_t size = vf->size(vf);
        if (size > 0 && (size_t) size <= max_size) {
            if (vf->seek(vf, 0, SEEK_SET) == 0) {
                ssize_t read_bytes = vf->read(vf, out_buffer, (size_t) size);
                if (read_bytes == size) {
                    written = (size_t) size;
                }
            }
        }
    }
    vf->close(vf);
    return written;
}

bool mgba_load_state_buffer(mgba_handle_t* handle, const uint8_t* in_buffer, size_t size) {
    if (!handle || !handle->core || !in_buffer || size == 0) return false;
    struct VFile* vf = VFileFromConstMemory(in_buffer, size);
    if (!vf) return false;

    bool success = mCoreLoadStateNamed(handle->core, vf, SAVESTATE_ALL);
    vf->close(vf);

    if (success) {
        struct mAudioBuffer* buf = handle->core->getAudioBuffer(handle->core);
        if (buf) {
            mAudioBufferClear(buf);
        }
    }
    return success;
}

uint32_t mgba_get_audio_sample_rate(mgba_handle_t* handle) {
    if (!handle || !handle->core) return 0;
    return (uint32_t) handle->core->audioSampleRate(handle->core);
}

size_t mgba_read_audio_frames(mgba_handle_t* handle, int16_t* out_buffer, size_t max_sample_frames) {
    if (!handle || !handle->core || !out_buffer || max_sample_frames == 0) return 0;
    struct mAudioBuffer* buf = handle->core->getAudioBuffer(handle->core);
    if (!buf) return 0;

    return mAudioBufferRead(buf, out_buffer, max_sample_frames);
}

void mgba_clear_audio(mgba_handle_t* handle) {
    if (!handle || !handle->core) return;
    struct mAudioBuffer* buf = handle->core->getAudioBuffer(handle->core);
    if (buf) {
        mAudioBufferClear(buf);
    }
}
