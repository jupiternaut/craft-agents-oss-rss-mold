# Homelander Fallen God Scene Pack

This directory is a runtime-ready Skill Moments scene pack. The mock debate cycle can use it to turn the local Homelander manuscript into concrete persona posts, comments, and media prompts.

## Source Material

- Manuscript: `/Users/gengrf/Desktop/穿越成了失去能力的祖国人-十万字草稿.md`
- Writer script: `/Users/gengrf/plm/scripts/plm_homelander_100k_writer.py`
- PLM project id: `novel-homelander-lost-power-100k`

The pack uses the local manuscript for concrete scenes through chapter 18 and the writer script for the overall premise, style rules, 32-chapter plan, and future planned beats.

## Files

- `scene-pack.json`: canonical structured scene-pack data.
- `index.ts`: typed selector/loader helpers used by the Skill Moments mock cycle.
- `sample-feed.jsonl`: three sample Skill Moments-shaped records showing how the pack turns beats into posts, media placeholders, and short random comments.
- `README.md`: this usage and provenance note.

## Data Shape

`scene-pack.json` keeps these top-level sections:

- `sources`: local file provenance and what each source was used for.
- `globalDirectives`: generation style, conflict axes, and randomness constraints.
- `participants`: primary author, random critic pool, and explicitly excluded auto participants.
- `commentPools`: short reusable comment variants by skill slug.
- `beats`: ordered scene beats with source line refs, tags, conflict, visual anchor, Homelander state, post templates, and media prompts.

The sample feed deliberately keeps `sources: []` in sample records. These are persona scene moments, not news/source digest moments.

## Core Beats

1. White House service corridor: Homelander forces Firecracker to prove loyalty while he struggles through a secret passage.
2. Maintenance gate slap: a homeless man hits him and proves the name no longer carries force.
3. Convenience store live: phones, coffee, pepper spray, and a slow automatic door turn him into a hunted clip.
4. Three-dollar hotdog: hunger, coins, labor, and trash bags reprice his dignity.
5. Old fan trap: a loyalist becomes a livestream blackmailer until Homelander talks him into fear.
6. Underground clinic extortion: a doctor uses scissors, debt, and video to expose the costlessness of his threats.
7. Firecracker martyr feed: her death is rebuilt into a recruitment flag.
8. Screen trial and symbol laundering: media turns him into a former tyrant while preserving a cleaned-up symbol.
9. New hero audition: Adam Bright and other candidates begin trying on his posture, smile, and cape.
10. Old poster trash liner: his giant poster is cut up for a garbage truck, teaching him how small dirty power works.
11. Dirty-work warehouse: planned next beat from the script, moving him into cash black work.
12. Compound and return list: planned late-arc beat linking the list, Soldier Boy, first-generation Compound V, and total return.

## Loader Rules

- Pick 3-6 beats per run using a seed based on `runId`, `roomId`, and `beatId`.
- Use one Homelander `postTemplates` entry as the main moment body.
- Attach one `mediaPrompts` entry as a media-generation request or placeholder.
- Select 0-4 critics from `participants.randomCriticPool`, then sample short comments from `commentPools`.
- Honor `excludedAutoParticipants`; `skillcreator` should not join randomly.
- Allow silence. A critic with no strong angle should produce no comment instead of filler.
