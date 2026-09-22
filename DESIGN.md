# Design Direction

## World

蓝晒工程档案馆。把中文技术博客当成一份持续更新的工程档案，借鉴技术文档、GitHub Issue、蓝图和索引卡片的秩序感，而不是继续使用暖白色的通用卡片博客外观。

## Mode

Read. The page must make technical articles easy to scan, compare, filter, and stay with for a long read.

## Palette

- Paper: `#f2f8fc`
- Surface: `#ffffff`
- Ink: `#17324a`
- Muted ink: `#5c7488`
- Accent blue: `#2f7eae`
- Accent cyan: `#1aa6b7`
- Border: `#d8e8f1`
- Dark paper: `#0f1d2b`
- Dark surface: `#152a3d`

Light mode stays pale blue and low contrast in the background. Dark mode keeps the same blue identity and uses cyan only for interactive emphasis.

## Typography

Use a Chinese-friendly system sans stack for interface text. Use monospace only for dates, counts, Issue numbers, and code-related measurements. Headings are compact and confident; article body copy should remain around 65 to 75 characters per line.

## Layout

- Let the shared shell stretch with the viewport and keep only compact 1rem / 1.5rem outer gutters, so the article stream gets priority without a fixed desktop width.
- Keep the 17.5rem sidebar on desktop, with a calmer surface hierarchy than the article stream.
- Treat article entries as an indexed reading rail: one strong title, short metadata, category, tags, and a clear reading action.
- Keep category and tag navigation distinct. Category is one primary subject; tags are many cross references.
- Collapse the sidebar into a compact sequence on narrow screens without hiding the article list behind it.

## Materials and shapes

Use white paper surfaces, pale blue page ground, thin blue-gray rules, 14px to 16px corner radii, and soft offset shadows. Avoid glass blur on ordinary cards, heavy gradients, decorative status dots, and equal-weight nested cards.

## Motion

Low motion. Use a short color and border transition for navigation, tags, and article rows. Hover lift is limited to primary article entries and reduced under `prefers-reduced-motion`.

## Signature interaction

The active navigation, category filter, and article rail should feel like an index system. The selected item gets a clear blue mark and readable state, while the rest stays quiet.

## Non-goals

Do not add a marketing hero, decorative illustrations, fake portfolio content, new claims, or new route slugs. Keep the existing content and publishing workflow intact.
