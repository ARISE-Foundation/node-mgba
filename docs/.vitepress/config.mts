import { defineConfig, type HeadConfig } from 'vitepress';

// Where the site is served. GitHub Pages serves this repo at /node-mgba/.
// For a custom domain (e.g. node-mgba.arisef.org): set SITE_URL to that origin,
// BASE to '/', and add the domain in Settings → Pages.
const SITE_URL = 'https://arise-foundation.github.io/node-mgba/';
const BASE = '/node-mgba/';

const REPO = 'https://github.com/ARISE-Foundation/node-mgba';
const NPM = 'https://www.npmjs.com/package/node-mgba';
const GPP = 'https://www.twitch.tv/gemini_plays_pokemon/about';

const TAGLINE = 'Headless Game Boy & GBA emulator for Node.js';
const DESCRIPTION =
    "Headless, scriptable Game Boy, Game Boy Color and GBA emulator for Node.js, powered by mGBA's libmgba " +
    'core. Step frames, press buttons, read memory and capture the screen from TypeScript. Built for AI ' +
    'agents, automation and research.';

// Search-result descriptions for the guides. Kept here rather than in front matter,
// because GitHub renders front matter as a table at the top of docs/*.md.
const GUIDE_DESCRIPTIONS: Record<string, string> = {
    'guide/realtime-loop.md':
        'Run node-mgba in real time: a 59.73 FPS worker-thread emulator loop for 24/7 AI agents, ' +
        'livestream overlays and web studios, as used by Gemini Plays Pokémon.',
    'guide/plugins.md':
        'Write node-mgba plugins that package game-specific memory decoders, automation helpers and ' +
        'event subscriptions, with the built-in Pokémon Red/Blue plugin as a reference.',
    'guide/schema-dsl.md':
        'A declarative binary schema DSL for decoding game structs from emulator memory, with automatic ' +
        'TypeScript type inference.',
    'guide/testing.md':
        'Unit-test node-mgba memory decoders against mock memory with node:test, Vitest or Jest, ' +
        'with no emulator or ROM required.',
    'guide/benchmarks.md':
        'node-mgba performance for frame stepping, worker RPC, memory access, schema decoding, ' +
        'savestates and image encoding, with hardware details and methodology.',
};

const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: 'node-mgba',
    description: DESCRIPTION,
    url: SITE_URL,
    codeRepository: REPO,
    programmingLanguage: ['TypeScript', 'C'],
    runtimePlatform: 'Node.js',
    license: 'https://opensource.org/licenses/MIT',
    keywords: 'Game Boy emulator, GBA emulator, mGBA, libmgba, Node.js, headless emulator, AI agents, Pokémon',
    author: { '@type': 'Organization', name: 'ARISE Foundation', url: 'https://www.arisef.org/' },
};

export default defineConfig({
    lang: 'en-US',
    title: 'node-mgba',
    titleTemplate: ':title · node-mgba',
    description: DESCRIPTION,
    base: BASE,
    cleanUrls: true,
    lastUpdated: true,
    appearance: 'dark',

    // The guides live at docs/*.md so their links keep working on GitHub;
    // on the site they get lowercase URLs under /guide/.
    rewrites: {
        'REALTIME_LOOP.md': 'guide/realtime-loop.md',
        'PLUGINS.md': 'guide/plugins.md',
        'SCHEMA_DSL.md': 'guide/schema-dsl.md',
        'TESTING.md': 'guide/testing.md',
        'BENCHMARKS.md': 'guide/benchmarks.md',
    },

    sitemap: { hostname: SITE_URL },

    head: [
        ['link', { rel: 'icon', type: 'image/png', href: `${BASE}favicon.png` }],
        ['link', { rel: 'apple-touch-icon', href: `${BASE}apple-touch-icon.png` }],
        ['meta', { name: 'theme-color', content: '#120f24' }],
        ['meta', { property: 'og:type', content: 'website' }],
        ['meta', { property: 'og:site_name', content: 'node-mgba' }],
        ['meta', { property: 'og:image', content: `${SITE_URL}og-image.png` }],
        ['meta', { property: 'og:image:width', content: '1280' }],
        ['meta', { property: 'og:image:height', content: '640' }],
        ['meta', { property: 'og:image:alt', content: `node-mgba: ${TAGLINE}` }],
        ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
        ['script', { type: 'application/ld+json' }, JSON.stringify(jsonLd)],
    ],

    // Per-page canonical URL and social titles, so every page shares well and
    // search engines see one URL per page.
    transformPageData(pageData) {
        const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
        const url = new URL(path, SITE_URL).href;
        const isHome = pageData.frontmatter.layout === 'home';
        const title = isHome ? `node-mgba – ${TAGLINE}` : `${pageData.title} · node-mgba`;
        const guideDescription = GUIDE_DESCRIPTIONS[pageData.relativePath];
        if (guideDescription && !pageData.frontmatter.description) {
            pageData.description = guideDescription;
        }
        const description = pageData.frontmatter.description ?? pageData.description ?? DESCRIPTION;
        const head: HeadConfig[] = [
            ['link', { rel: 'canonical', href: url }],
            ['meta', { property: 'og:url', content: url }],
            ['meta', { property: 'og:title', content: title }],
            ['meta', { property: 'og:description', content: description }],
        ];
        pageData.frontmatter.head = [...(pageData.frontmatter.head ?? []), ...head];
    },

    themeConfig: {
        logo: { src: '/favicon.png', width: 32, height: 32, alt: '' },

        nav: [
            { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
            { text: 'npm', link: NPM },
            { text: 'Gemini Plays Pokémon', link: GPP },
        ],

        sidebar: [
            {
                text: 'Introduction',
                items: [{ text: 'Getting started', link: '/guide/getting-started' }],
            },
            {
                text: 'Guides',
                items: [
                    { text: 'Real-time & agent loops', link: '/guide/realtime-loop' },
                    { text: 'Writing plugins', link: '/guide/plugins' },
                    { text: 'Binary schema DSL', link: '/guide/schema-dsl' },
                    { text: 'Testing decoders', link: '/guide/testing' },
                    { text: 'Benchmarks', link: '/guide/benchmarks' },
                ],
            },
        ],

        socialLinks: [{ icon: 'github', link: REPO, ariaLabel: 'node-mgba on GitHub' }],

        search: { provider: 'local' },

        editLink: {
            pattern: `${REPO}/edit/main/docs/:path`,
            text: 'Edit this page on GitHub',
        },

        outline: { level: [2, 3] },

        footer: {
            message: 'Released under the MIT License.',
            copyright:
                'Built by the <a href="https://www.arisef.org/">ARISE Foundation</a> for ' +
                `<a href="${GPP}">Gemini Plays Pokémon</a>.`,
        },
    },
});
