# KMind Palace

> Put your notes into walk-in 3D houses and remember them with the method of loci.

![KMind Palace](preview.webp)

The memory palace (method of loci) is the technique memory champions use: place what you want to remember in a familiar room, then walk through it in your mind to recall it. KMind Palace brings this into SiYuan — your notes sit on the furniture of little 3D houses, you recall them by walking a route stop by stop, and your self-ratings go straight into SiYuan's flashcards.

The interface is available in English and Simplified Chinese and follows SiYuan's language setting.

| Bind notes to furniture | Recall along a route | AI mnemonic stories |
| :-: | :-: | :-: |
| ![Bind](https://cdn.jsdelivr.net/gh/suka233/kmind-palace@main/docs/media/bind-locus.en-US.webp) | ![Recall](https://cdn.jsdelivr.net/gh/suka233/kmind-palace@main/docs/media/recall.en-US.webp) | ![AI story](https://cdn.jsdelivr.net/gh/suka233/kmind-palace@main/docs/media/ai-story.en-US.webp) |

More demos on [GitHub](https://github.com/suka233/kmind-palace).

## Highlights

- 🏝 **Your own world** — an island town that zooms out to an archipelago and then a tiny planet. Four scene themes: island, forest, snow mountain, floating island.
- 📌 **Furniture as loci** — bind any block to a piece of furniture or to a single book on a shelf; a bookshelf can mirror a whole notebook.
- 🧭 **Recall along routes** — think first, reveal, rate 1–4. Ratings are written to SiYuan's built-in flashcards (spaced repetition). Pins change color by memory strength; neglected furniture gathers cobwebs.
- ✨ **AI memory aids** — vivid mnemonic stories and pictures (SiYuan's built-in AI or any OpenAI-compatible API), photo-to-furniture recognition, and a person-action-object system for numbers.
- 🦉 **Pet butler** — a little animal lives in your palace: it greets you at the door, tells you what is due, and leads the way during recall. Five species, custom colors and accessories.
- 🔒 **Everything stays in your SiYuan** — palaces sync with SiYuan and the plugin talks to no server. AI features only call the API you configure yourself.

## Quick start

1. Click the palace icon in the top bar (or `⌥⇧M`). A short guide appears on first launch.
2. Double-click "我的家" (My Home) to walk in, **click a piece of furniture** → "绑定笔记块" (bind block) → search for a block.
3. After binding a few, open "路线" (Routes) in the title bar → "开始回忆" (Start recall). Press `Space` to reveal and `1`–`4` to rate.

The ⚙ button in the top right holds settings: rendering quality (lower it if things feel slow), the pet butler, and the guide. Click the pet inside a palace to dress it up.

## Data

Everything is stored in `data/storage/petal/kmind-palace/` and synced by SiYuan:

- `palaces/<id>.json` — one file per palace; `world.json` — islands, palace placement, journeys, number codes and your pet; `index.json` — the palace list;
- `backups/` — untouched copies taken before a data-format upgrade;
- `ai.json` — AI settings including API keys (never written into palace data);
- `media/` — your photos, story pictures and imported 3D models (content-hashed file names).

Data files carry a format version: newer plugin versions upgrade old data automatically, and an older plugin refuses (instead of overwriting) data it cannot read.
