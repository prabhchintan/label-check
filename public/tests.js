// Render the synthetic stress-test gallery; clicking deep-links into the
// main app, which runs the identical verification flow.
// (External file rather than inline so the Content-Security-Policy can stay
// script-src 'self'.)
fetch("demo-labels/manifest.json")
  .then((r) => r.json())
  .then((manifest) => {
    const gallery = document.getElementById("stress-gallery");
    const words = { GREEN: "Passes", YELLOW: "Needs human review", RED: "Problem found" };
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    for (const d of manifest) {
      const a = document.createElement("a");
      a.className = "demo-card";
      a.href = `./#demo-${d.id}`;
      a.innerHTML = `
        <span class="thumb-stack"><img src="${d.image}" alt="" loading="lazy" /></span>
        <span class="card-head"><span class="chip ${d.expected}">${words[d.expected]}</span></span>
        <span class="demo-title">${esc(d.title)}</span>
        <span class="demo-story">${esc(d.story)}</span>`;
      gallery.appendChild(a);
    }
  });
