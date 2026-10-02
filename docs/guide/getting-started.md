---
title: Getting started
description: Install node-mgba, load a Game Boy, GBC or GBA ROM, and script button input, memory reads, savestates and screen capture from Node.js.
---

# Getting started

`node-mgba` gives Node.js direct control over [libmgba](https://mgba.io/), the emulation core of mGBA, through native bindings. There's no window and no socket in between: your code steps frames, presses buttons, reads memory and captures the screen itself. It needs Node.js 20 or newer on x64 Linux or Windows.

<!-- This page mirrors the README, so both stay in sync. -->
<!--@include: ../../README.md#usage-->

<!--@include: ../../README.md#exports-->

## Next steps

- [Real-time emulation & agent loops](/guide/realtime-loop): run the emulator at 59.73 FPS in a worker for livestreams and 24/7 agents.
- [Writing plugins](/guide/plugins): package game-specific decoders and helpers.
- [Binary schema DSL](/guide/schema-dsl): describe game structs and decode RAM into typed objects.
- [Testing decoders](/guide/testing): unit-test decoders against mock memory, no ROM needed.
- [Benchmarks](/guide/benchmarks): how fast each operation is, and how it was measured.
