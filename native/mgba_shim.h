#ifndef MGBA_SHIM_H
#define MGBA_SHIM_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct mgba_handle mgba_handle_t;

typedef struct mgba_rom_info {
    char title[64];
    char game_code[16];
    uint32_t rom_size;
    uint32_t ram_size;
    uint8_t has_battery;
    uint8_t has_rtc;
    int platform; // 0 = GBA, 1 = GB/GBC
    int model;    // 0 = DMG, 1 = CGB, 2 = AGB, 3 = SGB
} mgba_rom_info_t;

typedef struct mgba_batch_request {
    uint32_t address;     // bus address or offset
    uint16_t length;      // 1 for u8, 2 for u16le, 4 for u32le, or N for bytes
    uint16_t bank;        // bank index (0..511 for MBC5) or region_id if read_type == 5
    uint8_t read_type;    // 0 = bus, 1 = rom, 2 = banked_wram, 3 = banked_vram, 4 = banked_sram, 5 = region, 6 = banked_rom
    uint8_t _reserved[3]; // padding for 4-byte alignment
} mgba_batch_request_t;

/**
 * Open and initialize a ROM headlessly.
 * Allocates internal video buffer and resets core.
 */
mgba_handle_t* mgba_open(const char* rom_path);

/**
 * Closes and deinitializes the core, freeing all associated memory.
 */
void mgba_close(mgba_handle_t* handle);

/**
 * Resets the emulator core.
 */
void mgba_reset(mgba_handle_t* handle);

/**
 * Get ROM metadata (title, game code, size, platform, model).
 */
bool mgba_get_rom_info(mgba_handle_t* handle, mgba_rom_info_t* info_out);

/**
 * Returns the detected hardware console model: 0 = DMG, 1 = CGB, 2 = AGB, 3 = SGB.
 */
int mgba_get_model(mgba_handle_t* handle);

/**
 * Get the current video dimensions and pointer to raw 32-bit pixel buffer.
 */
const uint8_t* mgba_get_video_buffer(mgba_handle_t* handle, uint32_t* width, uint32_t* height, uint32_t* stride_bytes);

/**
 * Get direct pointer to native VRAM buffer and its total byte size.
 */
const uint8_t* mgba_get_vram(mgba_handle_t* handle, size_t* out_size);

/**
 * Get direct pointer to native OAM buffer and its total byte size.
 */
const uint8_t* mgba_get_oam(mgba_handle_t* handle, size_t* out_size);

/**
 * Direct bounded memory copies for video frame, VRAM, and OAM.
 * mgba_copy_video_buffer guarantees fully opaque alpha (0xFF000000) on 32-bit pixel copy.
 * Returns bytes copied, or 0 if output buffer is too small or handle is invalid.
 */
size_t mgba_copy_video_buffer(mgba_handle_t* handle, uint8_t* out_buffer, size_t max_size);
size_t mgba_copy_vram(mgba_handle_t* handle, uint8_t* out_buffer, size_t max_size);
size_t mgba_copy_oam(mgba_handle_t* handle, uint8_t* out_buffer, size_t max_size);

/**
 * Advance emulation by 1 frame with given key mask.
 */
void mgba_step_frame(mgba_handle_t* handle, uint32_t keys);

/**
 * Get current frame counter.
 */
uint32_t mgba_get_frame_counter(mgba_handle_t* handle);

/**
 * 16-bit / 32-bit CPU bus memory read/write (WRAM, VRAM, HRAM, registers).
 */
uint8_t mgba_bus_read8(mgba_handle_t* handle, uint32_t address);
uint16_t mgba_bus_read16(mgba_handle_t* handle, uint32_t address);
uint32_t mgba_bus_read32(mgba_handle_t* handle, uint32_t address);
void mgba_bus_write8(mgba_handle_t* handle, uint32_t address, uint8_t value);
void mgba_bus_write16(mgba_handle_t* handle, uint32_t address, uint16_t value);
void mgba_bus_write32(mgba_handle_t* handle, uint32_t address, uint32_t value);

/**
 * Bulk memory read from CPU bus.
 */
bool mgba_bus_read_range(mgba_handle_t* handle, uint32_t address, uint8_t* out_buffer, size_t length);

/**
 * Direct linear ROM read (for species tables, collision tables across GB and GBA).
 */
uint8_t mgba_rom_read8(mgba_handle_t* handle, uint32_t offset);
bool mgba_rom_read_range(mgba_handle_t* handle, uint32_t offset, uint8_t* out_buffer, size_t length);

/**
 * Banked WRAM / VRAM / SRAM / ROM read for Game Boy and Game Boy Color.
 */
uint8_t mgba_bank_read8(mgba_handle_t* handle, int space_id, int bank, uint32_t offset);
bool mgba_bank_read_range(mgba_handle_t* handle, int space_id, int bank, uint32_t offset, uint8_t* out_buffer, size_t length);
bool mgba_bank_write8(mgba_handle_t* handle, int space_id, int bank, uint32_t offset, uint8_t value);

/**
 * Checked region-aware memory read without CPU side-effects.
 * region_id: 0 = ROM, 1 = WRAM/EWRAM, 2 = VRAM, 3 = SRAM, 4 = OAM, 5 = HRAM/IWRAM, 6 = IO, 7 = PALETTE, 8 = BIOS
 */
bool mgba_read_region(mgba_handle_t* handle, int region_id, uint32_t offset, uint8_t* out_buffer, size_t length);

/**
 * Single-hop native batch read across multiple memory descriptors.
 */
bool mgba_read_batch(mgba_handle_t* handle, const mgba_batch_request_t* requests, size_t count, uint8_t* out_buffer, size_t out_size);

/**
 * Save state to file atomically using a temporary file.
 */
bool mgba_save_state(mgba_handle_t* handle, const char* filepath);

bool mgba_load_state(mgba_handle_t* handle, const char* filepath);

/**
 * In-memory savestate serialization (fast snapshot).
 */
size_t mgba_save_state_buffer(mgba_handle_t* handle, uint8_t* out_buffer, size_t max_size);
bool mgba_load_state_buffer(mgba_handle_t* handle, const uint8_t* in_buffer, size_t size);

/**
 * Dynamic APU audio sample rate in Hz (e.g. 131072 for GB, ~32768 for GBA).
 */
uint32_t mgba_get_audio_sample_rate(mgba_handle_t* handle);

/**
 * Reads up to max_sample_frames stereo PCM sample frames (each frame = 2x int16 = 4 bytes)
 * into out_buffer. Returns the number of stereo sample frames actually read.
 */
size_t mgba_read_audio_frames(mgba_handle_t* handle, int16_t* out_buffer, size_t max_sample_frames);

/**
 * Clears accumulated audio samples in the internal ring buffer.
 */
void mgba_clear_audio(mgba_handle_t* handle);

#ifdef __cplusplus
}
#endif

#endif // MGBA_SHIM_H
