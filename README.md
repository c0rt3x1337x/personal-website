# Personal blog

A minimal static blog that reads markdown files from these folders:

- `rants/`
- `tech/`
- `reviews/books/`
- `reviews/movies/`

It also fetches external posts from `https://medium.com/@kananhusayn` during the build and shows them on the homepage and inside the Tech section.

## How it works

- `npm run build` scans the markdown folders, converts them into static HTML, and writes the site to `dist/`.
- The build also reads the Medium RSS feed for `@kananhusayn` and adds those posts as external links.
- GitHub Actions deploys `dist/` to GitHub Pages on every push to `main`.
- New markdown files appear automatically after the next build or deployment.

## Adding a post

Create a `.md` file in one of the content folders. Front matter is optional, but recommended:

```md
---
title: Example Post
date: 2026-03-19
description: One short summary sentence.
---

# Example Post

Post body here.
```

Optional review fields:

- `author` for books
- `year` for movies
- `rating`
- `accent` for book cover color

If `title` is missing, the generator falls back to the first `# Heading` or the file name.

## Local development

```bash
npm install
npm run build
```

Open `dist/index.html` in a browser, or serve `dist/` with any static server.
