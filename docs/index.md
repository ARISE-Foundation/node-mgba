---
layout: home
title: node-mgba
titleTemplate: Headless Game Boy & GBA emulator for Node.js
description: Headless, scriptable Game Boy, Game Boy Color and GBA emulator for Node.js, powered by mGBA's libmgba core. Step frames, press buttons, read memory and capture the screen from TypeScript. Built for AI agents, automation and research.

hero:
  name: node-mgba
  text: Headless Game Boy & GBA emulator for Node.js
  tagline: Step frames, press buttons, read memory and capture the screen in Game Boy, Game Boy Color and GBA games, all from TypeScript. Powered by mGBA's libmgba core, built for AI agents, automation and research.
  image:
    src: /screen.png
    alt: A pixel-art screen with a small robot in a sunset landscape and a dialog box reading emu.controls.press('A')
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/ARISE-Foundation/node-mgba

features:
  - icon: { src: /icon-bolt.png, width: 48, height: 48 }
    title: Headless and fast
    details: No window and no display server. Step frames far faster than real time, in-process or in a worker thread that never blocks your event loop.
    link: /guide/benchmarks
    linkText: Benchmarks
  - icon: { src: /icon-dpad.png, width: 48, height: 48 }
    title: Frame-perfect input
    details: Press, hold and release buttons, run input sequences, and advance exactly as many frames as you need.
    link: /guide/getting-started#input-frame-stepping
    linkText: Input & frame stepping
  - icon: { src: /icon-chip.png, width: 48, height: 48 }
    title: Direct memory access
    details: Read and write Game Boy and GBA memory with no socket in between, or batch many reads into one call.
    link: /guide/getting-started#reading-writing-memory
    linkText: Reading & writing memory
  - icon: { src: /icon-camera.png, width: 48, height: 48 }
    title: Screen and audio capture
    details: Grab raw frames or PNG/WebP, crop regions, and stream audio and video over WebSockets or straight into ffmpeg.
    link: /guide/getting-started#screen-capture-cropping
    linkText: Screen capture & cropping
  - icon: { src: /icon-plug.png, width: 48, height: 48 }
    title: Plugins and schema DSL
    details: Describe game structs declaratively and decode RAM into typed state. Ships with a Pokémon Red/Blue plugin to learn from.
    link: /guide/plugins
    linkText: Writing plugins
  - icon: { src: /icon-robot.png, width: 48, height: 48 }
    title: Built for agents
    details: In-memory savestates for cheap branching, and a real-time worker loop for 24/7 livestreams.
    link: /guide/realtime-loop
    linkText: Real-time & agent loops
---

## Install

::: code-group

```sh [pnpm]
pnpm add node-mgba
```

```sh [npm]
npm install node-mgba
```

```sh [yarn]
yarn add node-mgba
```

:::

Requires Node.js 20 or newer on x64 Linux or Windows. Bring your own ROMs.

## A game in a few lines

```ts
import { Mgba } from 'node-mgba';

// Load a ROM (.gb, .gbc or .gba)
const emu = await Mgba.load('./game.gb');

// Advance a second of game time, then press A
await emu.controls.tick(60);
await emu.controls.press('A');

// Read memory and grab the screen
const playerX = await emu.memory.read8(0xd362);
const png = await emu.screen.toPng();

await emu.close();
```

[Continue with the guide →](/guide/getting-started)

## Where it came from

node-mgba started as the emulator layer for [Gemini Plays Pokémon](https://www.twitch.tv/gemini_plays_pokemon/about), the 24/7 Twitch stream where Gemini plays Pokémon on its own. It's the same code the stream runs on, packaged so you can build your own game-playing agents. Read [The Making of Gemini Plays Pokémon](https://blog.jcz.dev/the-making-of-gemini-plays-pokemon), or watch the agent think in the [web viewer](https://gpp-viewer.arisef.org).
