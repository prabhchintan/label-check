/* Label Check, client logic.
   Plain JavaScript, no framework, no build step. All URLs are relative so the
   app works at a subdomain root or under a path like /ttb/. */

"use strict";

const $ = (id) => document.getElementById(id);

const state = {
  images: [], // File[] selected for single verification (a whole label set)
  realManifest: [],
  synthManifest: [],
  busyTimer: null,
  liveMode: true,
  runSeq: 0, // invalidates stale runs and their deferred follow-ups
  batchRunning: false,
  lastResult: null, // settled single-label result, for the audit-record export
};

const VERIFY_TIMEOUT_MS = 60_000;
// A peak-season importer dump is 200-300 labels; we accept up to 500 in one go.
// Images are downscaled lazily inside the concurrency cap (never all at once),
// so memory stays flat no matter how big the pile.
const MAX_BATCH = 500;
const MAX_SET = 5; // one product's sides: front, back, neck, strip, spare
const ACCEPTED_TYPES = /^image\/(png|jpe?g|webp|gif)$/;
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

function scrollToEl(el) {
  el.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "nearest" });
}

/** Free blob: object URLs inside a container before its contents are replaced. */
function revokeBlobUrls(container) {
  for (const img of container.querySelectorAll('img[src^="blob:"]')) {
    URL.revokeObjectURL(img.src);
  }
}

/* ---------------- views ---------------- */
function showView(view) {
  $("view-landing").hidden = view !== "landing";
  $("view-tool").hidden = view !== "tool";
  window.scrollTo({ top: 0 });
}

/**
 * All view navigation goes through the URL hash, so the browser's Back
 * button (and a phone's swipe-back) walks between the gallery, the tool,
 * and individual examples instead of leaving the site.
 */
function navigate(hash) {
  if (location.hash === hash) routeFromHash();
  else location.hash = hash;
}

$("home-link").addEventListener("click", () => navigate(""));
$("open-tool").addEventListener("click", () => navigate("#check"));
window.addEventListener("hashchange", () => routeFromHash());

/* ---------------- mode banner ---------------- */
fetch("api/health")
  .then((r) => r.json())
  .then((h) => {
    state.liveMode = h.mode === "live";
    $("demo-banner").hidden = state.liveMode;
  })
  .catch(() => {});

/* ---------------- manifests ---------------- */
Promise.all([
  fetch("real-labels/manifest.json").then((r) => r.json()),
  fetch("demo-labels/manifest.json").then((r) => r.json()),
])
  .then(([real, synth]) => {
    state.realManifest = real.records.map((r) => ({ ...r, kind: "real" }));
    state.synthManifest = synth.map((d) => ({
      ...d,
      images: [d.image],
      kind: "synthetic",
    }));
    renderLanding();
    renderDock();
    setupGalleryReveal();
    routeFromHash();
  })
  .catch(() => {
    $("landing-gallery").innerHTML =
      '<p class="muted">Examples could not be loaded. Please refresh.</p>';
  });

function routeFromHash() {
  const m = location.hash.match(/^#demo-(.+)$/);
  if (m) {
    const d = [...state.realManifest, ...state.synthManifest].find(
      (x) => x.id === m[1],
    );
    if (d) {
      showView("tool");
      runDemo(d);
      return;
    }
  }
  if (location.hash === "#batch-demo" || location.hash === "#stress") {
    showView("tool");
    runStressDemo();
    return;
  }
  if (location.hash === "#check" || location.hash === "#batch") {
    showView("tool");
    return;
  }
  showView("landing");
}

/* ---------------- landing gallery ---------------- */
const CHIP_WORDS = {
  GREEN: "Passes",
  YELLOW: "Human review",
  RED: "Problem found",
};

function renderLanding() {
  const grid = $("landing-gallery");
  grid.innerHTML = "";
  for (const d of state.realManifest) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "tile";
    tile.innerHTML = `
      <span class="tile-img">
        <img src="${d.images[0]}" alt="${escapeHtml(d.title)}" loading="lazy" decoding="async" />
      </span>
      <span class="tile-title">${escapeHtml(d.short || d.title)}</span>
      <span class="tile-meta">
        <span>${d.date_issued.slice(-4)} · ${escapeHtml(d.origin)}</span>
        <span class="tile-ttbid">TTB ${d.ttbid}</span>
      </span>`;
    tile.addEventListener("click", () => navigate(`#demo-${d.id}`));
    grid.appendChild(tile);
  }
}

// The sample gallery starts under a frosted glass pane; the first real scroll
// (or the frame entering view) lifts it. Reduced-motion users get it revealed
// up front, no hidden content. Reveal happens once, then listeners detach.
function setupGalleryReveal() {
  const zone = document.querySelector(".reveal-zone");
  if (!zone) return;
  let done = false;
  const reveal = () => {
    if (done) return;
    done = true;
    zone.classList.add("revealed");
    window.removeEventListener("scroll", onScroll);
    if (io) io.disconnect();
  };
  const onScroll = () => { if (window.scrollY > 60) reveal(); };
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { reveal(); return; }
  let io = null;
  const frame = zone.querySelector(".gallery-frame");
  if ("IntersectionObserver" in window && frame) {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.25) reveal();
    }, { threshold: [0.25], rootMargin: "0px 0px -10% 0px" });
    io.observe(frame);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
}

function renderDock() {
  const dock = $("dock-items");
  dock.innerHTML = "";
  for (const d of state.realManifest) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dock-item";
    b.title = d.title;
    b.innerHTML = `<img src="${d.images[0]}" alt="${escapeHtml(d.title)}" loading="lazy" decoding="async" />`;
    b.addEventListener("click", () => navigate(`#demo-${d.id}`));
    dock.appendChild(b);
  }
}

async function runDemo(demo) {
  // Owns the run from the first await: a second click invalidates this one
  // so a slow image fetch can't pair demo A's images with demo B's form.
  const seq = ++state.runSeq;
  clearBatchUI();

  $("brand_name").value = demo.application.brand_name;
  $("class_type").value = demo.application.class_type;
  $("abv").value = demo.application.abv;
  $("net_contents").value = demo.application.net_contents;
  // Optional declarations default to auto-detect; reset between demos.
  $("source").value = demo.application.source || "";
  $("beverage_type").value = demo.application.beverage_type || "";
  // A demo is the field-by-field story; open the application so it shows.
  $("app-details").open = true;

  // Fetch the demo images and treat them like a user upload, the
  // verification path is identical to a real one.
  try {
    const images = await Promise.all(
      demo.images.map(async (rel) => {
        const blob = await (await fetch(rel, { cache: "force-cache" })).blob();
        return new File([blob], rel.split("/").pop(), {
          type: blob.type || "image/png",
        });
      }),
    );
    if (seq !== state.runSeq) return;
    state.images = images;
  } catch {
    if (seq === state.runSeq) {
      showError("Could not load the example images. Please refresh and try again.");
    }
    return;
  }
  renderThumbs();
  verify(seq);
}

/* ---------------- image selection ---------------- */
const dropzone = $("dropzone");
const fileInput = $("file-input");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", () => {
  addImages(Array.from(fileInput.files || []));
  fileInput.value = "";
});
["dragover", "dragenter"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  }),
);
dropzone.addEventListener("drop", (e) => {
  addImages(Array.from((e.dataTransfer && e.dataTransfer.files) || []));
});

/**
 * Phone photos arrive at 4-8 MB; the model needs nowhere near that. Anything
 * over ~1.5 MB is downscaled in the browser before upload, faster on the
 * wire, faster to read, identical result. Bundled examples are already small
 * and skip this path (their bytes must stay identical for demo mode).
 */
async function prepImage(file) {
  if (file.size <= 1_500_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) =>
      canvas.toBlob(res, "image/jpeg", 0.85),
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
      type: "image/jpeg",
    });
  } catch {
    return file;
  }
}

function addImages(files) {
  if (!files.length) return;
  // The picker's `accept` doesn't apply to drag-and-drop: filter here so a
  // dragged HEIC or PDF gets a sentence, not a broken thumbnail.
  const usable = files.filter((f) => ACCEPTED_TYPES.test(f.type));
  const skipped = files.filter((f) => !ACCEPTED_TYPES.test(f.type));
  const notes = [];
  if (skipped.length) {
    const names = skipped.slice(0, 3).map((f) => `"${f.name}"`).join(", ");
    notes.push(
      `Skipped ${names}${skipped.length > 3 ? ` and ${skipped.length - 3} more` : ""}, please use PNG, JPEG, WebP, or GIF images.`,
    );
  }
  const room = MAX_BATCH - state.images.length;
  const added = usable.slice(0, Math.max(0, room));
  if (usable.length > added.length) {
    notes.push(`Up to ${MAX_BATCH} images at once; the first ${MAX_BATCH} are kept.`);
  }
  if (notes.length) showNotice(notes.join(" "));
  if (!added.length) return;
  // Store the raw files. Downscaling happens lazily at send time (a single set)
  // or inside the batch concurrency cap, so a 500-image pile never decodes all
  // at once and memory stays flat.
  state.images = state.images.concat(added);
  renderThumbs();
  updateCta();
}

const THUMB_PREVIEW = 12;
function renderThumbs() {
  const box = $("thumbs");
  revokeBlobUrls(box);
  box.innerHTML = "";
  const n = state.images.length;
  dropzone.classList.toggle("has-images", n > 0);
  if (!n) return;
  // A small set shows every thumb with a remove control; a big pile shows a
  // light preview plus a count, so 500 images don't mean 500 decoded thumbnails.
  const showAll = n <= THUMB_PREVIEW;
  const shown = showAll ? state.images : state.images.slice(0, THUMB_PREVIEW - 2);
  shown.forEach((file, i) => {
    const t = document.createElement("span");
    t.className = "thumb";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    img.alt = file.name;
    img.className = "zoomable";
    img.loading = "lazy";
    img.title = "Click to enlarge";
    t.appendChild(img);
    if (showAll) {
      const x = document.createElement("button");
      x.type = "button";
      x.className = "thumb-remove";
      x.setAttribute("aria-label", `Remove ${file.name}`);
      x.textContent = "×";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        state.images.splice(i, 1);
        renderThumbs();
        updateCta();
      });
      t.appendChild(x);
    }
    box.appendChild(t);
  });
  if (!showAll) {
    const more = document.createElement("span");
    more.className = "thumb-more";
    more.textContent = `+${n - shown.length} more`;
    box.appendChild(more);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "thumb-clear";
    clear.textContent = "Clear";
    clear.addEventListener("click", () => {
      state.images = [];
      renderThumbs();
      updateCta();
    });
    box.appendChild(clear);
  }
}

/* ---------------- one action, single or batch ----------------
   The application fields describe ONE product. Fill them (or drop a single
   set) and it runs as one careful check; leave them blank and drop many and
   each image is screened on its own. No mode to pick: the inputs decide. */
const APP_FIELDS = ["brand_name", "class_type", "abv", "net_contents", "source", "beverage_type"];
function hasFields() {
  return APP_FIELDS.some((k) => $(k).value.trim() !== "");
}
function isBatch() {
  return state.images.length >= 2 && !hasFields();
}
function updateCta() {
  const btn = $("verify-btn");
  btn.textContent = isBatch() ? `Screen ${state.images.length} labels` : "Check label";
  // The stress demo is a "try it with no upload" affordance; step aside once
  // the reviewer has their own images in hand.
  $("stress-btn").hidden = state.images.length > 0;
}
function dispatch() {
  if (state.batchRunning) return;
  if (!state.images.length) {
    showError("Drop a label image first.");
    return;
  }
  if (isBatch()) runBatchFromImages();
  else verify();
}

$("verify-btn").addEventListener("click", () => dispatch());
$("stress-btn").addEventListener("click", () => navigate("#stress"));
// Enter in any field, or changing one, keeps the action label honest.
$("verify-form").addEventListener("submit", (e) => {
  e.preventDefault();
  dispatch();
});
$("verify-form").addEventListener("input", updateCta);

/** Each dropped image becomes its own label, screened for the mandatory
    elements and an exact government warning. This is the 300-label path. */
function runBatchFromImages() {
  clearResult();
  const jobs = state.images.map((f) => ({
    name: f.name || "label",
    files: [f],
    thumbUrl: URL.createObjectURL(f),
    labelOnly: true,
    prep: true, // downscaled inside the concurrency cap, never all at once
  }));
  runBatch(jobs);
}

function tierOf(fields) {
  let tier = "GREEN";
  for (const f of fields) {
    if (f.status === "fail" || f.status === "missing") return "RED";
    if (f.status === "review") tier = "YELLOW";
  }
  return tier;
}

function summaryOf(fields) {
  const failing = fields.filter((f) => f.status === "fail" || f.status === "missing");
  const reviewing = fields.filter((f) => f.status === "review");
  if (failing.length)
    return `Problems found: ${failing.map((f) => f.field.toLowerCase()).join(", ")}.`;
  if (reviewing.length)
    return `Needs human review: ${reviewing.map((f) => f.field.toLowerCase()).join(", ")}.`;
  return "All checks passed. Ready for agent sign-off.";
}

/** Just the field list (no verdict-word prefix), for the printed verdict bar
    where the bold verdict word is already shown, so it never doubles up. */
function verdictDetail(fields) {
  const failing = fields.filter((f) => f.status === "fail" || f.status === "missing");
  const reviewing = fields.filter((f) => f.status === "review");
  if (failing.length) return failing.map((f) => f.field.toLowerCase()).join(", ");
  if (reviewing.length) return reviewing.map((f) => f.field.toLowerCase()).join(", ");
  return "all seven elements verified";
}

async function verify(seq = ++state.runSeq) {
  clearResult();
  clearBatchUI();
  if (!state.images.length) {
    showError("Drop a label image first.");
    return;
  }
  setBusy(true);
  // One product's label set is at most five sides. Downscale them now (lazily,
  // only these few), and snapshot the set so deferred follow-ups use the images
  // this run checked, not whatever is selected by the time they fire.
  const runImages = await Promise.all(state.images.slice(0, MAX_SET).map(prepImage));
  if (seq !== state.runSeq) return;

  const fd = new FormData();
  for (const f of runImages) fd.append("image", f);
  for (const k of APP_FIELDS) {
    fd.append(k, $(k).value);
  }
  fd.append("defer", "1");

  const t0 = performance.now();
  let res, data;
  try {
    res = await fetch("api/verify", {
      method: "POST",
      body: fd,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    data = await res.json();
  } catch (e) {
    // A newer run owns the screen, this one's failure is nobody's news.
    if (seq !== state.runSeq) return;
    setBusy(false);
    showError(
      e && e.name === "TimeoutError"
        ? "This is taking longer than it should. Please try again."
        : "Could not reach the server. Check your connection and try again.",
    );
    return;
  }
  if (seq !== state.runSeq) return;
  const firstSeconds = (performance.now() - t0) / 1000;
  setBusy(false);

  if (!res.ok) {
    showError(data && data.error ? data.error : "Something went wrong. Please try again.");
    return;
  }
  if (data.unreadable) {
    showNotice(data.verdict.summary);
    return;
  }

  renderResult(data, firstSeconds, runImages);
  resolvePending(data, seq, t0, firstSeconds, runImages);
}

/** Fetch deferred AI opinions and swap them into the rendered rows. */
async function resolvePending(data, seq, t0, firstSeconds, runImages) {
  const pendings = data.verdict.fields
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.pending);
  if (!pendings.length) return;

  await Promise.all(
    pendings.map(async ({ f, i }) => {
      let updated = null;
      const tStart = performance.now();
      try {
        if (f.pending === "judgment") {
          const r = await fetch("api/judge", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              field: f.field,
              application: f.application,
              label: f.label,
            }),
            signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
          });
          if (r.ok) updated = await r.json();
        } else if (f.pending === "confirmation") {
          const fd = new FormData();
          for (const file of runImages) fd.append("image", file);
          const r = await fetch("api/confirm-warning", {
            method: "POST",
            body: fd,
            signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
          });
          if (r.ok) updated = await r.json();
        }
      } catch {
        /* keep the provisional row */
      }
      if (seq !== state.runSeq) return;
      if (updated && !updated.error) {
        updated._ms = performance.now() - tStart;
        data.verdict.fields[i] = updated;
      } else {
        // Keep the provisional finding, but say the follow-up never landed,
        // a quiet downgrade would look like a settled answer.
        delete data.verdict.fields[i].pending;
        data.verdict.fields[i].explanation +=
          " (The AI follow-up was unavailable, provisional result; please compare by eye.)";
      }
      updateRow(i, data.verdict.fields[i]);
    }),
  );
  if (seq !== state.runSeq) return;

  // Settle the banner with the final tier and full timing.
  const fields = data.verdict.fields;
  const tier = tierOf(fields);
  const banner = document.querySelector("#result .tier-banner");
  if (banner) {
    banner.className = `tier-banner ${tier}`;
    banner.querySelector(".banner-text").textContent =
      `${TIER_ICONS[tier]} ${summaryOf(fields)}`;
  }
  // Deferred rows may have resolved into review items needing a decision.
  renderActionPanel();
}

function setBusy(b) {
  $("verify-btn").disabled = b;
  $("busy").hidden = !b;
  if (b) {
    const start = Date.now();
    $("busy-text").textContent = "Reading the label set…";
    state.busyTimer = setInterval(() => {
      $("busy-seconds").textContent = ((Date.now() - start) / 1000).toFixed(1) + "s";
    }, 100);
  } else if (state.busyTimer) {
    clearInterval(state.busyTimer);
    state.busyTimer = null;
    $("busy-seconds").textContent = "";
  }
}

const TIER_ICONS = { GREEN: "✓", YELLOW: "⚠", RED: "✗" };
const STATUS_ICONS = { pass: "✓", review: "⚠", fail: "✗", missing: "✗" };
const STATUS_WORDS = {
  pass: "Match",
  review: "Review",
  fail: "Mismatch",
  missing: "Missing",
};

function rowHtml(f, i) {
  const time =
    !f.pending && f._ms ? `<span class="row-time" title="time for this AI follow-up">${(f._ms / 1000).toFixed(1)}s</span>` : "";
  // The decision itself happens in the action panel up top; once made, the row
  // shows it (with a "change" affordance) so the table is a complete record.
  const decided =
    typeof i === "number" && !f.pending && f.status === "review" && f.agentDecision
      ? ` <span class="decided-tag ${f.agentDecision}">${f.agentDecision === "accept" ? "✓ Accepted" : "✗ Rejected"}</span> <button class="agent-undo" type="button">change</button>`
      : "";
  const pendingCell = f.pending
    ? `<span class="row-pending"><span class="spinner small" aria-hidden="true"></span> ${f.pending === "judgment" ? "AI judgment…" : "Double-checking…"}</span>`
    : `${STATUS_ICONS[f.status]} ${STATUS_WORDS[f.status]}${f.aiJudgment ? '<span class="ai-tag">AI judgment</span>' : ""}${time}${decided}`;
  const needs = typeof i === "number" && !f.pending && f.status === "review" && !f.agentDecision;
  return `
    <tr data-row="${i}" class="${f.pending ? "is-pending" : ""}${needs ? " needs-decision" : ""}">
      <td><strong>${escapeHtml(f.field)}</strong></td>
      <td>${f.application !== null ? escapeHtml(f.application) : '<span class="explanation">-</span>'}</td>
      <td>${f.label !== null ? escapeHtml(f.label) : '<span class="explanation">not found</span>'}</td>
      <td class="status-cell ${f.pending ? "pending" : f.status}">${pendingCell}</td>
      <td class="explanation">${escapeHtml(f.explanation)}</td>
    </tr>`;
}

function updateRow(i, f) {
  const tr = document.querySelector(`#result tr[data-row="${i}"]`);
  if (!tr) return;
  const tmp = document.createElement("tbody");
  tmp.innerHTML = rowHtml(f, i);
  tr.replaceWith(tmp.firstElementChild);
}

function renderResult(data, firstSeconds, runImages) {
  const v = data.verdict;
  const el = $("result");
  revokeBlobUrls(el);
  const tier = tierOf(v.fields);
  const pendingCount = v.fields.filter((f) => f.pending).length;
  // Held so the audit record reflects the settled state (deferred rows included).
  state.lastResult = { data, firstSeconds, images: runImages };

  // Only what the examiner needs after the verdict: a fanciful name if the
  // reader found one, and an image-quality note only when there was a problem.
  const extras = [];
  if (data.extraction.fanciful_name)
    extras.push(`Fanciful name: “${escapeHtml(data.extraction.fanciful_name)}”`);
  if (data.extraction.image_quality_note)
    extras.push(`Image quality: ${escapeHtml(data.extraction.image_quality_note)}`);

  const thumbs = runImages
    .map(
      (f) =>
        `<img class="zoomable" src="${URL.createObjectURL(f)}" alt="${escapeHtml(f.name)}, click to enlarge" title="Click to enlarge" />`,
    )
    .join("");

  el.innerHTML = `
    <div class="tier-banner ${tier}">
      <span class="banner-text">${TIER_ICONS[tier]} ${escapeHtml(summaryOf(v.fields))}${pendingCount ? " (confirming…)" : ""}</span>
      <span class="timer">First results ${firstSeconds.toFixed(1)}s</span>
    </div>
    <div id="action-panel" class="action-panel" aria-live="polite"></div>
    <div class="result-cols">
      <div class="result-images">${thumbs}</div>
      <div class="result-main">
        <table class="result-table">
          <thead>
            <tr><th>Field</th><th>Application says</th><th>Label shows</th><th>Result</th><th>Why</th></tr>
          </thead>
          <tbody>${v.fields.map((f, i) => rowHtml(f, i)).join("")}</tbody>
        </table>
        ${extras.length ? `<p class="extraction-extras">${extras.join(" · ")}</p>` : ""}
        <div class="result-actions">
          <button id="print-btn" class="btn-record" type="button"><span class="btn-record-icon" aria-hidden="true">⎙</span> Print / Save as PDF</button>
        </div>
      </div>
    </div>
  `;
  const printBtn = $("print-btn");
  if (printBtn) printBtn.addEventListener("click", printRecord);
  renderActionPanel();
  scrollToEl(el);
  // Orient screen-reader and keyboard users on the freshly rendered result
  // region (it is a labeled, focusable landmark, not a live region, so the
  // table and the action panel below it are not double-announced).
  el.focus({ preventScroll: true });
}

/**
 * The action panel: the agent's job, front and center. It sits right under the
 * verdict and tells the agent exactly what needs deciding, with big Accept /
 * Reject buttons per item. As each is decided the panel counts down; when all
 * are done it becomes a single clear outcome (sign off, or send back). The
 * tool's verdict banner never changes, the human decision is kept distinct
 * (auditability), but the call to action is impossible to miss.
 */
function renderActionPanel() {
  const box = $("action-panel");
  if (!box || !state.lastResult) return;
  const fields = state.lastResult.data.verdict.fields;
  const reviews = fields.map((f, i) => ({ f, i })).filter((r) => !r.f.pending && r.f.status === "review");
  if (!reviews.length) {
    box.className = "action-panel";
    box.innerHTML = "";
    return;
  }
  const undecided = reviews.filter((r) => !r.f.agentDecision);
  const accepted = reviews.filter((r) => r.f.agentDecision === "accept").length;
  const rejected = reviews.filter((r) => r.f.agentDecision === "reject").length;
  const hasHardFail = fields.some((f) => !f.pending && (f.status === "fail" || f.status === "missing"));

  if (undecided.length) {
    const n = undecided.length;
    box.className = "action-panel needs";
    box.innerHTML = `
      <div class="action-head">
        <span class="action-head-icon" aria-hidden="true">!</span>
        <span>${n} thing${n > 1 ? "s need" : " needs"} your decision before you sign off</span>
      </div>
      ${undecided
        .map(
          (r) => `
        <div class="action-item" data-row="${r.i}">
          <div class="action-item-text"><strong>${escapeHtml(r.f.field)}</strong><br>${escapeHtml(actionReason(r.f))}</div>
          <div class="action-item-btns">
            <button class="agent-accept big" type="button">✓ Accept</button>
            <button class="agent-reject big" type="button">✗ Reject</button>
          </div>
        </div>`,
        )
        .join("")}
      ${accepted + rejected > 0 ? `<div class="action-progress">${accepted + rejected} of ${reviews.length} decided</div>` : ""}`;
    return;
  }
  // All decided: one clear outcome.
  if (rejected > 0) {
    box.className = "action-panel done rejected";
    box.innerHTML = `<span class="action-icon" aria-hidden="true">✗</span> <strong>Send back to the applicant.</strong> You rejected ${rejected} item${rejected > 1 ? "s" : ""}${accepted ? ` and accepted ${accepted}` : ""}.`;
  } else if (!hasHardFail) {
    box.className = "action-panel done cleared";
    const accCount = reviews.length === 1 ? "the flagged item" : `all ${reviews.length} flagged items`;
    box.innerHTML = `<span class="action-icon" aria-hidden="true">✓</span> <strong>Clear to sign off.</strong> You accepted ${accCount}, and nothing else is wrong.`;
  } else {
    box.className = "action-panel done";
    box.innerHTML = `<span class="action-icon" aria-hidden="true">✓</span> You accepted the flagged items, but hard problems remain on this label.`;
  }
}

/** The decision context shown in the action panel: the explanation, minus the
 *  redundant "it's the agent's call" tail (the buttons already say that). */
function actionReason(f) {
  return f.explanation
    .replace(/,?\s*so whether to accept it is the agent's call\.?$/i, ".")
    .replace(/\s*Flagged for agent confirmation\.?$/i, ".")
    .trim();
}

// Record the agent's Accept/Reject decision (buttons in the action panel; a
// "change" affordance lives on the decided table row).
document.addEventListener("click", (e) => {
  const btn =
    e.target.closest &&
    e.target.closest(".agent-accept, .agent-reject, .agent-undo");
  if (!btn || !btn.closest("#result") || !state.lastResult) return;
  const host = btn.closest("[data-row]");
  if (!host) return;
  const i = Number(host.getAttribute("data-row"));
  const field = state.lastResult.data.verdict.fields[i];
  if (!field) return;
  if (btn.classList.contains("agent-accept")) field.agentDecision = "accept";
  else if (btn.classList.contains("agent-reject")) field.agentDecision = "reject";
  else delete field.agentDecision;
  updateRow(i, field);
  renderActionPanel();
});

function clearResult() {
  revokeBlobUrls($("result"));
  $("result").innerHTML = "";
}

function showError(msg) {
  $("result").innerHTML = `<div class="error-box">${escapeHtml(msg)}</div>`;
}

function showNotice(msg) {
  $("result").innerHTML = `<div class="notice-box">${escapeHtml(msg)}</div>`;
}

/* ---------------- print / save-as-PDF report ---------------- */
/**
 * A richer, printable report, the label beside the verdict, the field table,
 * and the governing citations, rendered into #print-report and handed to the
 * browser's own print/Save-as-PDF. No PDF library (keeps the bundle tiny and the
 * CSP strict); it prints on paper too, which is where a compliance file lives.
 */
const PR_VERDICT_WORD = { GREEN: "Pass", YELLOW: "Needs review", RED: "Problem found" };

function buildPrintReport(lr) {
  const v = lr.data.verdict;
  const tier = tierOf(v.fields);
  const when = new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });
  const imgs = (lr.images || [])
    .map((f) => `<img src="${URL.createObjectURL(f)}" alt="" />`)
    .join("");
  const rows = v.fields
    .map((f) => {
      const tags = [];
      if (f.aiJudgment) tags.push("AI judgment");
      if (f.agentDecision)
        tags.push(`agent ${f.agentDecision === "accept" ? "accepted" : "rejected"}`);
      const tagHtml = tags.length ? ` <span class="pr-tag">(${tags.join(", ")})</span>` : "";
      return `<tr>
        <td class="pr-field">${escapeHtml(f.field)}</td>
        <td>${f.application != null ? escapeHtml(f.application) : "-"}</td>
        <td>${f.label != null ? escapeHtml(f.label) : "not found"}</td>
        <td class="pr-status pr-${f.status}"><span class="pr-mark">${STATUS_ICONS[f.status]}</span> ${STATUS_WORDS[f.status] || f.status}${tagHtml}</td>
        <td class="pr-why">${escapeHtml(f.explanation)}</td>
      </tr>`;
    })
    .join("");
  return `
    <div class="pr-head">
      <div class="pr-brand">Label Check</div>
      <div class="pr-meta">Verification record · ${escapeHtml(when)}</div>
    </div>
    <div class="pr-verdict ${tier}"><span class="pr-mark">${TIER_ICONS[tier]}</span> ${PR_VERDICT_WORD[tier]}${verdictDetail(v.fields) ? `: ${escapeHtml(verdictDetail(v.fields))}` : ""}</div>
    ${imgs ? `<div class="pr-images">${imgs}</div>` : ""}
    <table class="pr-table">
      <thead><tr><th>Field</th><th>Application</th><th>Label</th><th>Result</th><th>Why</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="pr-cites"><strong>Regulatory basis</strong> · 27 CFR 16.21 government warning · 27 CFR 7 malt ABV exemption · 27 CFR 4.36 wine ABV · 27 CFR 5.38 net contents · TTB F 5100.31 application of record</p>
    <p class="pr-note">Triage tool, not an approval: a TTB agent makes the final call. Findings tagged "AI judgment" must be confirmed. Nothing uploaded was stored. Prototype, not an official TTB system.</p>`;
}

function printRecord() {
  if (!state.lastResult) return;
  const box = $("print-report");
  revokeBlobUrls(box);
  box.innerHTML = buildPrintReport(state.lastResult);
  const imgs = Array.from(box.querySelectorAll("img"));
  Promise.all(
    imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve())),
  ).then(() => {
    window.print();
    // Release the object URLs created for this report so repeated prints in a
    // long session do not leak one image set each.
    revokeBlobUrls(box);
  });
}

/* ---------------- lightbox (click a label to inspect it) ---------------- */
const lightbox = $("lightbox");
const lightboxImg = $("lightbox-img");
const lightboxStage = $("lightbox-stage");
let lightboxReturnFocus = null;
let inertedEls = [];

/**
 * Real modal focus trap: while the lightbox is open, mark every other top-level
 * element `inert` so keyboard and screen-reader focus cannot Tab out into the
 * page behind it. Without this, aria-modal="true" misrepresents an inert
 * background a Section 508 reviewer would catch.
 */
function setBackgroundInert(on) {
  if (on) {
    inertedEls = Array.from(document.body.children).filter(
      (el) => el !== lightbox && !el.hasAttribute("inert"),
    );
    inertedEls.forEach((el) => el.setAttribute("inert", ""));
  } else {
    inertedEls.forEach((el) => el.removeAttribute("inert"));
    inertedEls = [];
  }
}

function openLightbox(src, alt) {
  lightboxReturnFocus = document.activeElement;
  lightboxImg.src = src;
  lightboxImg.alt = alt || "Label image, enlarged";
  lightboxStage.classList.remove("zoomed");
  lightbox.hidden = false;
  document.body.style.overflow = "hidden";
  setBackgroundInert(true);
  $("lightbox-close").focus();
}

function closeLightbox() {
  if (lightbox.hidden) return;
  lightbox.hidden = true;
  lightboxImg.removeAttribute("src");
  lightboxStage.classList.remove("zoomed");
  document.body.style.overflow = "";
  setBackgroundInert(false);
  if (lightboxReturnFocus && lightboxReturnFocus.focus) lightboxReturnFocus.focus();
}

// Delegated: any image tagged `zoomable` opens the inspector, wherever it renders.
document.addEventListener("click", (e) => {
  const img = e.target.closest && e.target.closest("img.zoomable");
  if (img) {
    e.preventDefault();
    openLightbox(img.src, img.alt);
  }
});
$("lightbox-close").addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox || e.target === lightboxStage) closeLightbox();
});
lightboxImg.addEventListener("click", () => lightboxStage.classList.toggle("zoomed"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLightbox();
});

/* ---------------- batch ---------------- */
const CONCURRENCY = 8; // parallel in-flight checks; HTTP/2 multiplexes to the Worker
const VALID_TIERS = new Set(["GREEN", "YELLOW", "RED"]);
/** Never let an unexpected server tier become a bad CSS class or a NaN count. */
const safeTier = (t) => (VALID_TIERS.has(t) ? t : "ERROR");

function setBatchBusy(b) {
  state.batchRunning = b;
  $("verify-btn").disabled = b;
  $("stress-btn").disabled = b;
}

/** Clear a batch view (grid, progress, summary, detail) before a single check. */
function clearBatchUI() {
  $("batch-progress").hidden = true;
  $("batch-summary").innerHTML = "";
  const grid = $("batch-grid");
  revokeBlobUrls(grid);
  grid.innerHTML = "";
  $("batch-detail").innerHTML = "";
}

/**
 * The 300-label proof. The peak-season scenario in the brief is an importer
 * dumping 200-300 applications at once; this screens 300 in one pass. It cycles
 * the bundled example sets up to 300 jobs: in demo mode each hits a recorded
 * reading (instant, no spend), and live it is 300 real checks of the engine.
 */
async function runStressDemo() {
  const all = state.realManifest;
  if (!all.length || state.batchRunning) return;
  clearResult();
  setBatchBusy(true);
  $("batch-progress").hidden = false;
  $("progress-text").textContent = "Preparing 300 labels…";
  const loaded = [];
  for (const d of all) {
    try {
      const files = await Promise.all(
        d.images.map(async (rel) => {
          const blob = await (await fetch(rel, { cache: "force-cache" })).blob();
          return new File([blob], rel.split("/").pop(), {
            type: blob.type || "image/png",
          });
        }),
      );
      loaded.push({ d, files });
    } catch {
      /* skip an example that fails to load */
    }
  }
  setBatchBusy(false);
  if (!loaded.length) return;
  const TARGET = 300;
  const jobs = [];
  for (let i = 0; i < TARGET; i++) {
    const { d, files } = loaded[i % loaded.length];
    jobs.push({
      name: `${d.short || d.title} #${Math.floor(i / loaded.length) + 1}`,
      files, // shared raw bytes; demo mode keys on their hash
      thumbUrl: d.images[0],
      fields: d.application,
      labelOnly: false,
    });
  }
  runBatch(jobs, `Stress test: ${TARGET} labels screened in one pass.`);
}

async function runBatch(jobs, note = "") {
  if (state.batchRunning) return;
  setBatchBusy(true);
  const progressBox = $("batch-progress");
  const fill = $("progress-fill");
  const text = $("progress-text");
  $("batch-summary").innerHTML = note
    ? `<span class="muted">${escapeHtml(note)}</span>`
    : "";
  $("batch-detail").innerHTML = "";
  progressBox.hidden = false;
  let done = 0;

  const grid = $("batch-grid");
  revokeBlobUrls(grid);
  grid.innerHTML = "";
  const cards = jobs.map((job, i) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "batch-card pending";
    card.innerHTML = `
      ${job.thumbUrl ? `<img src="${job.thumbUrl}" alt="" loading="lazy" decoding="async" />` : '<span class="batch-noimg">?</span>'}
      <span class="batch-name">${escapeHtml(job.name)}</span>
      <span class="batch-status"><span class="spinner small" aria-hidden="true"></span></span>`;
    card.addEventListener("click", () => showBatchDetail(i));
    grid.appendChild(card);
    return card;
  });
  const results = new Array(jobs.length);

  const update = () => {
    fill.style.width = `${Math.round((done / jobs.length) * 100)}%`;
    text.textContent = `${done} of ${jobs.length} screened`;
  };
  update();

  function finishCard(i, r) {
    results[i] = r;
    const card = cards[i];
    card.classList.remove("pending");
    const status = card.querySelector(".batch-status");
    if (r.error) {
      card.classList.add("ERROR");
      status.innerHTML = `<span class="tier-pill ERROR">Could not check</span>`;
    } else if (r.data.unreadable) {
      card.classList.add("ERROR");
      status.innerHTML = `<span class="tier-pill ERROR">Not a label</span>`;
    } else {
      const tier = safeTier(r.data.verdict.tier);
      card.classList.add(tier);
      status.innerHTML = `<span class="tier-pill ${tier}">${CHIP_WORDS[tier] || "Checked"}</span><span class="batch-time">${r.seconds.toFixed(1)}s</span>`;
    }
  }

  function showBatchDetail(i) {
    const r = results[i];
    if (!r) return; // still running
    cards.forEach((c, j) => c.classList.toggle("selected", j === i));
    const box = $("batch-detail");
    if (r.error) {
      box.innerHTML = `<div class="error-box">${escapeHtml(r.name)}: ${escapeHtml(r.error)}</div>`;
      return;
    }
    if (r.data.unreadable) {
      box.innerHTML = `<div class="notice-box">${escapeHtml(r.name)}: ${escapeHtml(r.data.verdict.summary)}</div>`;
      return;
    }
    const v = r.data.verdict;
    const thumbSrc = cards[i] && cards[i].querySelector("img");
    const detailImg = thumbSrc
      ? `<div class="batch-detail-img"><img class="zoomable" src="${thumbSrc.src}" alt="${escapeHtml(r.name)}, click to enlarge" title="Click to enlarge" /></div>`
      : "";
    box.innerHTML = `
      <div class="tier-banner ${safeTier(v.tier)}">
        <span class="banner-text">${escapeHtml(r.name)}, ${escapeHtml(v.summary)}</span>
        <span class="timer">${r.seconds.toFixed(1)}s</span>
      </div>
      ${detailImg}
      <table class="result-table">
        <thead><tr><th>Field</th><th>Application says</th><th>Label shows</th><th>Result</th><th>Why</th></tr></thead>
        <tbody>${v.fields.map((f, j) => rowHtml(f, `d${j}`)).join("")}</tbody>
      </table>`;
    scrollToEl(box);
  }

  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      const job = jobs[i];
      const r = job.error
        ? { name: job.name, error: job.error }
        : await batchVerify(job);
      finishCard(i, r);
      done++;
      update();
    }
  }
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    setBatchBusy(false);
  }

  const counts = { GREEN: 0, YELLOW: 0, RED: 0, ERROR: 0 };
  for (const r of results) {
    if (r.error || r.data.unreadable) counts.ERROR++;
    else counts[safeTier(r.data.verdict.tier)]++;
  }
  $("batch-summary").innerHTML = `
    <span class="tier-pill GREEN">${counts.GREEN} passed</span>
    <span class="tier-pill YELLOW">${counts.YELLOW} need review</span>
    <span class="tier-pill RED">${counts.RED} with problems</span>
    ${counts.ERROR ? `<span class="tier-pill ERROR">${counts.ERROR} unreadable</span>` : ""}
    <button id="batch-csv" class="btn-record btn-sm" type="button">Download results (.csv)</button>
    <span class="muted batch-hint">Click any label for the breakdown.</span>
    ${note ? `<span class="muted batch-hint">${escapeHtml(note)}</span>` : ""}`;
  const csvBtn = $("batch-csv");
  if (csvBtn) csvBtn.addEventListener("click", () => downloadBatchCsv(results));
}

/** One CSV row per screened label, the triage list an agent acts on after a 300-label dump. */
function csvCell(s) {
  let v = s == null ? "" : String(s);
  // Neutralize spreadsheet formula injection: a cell starting with = + - @ (or
  // tab/CR) is run as a formula by Excel/Sheets. The label cell is the uploaded
  // filename, which is attacker-controlled, so force it to literal text.
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function downloadBatchCsv(results) {
  const rows = [["Label", "Verdict", "Seconds", "Summary"]];
  for (const r of results) {
    if (!r) continue;
    if (r.error) rows.push([r.name, "ERROR", "", r.error]);
    else if (r.data.unreadable) rows.push([r.name, "NOT A LABEL", (r.seconds || 0).toFixed(1), r.data.verdict.summary]);
    else rows.push([r.name, r.data.verdict.tier, r.seconds.toFixed(1), r.data.verdict.summary]);
  }
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `label-check-batch-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function batchVerify(job) {
  // Downscale here, inside the concurrency cap, preparing 50 phone photos
  // up front would decode them all at once.
  const files = job.prep ? await Promise.all(job.files.map(prepImage)) : job.files;
  const fd = new FormData();
  for (const f of files) fd.append("image", f);
  const fields = job.fields || { brand_name: "", class_type: "", abv: "", net_contents: "" };
  for (const k of Object.keys(fields)) fd.append(k, fields[k]);
  if (job.labelOnly) fd.append("label_only", "1");
  const t0 = performance.now();
  try {
    const res = await fetch("api/verify", {
      method: "POST",
      body: fd,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    const data = await res.json();
    if (!res.ok) return { name: job.name, error: data.error || "failed" };
    return { name: job.name, data, seconds: (performance.now() - t0) / 1000 };
  } catch (e) {
    return {
      name: job.name,
      error: e && e.name === "TimeoutError" ? "timed out" : "network error",
    };
  }
}

/* ---------------- util ---------------- */
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
