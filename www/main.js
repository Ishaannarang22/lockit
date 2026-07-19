/* lockit site — minimal, dependency-free interactions */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- copy install command ---------- */
  document.querySelectorAll(".install__copy").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy") || "";
      var done = function () {
        var label = btn.querySelector(".install__copy-label");
        var prev = label ? label.textContent : "";
        if (label) label.textContent = "Copied";
        btn.classList.add("is-copied");
        setTimeout(function () {
          if (label) label.textContent = prev || "Copy";
          btn.classList.remove("is-copied");
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(done);
      } else {
        var ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(ta); done();
      }
    });
  });

  /* ---------- sticky nav border ---------- */
  var nav = document.querySelector(".nav");
  if (nav) {
    var onScroll = function () { nav.classList.toggle("is-stuck", window.scrollY > 8); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------- reveal on scroll ---------- */
  var reveals = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ---------- typed walkthrough terminal ---------- */
  var termEl = document.getElementById("typed-term");
  var stepEls = Array.prototype.slice.call(document.querySelectorAll(".steps li"));

  // Each entry: html to append (already escaped where needed), pause after, optional step to activate.
  var SEQ = [
    { html: '<span class="c-com"># 1 · store a secret once — value via stdin, never argv</span>\n', step: 1 },
    { html: '<span class="c-p">$</span> printf \'sk-live-9f2a\' | <span class="c-cmd">lockit</span> set stripe/prod <span class="c-key">STRIPE_KEY</span>\n' },
    { html: '<span class="c-dim">  stored · stripe/prod → STRIPE_KEY</span>\n\n', pause: 500 },

    { html: '<span class="c-com"># 2 · see what you have — value-free</span>\n', step: 2 },
    { html: '<span class="c-p">$</span> <span class="c-cmd">lockit</span> ls <span class="c-op">--vars</span>\n' },
    { html: '  <span class="c-key">STRIPE_KEY</span>      <span class="c-dim">[stripe/prod]</span>  <span class="c-tag">hasValue</span>\n' },
    { html: '  <span class="c-key">DATABASE_URL</span>    <span class="c-dim">[app/dev]</span>     <span class="c-tag">hasValue</span>\n\n', pause: 500 },

    { html: '<span class="c-com"># 3 · admit exactly what this project may use</span>\n', step: 3 },
    { html: '<span class="c-p">$</span> <span class="c-cmd">lockit</span> init && <span class="c-cmd">lockit</span> admit <span class="c-key">STRIPE_KEY</span>\n' },
    { html: '  <span class="c-dim">Touch ID…</span> <span class="c-ok">✓ admitted to ~/code/app</span>\n\n', pause: 600 },

    { html: '<span class="c-com"># 4 · run with it injected, masked in output</span>\n', step: 4 },
    { html: '<span class="c-p">$</span> <span class="c-cmd">lockit</span> run <span class="c-op">--</span> npm start\n' },
    { html: '<span class="c-dim">→ injecting</span> <span class="c-key">STRIPE_KEY</span> <span class="c-dim">(masked)</span>\n' },
    { html: '  charge ok · key=<span class="redact">••••••••</span>  <span class="c-ok">✓ authorized</span>\n', pause: 1400 }
  ];

  function activateStep(n) {
    stepEls.forEach(function (li) {
      li.classList.toggle("is-active", li.getAttribute("data-step") === String(n));
    });
  }

  function typeSequence() {
    if (!termEl) return;
    var i = 0;
    var cursor = '<span class="typed-cursor"></span>';

    function renderInstant() {
      // reduced motion: dump everything, last step active
      termEl.innerHTML = SEQ.map(function (s) { return s.html; }).join("");
      activateStep(4);
    }
    if (reduceMotion) { renderInstant(); return; }

    function step() {
      if (i >= SEQ.length) {
        // loop after a beat
        setTimeout(function () {
          termEl.innerHTML = "";
          i = 0;
          activateStep(1);
          setTimeout(step, 400);
        }, 4200);
        return;
      }
      var item = SEQ[i];
      if (item.step) activateStep(item.step);
      termEl.innerHTML = SEQ.slice(0, i).map(function (s) { return s.html; }).join("") + item.html + cursor;
      // keep the terminal scrolled to the newest line
      termEl.scrollTop = termEl.scrollHeight;
      i++;
      setTimeout(step, item.pause || 340);
    }
    step();
  }

  // Only start typing once the terminal scrolls into view.
  if (termEl) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      typeSequence();
    } else {
      var started = false;
      var tio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !started) { started = true; typeSequence(); tio.disconnect(); }
        });
      }, { threshold: 0.35 });
      tio.observe(termEl);
    }
  }
})();
