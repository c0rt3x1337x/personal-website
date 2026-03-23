import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import matter from "gray-matter";
import { marked } from "marked";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");
const templatePath = path.join(rootDir, "templates", "base.html");
const styleSource = path.join(rootDir, "assets", "site.css");
const mediumFeedUrl = "https://medium.com/feed/@kananhusayn";

const sections = [
  {
    key: "rants",
    title: "Rants",
    shortLabel: "Rants",
    intro: "Philosophical notes, private theories, and the slower kind of writing.",
    sourceDir: "rants",
    outputDir: "rants",
    icon: "R",
    listStyle: "files",
  },
  {
    key: "tech",
    title: "Tech",
    shortLabel: "Tech",
    intro: "Technical essays on systems, security, AI, and the craft around them.",
    sourceDir: "tech",
    outputDir: "tech",
    icon: "T",
    listStyle: "files",
  },
  {
    key: "books",
    title: "Book Reviews",
    shortLabel: "Books",
    intro: "A minimal shelf of books worth arguing with or returning to.",
    sourceDir: path.join("reviews", "books"),
    outputDir: path.join("reviews", "books"),
    icon: "B",
    listStyle: "books",
  },
  {
    key: "movies",
    title: "Movie Reviews",
    shortLabel: "Movies",
    intro: "Films that linger for visual, emotional, or philosophical reasons.",
    sourceDir: path.join("reviews", "movies"),
    outputDir: path.join("reviews", "movies"),
    icon: "M",
    listStyle: "movies",
  },
];

marked.setOptions({
  gfm: true,
  headerIds: true,
  mangle: false,
});

await buildSite();

async function buildSite() {
  const template = await fs.readFile(templatePath, "utf8");

  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });
  await copyFile(styleSource, path.join(distDir, "assets", "site.css"));
  await copyCnameIfPresent();

  const allPosts = [];
  const mediumPosts = await fetchMediumPosts();

  for (const section of sections) {
    const posts = await collectPosts(section);
    if (section.key === "tech") {
      section.mediumPosts = mediumPosts;
    }
    section.posts = posts;
    allPosts.push(...posts);
  }

  const allEntries = [...allPosts, ...mediumPosts].sort(sortByDateDesc);

  await Promise.all(sections.map((section) => writeSectionPage(template, section)));
  await Promise.all(allPosts.map((post) => writePostPage(template, post)));
  await writeHomePage(template, sections, allEntries, mediumPosts);
  await writeReviewsLandingPage(
    template,
    sections.filter((section) => section.outputDir.startsWith("reviews"))
  );
}

async function collectPosts(section) {
  const sourceRoot = path.join(rootDir, section.sourceDir);
  const files = await walkMarkdown(sourceRoot);
  const posts = await Promise.all(
    files.map(async (filePath) => {
      const relativeSource = normalizePath(path.relative(rootDir, filePath));
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = matter(raw);
      const fallbackTitle = titleFromFilename(path.basename(filePath, path.extname(filePath)));
      const strippedMarkdown = stripLeadingHeading(parsed.content);
      const html = marked.parse(strippedMarkdown);
      const explicitDate = parsed.data.date ? new Date(parsed.data.date) : null;
      const validDate = explicitDate && !Number.isNaN(explicitDate.valueOf()) ? explicitDate : null;
      const slug = normalizeSlug(parsed.data.slug || path.basename(filePath, path.extname(filePath)));
      const postUrlDir = normalizePath(path.join(section.outputDir, slug));
      const outputFile = path.join(distDir, postUrlDir, "index.html");
      const title = parsed.data.title || extractFirstHeading(parsed.content) || fallbackTitle;
      const summary =
        parsed.data.description ||
        extractExcerpt(strippedMarkdown) ||
        `A ${section.title.toLowerCase()} entry from Kanan's notebook.`;
      const accent = parsed.data.accent || accentForSlug(slug);

      return {
        section,
        sourcePath: relativeSource,
        sourceFile: filePath,
        outputFile,
        urlDir: postUrlDir,
        title,
        summary,
        html,
        slug,
        date: validDate,
        dateLabel: validDate ? formatDate(validDate) : "Undated",
        yearLabel: validDate ? String(validDate.getUTCFullYear()) : "----",
        readingLabel: parsed.data.reading_time || readingTime(strippedMarkdown),
        meta: {
          author: parsed.data.author || "",
          year: parsed.data.year || "",
          rating: parsed.data.rating || "",
          accent,
        },
      };
    })
  );

  return posts.sort(sortByDateDesc);
}

async function walkMarkdown(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          return walkMarkdown(fullPath);
        }

        if (entry.isFile() && fullPath.toLowerCase().endsWith(".md")) {
          return [fullPath];
        }

        return [];
      })
    );

    return items.flat().sort();
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeHomePage(template, allSections, allEntries, mediumPosts) {
  const homeFile = path.join(distDir, "index.html");
  const latestPosts = allEntries.slice(0, 6);
  const content = `
    <fieldset class="block">
      <legend>Profile</legend>
      <div class="intro-layout">
        <div class="intro-copy">
          <span class="eyebrow">Personal Website</span>
          <h1>Kanan Husayn</h1>
          <p class="lead">
            Cybersecurity researcher based in Budapest, interested in AI,
            blockchain, and systems. Occasionally caffeinated, usually with a
            guitar nearby.
          </p>
          <p>
            A personal notebook for technical essays, slower thoughts, and
            reviews worth returning to.
          </p>
        </div>
        <aside class="status-panel">
          <div class="status-row"><span>Location</span><strong>Budapest, Hungary</strong></div>
          <div class="status-row"><span>Focus</span><strong>Cybersecurity + AI</strong></div>
          <div class="status-row"><span>Sections</span><strong>Rants, Tech, Reviews</strong></div>
          <div class="status-row"><span>Updated</span><strong>${formatDate(new Date())}</strong></div>
        </aside>
      </div>
    </fieldset>

    <fieldset class="block">
      <legend>Latest Files</legend>
      ${renderFileList(latestPosts, homeFile)}
    </fieldset>

    <div class="section-grid">
      ${allSections
        .filter((section) => section.key !== "books" && section.key !== "movies")
        .map((section) => renderSectionPreview(section, homeFile))
        .join("\n")}
      <fieldset class="block">
        <legend>Medium</legend>
        <p class="section-copy">
          Longer technical writing mirrored from Medium and fetched at build time.
        </p>
        ${renderFileList(mediumPosts.slice(0, 4), homeFile, true)}
        <a class="section-link" href="https://medium.com/@kananhusayn" target="_blank" rel="noopener noreferrer">
          Open Medium profile
        </a>
      </fieldset>
      <fieldset class="block">
        <legend>Reviews</legend>
        <p class="section-copy">
          Books on the shelf, films in the archive.
        </p>
        <div class="reviews-split">
          <div>
            <h2 class="subheading">Books</h2>
            ${renderBookGrid(
              allSections.find((section) => section.key === "books")?.posts || [],
              homeFile,
              4
            )}
          </div>
          <div>
            <h2 class="subheading">Movies</h2>
            ${renderMovieGrid(
              (allSections.find((section) => section.key === "movies")?.posts || []).slice(0, 4),
              homeFile
            )}
          </div>
        </div>
        <a class="section-link" href="${dirLink(homeFile, path.join(distDir, "reviews", "index.html"))}">
          Open reviews
        </a>
      </fieldset>
    </div>
  `;

  const html = renderPage(template, {
    pageTitle: "Kanan Husayn",
    activeNav: "home",
    bodyClass: "home-page",
    content,
    currentFile: homeFile,
    metaDescription:
      "A static personal blog with philosophical writing, technical essays, and reviews.",
  });

  await writeFile(homeFile, html);
}

async function writeSectionPage(template, section) {
  const sectionFile = path.join(distDir, section.outputDir, "index.html");
  const listMarkup =
    section.listStyle === "books"
      ? renderBookGrid(section.posts, sectionFile)
      : section.listStyle === "movies"
        ? renderMovieGrid(section.posts, sectionFile)
        : renderFileList(section.posts, sectionFile);
  const mediumMarkup =
    section.key === "tech"
      ? `
        <div class="archive-block">
          <h2 class="subheading">Medium Archive</h2>
          <p class="section-copy">
            External essays from Medium. These links open off-site, but the list is refreshed automatically during builds.
          </p>
          ${renderFileList(section.mediumPosts || [], sectionFile)}
        </div>
      `
      : "";
  const content = `
    <fieldset class="block">
      <legend>${section.title}</legend>
      <p class="section-copy">${section.intro}</p>
      ${listMarkup}
      ${mediumMarkup}
    </fieldset>
  `;

  const html = renderPage(template, {
    pageTitle: `${section.title} | Kanan Husayn`,
    activeNav: section.outputDir.startsWith("reviews") ? "reviews" : section.key,
    bodyClass: `section-page section-${section.key}`,
    content,
    currentFile: sectionFile,
    metaDescription: section.intro,
  });

  await writeFile(sectionFile, html);
}

async function writeReviewsLandingPage(template, reviewSections) {
  const reviewsFile = path.join(distDir, "reviews", "index.html");
  const booksSection = reviewSections.find((section) => section.key === "books");
  const moviesSection = reviewSections.find((section) => section.key === "movies");
  const content = `
    <fieldset class="block">
      <legend>Reviews</legend>
      <p class="section-copy">
        A combined archive for books and movies, kept deliberately simple.
      </p>
      <div class="reviews-stack">
        <div>
          <h2 class="subheading">Book Reviews</h2>
          ${renderBookGrid(booksSection?.posts || [], reviewsFile)}
          <a class="section-link" href="${dirLink(reviewsFile, path.join(distDir, "reviews", "books", "index.html"))}">
            Open book archive
          </a>
        </div>
        <div>
          <h2 class="subheading">Movie Reviews</h2>
          ${renderMovieGrid(moviesSection?.posts || [], reviewsFile)}
          <a class="section-link" href="${dirLink(reviewsFile, path.join(distDir, "reviews", "movies", "index.html"))}">
            Open movie archive
          </a>
        </div>
      </div>
    </fieldset>
  `;

  const html = renderPage(template, {
    pageTitle: "Reviews | Kanan Husayn",
    activeNav: "reviews",
    bodyClass: "section-page reviews-page",
    content,
    currentFile: reviewsFile,
    metaDescription: "Book and movie reviews from Kanan Husayn.",
  });

  await writeFile(reviewsFile, html);
}

async function writePostPage(template, post) {
  const relatedPosts = post.section.posts.filter((entry) => entry.slug !== post.slug).slice(0, 4);
  const breadcrumbs = [
    { label: "Home", target: path.join(distDir, "index.html") },
    post.section.outputDir.startsWith("reviews")
      ? { label: "Reviews", target: path.join(distDir, "reviews", "index.html") }
      : null,
    { label: post.section.title, target: path.join(distDir, post.section.outputDir, "index.html") },
  ].filter(Boolean);

  const content = `
    <fieldset class="block">
      <legend>${escapeHtml(post.title)}</legend>
      <nav class="breadcrumbs">
        ${breadcrumbs
          .map((item) => `<a href="${dirLink(post.outputFile, item.target)}">${item.label}</a>`)
          .join('<span class="crumb-sep">/</span>')}
      </nav>
      <header class="reading-header">
        <span class="eyebrow">${post.section.title}</span>
        <h1>${escapeHtml(post.title)}</h1>
        <div class="reading-meta">
          <span>${post.dateLabel}</span>
          <span>${post.readingLabel}</span>
          ${post.meta.author ? `<span>${escapeHtml(post.meta.author)}</span>` : ""}
          ${post.meta.rating ? `<span>${escapeHtml(post.meta.rating)}</span>` : ""}
        </div>
        <p class="lede">${escapeHtml(post.summary)}</p>
      </header>
      <div class="prose">
        ${post.html}
      </div>
    </fieldset>

    <fieldset class="block">
      <legend>Nearby Files</legend>
      ${renderFileList(relatedPosts, post.outputFile, true)}
    </fieldset>
  `;

  const html = renderPage(template, {
    pageTitle: `${post.title} | Kanan Husayn`,
    activeNav: post.section.outputDir.startsWith("reviews") ? "reviews" : post.section.key,
    bodyClass: `post-page post-${post.section.key}`,
    content,
    currentFile: post.outputFile,
    metaDescription: post.summary,
  });

  await writeFile(post.outputFile, html);
}

function renderPage(template, options) {
  const now = new Date();
  const buildTime = now.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: true });
  const tokens = {
    "{{PAGE_TITLE}}": escapeHtml(options.pageTitle),
    "{{BODY_CLASS}}": escapeHtml(options.bodyClass || ""),
    "{{META_DESCRIPTION}}": escapeHtml(options.metaDescription || ""),
    "{{NAVIGATION}}": renderNavigation(options.currentFile, options.activeNav),
    "{{CONTENT}}": options.content,
    "{{STYLESHEET}}": fileLink(options.currentFile, path.join(distDir, "assets", "site.css")),
    "{{BUILD_TIME}}": escapeHtml(buildTime),
    "{{ROOT_PATH}}": computeRootPath(options.currentFile),
  };

  return Object.entries(tokens).reduce(
    (result, [token, value]) => result.replaceAll(token, value),
    template
  );
}

function computeRootPath(currentFile) {
  const rel = path.relative(path.dirname(currentFile), distDir);
  const norm = normalizePath(rel || ".");
  return norm === "." ? "./" : norm + "/";
}

function renderNavigation(currentFile, activeNav) {
  const items = [
    { key: "home", label: "Home", target: path.join(distDir, "index.html") },
    { key: "rants", label: "Rants", target: path.join(distDir, "rants", "index.html") },
    { key: "tech", label: "Tech", target: path.join(distDir, "tech", "index.html") },
    { key: "reviews", label: "Reviews", target: path.join(distDir, "reviews", "index.html") },
  ];

  return items
    .map((item) => {
      const activeClass = item.key === activeNav ? " is-active" : "";
      return `<a class="nav-tab${activeClass}" href="${dirLink(currentFile, item.target)}">${item.label}</a>`;
    })
    .join("");
}

function renderSectionPreview(section, currentFile) {
  const sectionTarget = path.join(distDir, section.outputDir, "index.html");
  return `
    <fieldset class="block">
      <legend>${escapeHtml(section.title)}</legend>
      <p class="section-copy">${section.intro}</p>
      ${renderFileList(section.posts.slice(0, 4), currentFile, true)}
      <a class="section-link" href="${dirLink(currentFile, sectionTarget)}">Open ${escapeHtml(section.shortLabel)}</a>
    </fieldset>
  `;
}

function renderFileList(posts, currentFile, compact = false) {
  if (!posts.length) {
    return `<p class="empty-state">No entries yet.</p>`;
  }

  return `
    <ul class="file-list${compact ? " compact" : ""}">
      ${posts
        .map((post) => {
          const extraMeta = [];
          if (post.section.key === "books" && post.meta.author) {
            extraMeta.push(post.meta.author);
          }
          if (post.section.key === "movies" && post.meta.year) {
            extraMeta.push(post.meta.year);
          }

          return `
            <li class="file-row">
              <a class="file-link" href="${resolvePostHref(post, currentFile)}"${post.isExternal ? ' target="_blank" rel="noopener noreferrer"' : ""}>
                <span class="file-icon">${post.section.icon}</span>
                <span class="file-name">${escapeHtml(post.title)}</span>
              </a>
              <span class="file-meta">${formatListMeta(post, extraMeta)}</span>
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

function renderBookGrid(posts, currentFile, limit = posts.length) {
  const entries = posts.slice(0, limit);
  if (!entries.length) {
    return `<p class="empty-state">No books on the shelf yet.</p>`;
  }

  return `
    <div class="book-grid">
      ${entries
        .map(
          (post) => {
            const rating = post.meta.rating || "";
            return `
            <a class="book-card" href="${dirLink(currentFile, post.outputFile)}" style="${escapeHtml(bookDisplayStyle(post))}">
              <span class="book-spine"></span>
              <span class="book-title">${escapeHtml(post.title)}</span>
              <div class="book-foot">
                <span class="book-meta">${escapeHtml(post.meta.author || post.yearLabel)}</span>
                ${rating ? `<span class="book-rating">${escapeHtml(rating)}</span>` : ""}
              </div>
            </a>
          `;
          }
        )
        .join("")}
    </div>
  `;
}

function renderMovieGrid(posts, currentFile, limit = posts.length) {
  const entries = posts.slice(0, limit);
  if (!entries.length) {
    return `<p class="empty-state">No films in the archive yet.</p>`;
  }

  return `
    <div class="movie-grid">
      ${entries
        .map(
          (post) => {
            const year = post.meta.year || post.yearLabel || "";
            const rating = post.meta.rating || "";
            return `
            <a class="movie-card" href="${dirLink(currentFile, post.outputFile)}" style="${escapeHtml(movieDisplayStyle(post))}">
              <div class="movie-band">
                ${year ? `<span class="movie-badge">${escapeHtml(year)}</span>` : ""}
              </div>
              <div class="movie-body">
                <span class="movie-title">${escapeHtml(post.title)}</span>
                ${rating ? `<span class="movie-rating">${escapeHtml(rating)}</span>` : ""}
              </div>
            </a>
          `;
          }
        )
        .join("")}
    </div>
  `;
}

function formatListMeta(post, extraMeta) {
  if (post.isExternal) {
    const values = [];
    if (post.meta.sourceLabel) {
      values.push(post.meta.sourceLabel);
    }
    if (post.date) {
      values.push(post.yearLabel);
    }
    return escapeHtml(values.join(" / ") || "External");
  }

  if (post.section.key === "movies" && post.meta.year) {
    return `Film ${escapeHtml(post.meta.year)}`;
  }

  const values = [...extraMeta];

  if (post.section.key === "books") {
    values.push(post.yearLabel);
  } else if (post.date) {
    values.push(post.yearLabel);
  } else if (!values.length) {
    values.push("Undated");
  }

  return escapeHtml(values.join(" / "));
}

function resolvePostHref(post, currentFile) {
  if (post.isExternal) {
    return post.externalUrl;
  }

  return dirLink(currentFile, post.outputFile);
}

function readingTime(markdown) {
  const plain = markdown.replace(/[#_*`>\-\[\]\(\)!]/g, " ");
  const words = plain.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
}

function extractFirstHeading(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function stripLeadingHeading(markdown) {
  return markdown.replace(/^\s*#\s+.+\r?\n+/, "");
}

function extractExcerpt(markdown) {
  const stripped = markdown
    .replace(/^#.*$/gm, "")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return stripped.split(". ").slice(0, 2).join(". ").trim();
}

function titleFromFilename(name) {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeSlug(slug) {
  return slug
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function accentForSlug(slug) {
  const palette = ["#98a7d4", "#c6a98f", "#90b4ab", "#b79ac8", "#7f9bb7", "#b8a17f"];
  let total = 0;
  for (const char of slug) {
    total += char.charCodeAt(0);
  }
  return palette[total % palette.length];
}

function bookDisplayStyle(post) {
  return `--book-accent: ${post.meta.accent};`;
}

function movieDisplayStyle(post) {
  return `--movie-accent: ${post.meta.accent};`;
}

function stringSignature(value) {
  let total = 0;
  for (const char of String(value)) {
    total += char.charCodeAt(0);
  }
  return total;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function sortByDateDesc(a, b) {
  if (a.date && b.date) {
    return b.date - a.date;
  }
  if (a.date) {
    return -1;
  }
  if (b.date) {
    return 1;
  }
  return a.title.localeCompare(b.title);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function relativePath(fromFile, toTarget) {
  const relative = path.relative(path.dirname(fromFile), toTarget);
  return normalizePath(relative || ".");
}

function fileLink(fromFile, targetFile) {
  return relativePath(fromFile, targetFile);
}

function dirLink(fromFile, targetIndexFile) {
  const targetDir = path.dirname(targetIndexFile);
  let relative = relativePath(fromFile, targetDir);
  if (relative === ".") {
    relative = "";
  }
  if (relative && !relative.endsWith("/")) {
    relative += "/";
  }
  return relative || "./";
}

async function copyFile(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function copyCnameIfPresent() {
  const cnamePath = path.join(rootDir, "CNAME");
  try {
    await fs.access(cnamePath);
    await copyFile(cnamePath, path.join(distDir, "CNAME"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function writeFile(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}

async function fetchMediumPosts() {
  try {
    const response = await fetch(mediumFeedUrl, {
      headers: {
        "user-agent": "personaweb-static-site",
      },
    });

    if (!response.ok) {
      throw new Error(`Unexpected response ${response.status}`);
    }

    const xml = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
      trimValues: true,
    });
    const parsed = parser.parse(xml);
    const channel = parsed?.rss?.channel;
    const items = toArray(channel?.item);

    return items.map((item) => {
      const htmlContent = item["content:encoded"] || "";
      const feedTitle = normalizeMediumTitle(item.title || "Untitled");
      const title = titleNeedsRepair(feedTitle)
        ? normalizeMediumTitle(extractHtmlHeading(htmlContent) || feedTitle)
        : feedTitle;
      const date = item.pubDate ? new Date(item.pubDate) : null;
      const validDate = date && !Number.isNaN(date.valueOf()) ? date : null;
      const summary = extractExcerpt(stripHtml(htmlContent)) || "Medium article";

      return {
        section: {
          key: "tech",
          title: "Tech",
          icon: "MD",
        },
        title,
        slug: normalizeSlug(title),
        summary,
        date: validDate,
        dateLabel: validDate ? formatDate(validDate) : "Undated",
        yearLabel: validDate ? String(validDate.getUTCFullYear()) : "----",
        readingLabel: "On Medium",
        isExternal: true,
        externalUrl: normalizeMediumLink(item.link || "https://medium.com/@kananhusayn"),
        meta: {
          sourceLabel: "Medium",
        },
      };
    });
  } catch (error) {
    console.warn(`Unable to fetch Medium feed: ${error.message}`);
    return [];
  }
}

function toArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function stripHtml(value) {
  return String(value)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMediumTitle(title) {
  return String(title)
    .replace(/â€¦|…/g, "...")
    .replace(/â€”|â€“|[–—]/g, "-")
    .replace(/[\u2000-\u200f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMediumLink(link) {
  return String(link).replace(/\?source=.*$/, "");
}

function extractHtmlHeading(value) {
  const match = String(value).match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  return match ? stripHtml(match[1]) : "";
}

function titleNeedsRepair(title) {
  return /(\.\.\.|â€¦|…)$/.test(title) || /â./.test(title);
}
