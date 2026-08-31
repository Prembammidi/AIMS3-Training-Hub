const modules = window.AIMS_MODULES || [];
const params = new URLSearchParams(location.search);
const currentNum = params.get("module") || "01";
const current = modules.find(m => m.num === currentNum) || modules[0];
const guideButton = document.getElementById("guideButton");

if (!current) throw new Error("No course data found.");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[c]));
}

function parseYouTube(url) {
  try {
    const u = new URL(url);
    const list = u.searchParams.get("list");
    if (list) return { type: "playlist", playlistId: list };

    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const videoId = u.pathname.replace(/^\//, "").split("/")[0];
      return { type: "video", videoId };
    }

    const videoId = u.searchParams.get("v");
    if (videoId) return { type: "video", videoId };
  } catch (_) {}
  return { type: "unknown" };
}

const ytInfo = parseYouTube(current.course);
const lessonListEl = document.getElementById("lessonList");
const lessonSummary = document.getElementById("lessonSummary");
const lessonStatusMessage = document.getElementById("lessonStatusMessage");
const activeLessonTitle = document.getElementById("activeLessonTitle");
const playerPlaceholder = document.getElementById("playerPlaceholder");
const playerWrap = document.getElementById("playerWrap");
const openCourseDirect = document.getElementById("openCourseDirect");
const openSelectedDirect = document.getElementById("openSelectedDirect");

let lessons = [];
let activeIndex = -1;
let ytPlayer = null;
let playerReady = false;
let playlistProbe = null;
let pendingVideoId = null;

function setMessage(text) {
  lessonStatusMessage.textContent = text || "";
}

function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/* -------------------------------
   Course page content
-------------------------------- */
document.title = `${current.num} ${current.title} | AIMS3 Learning Center`;
document.getElementById("crumbTitle").textContent = current.title;
document.getElementById("moduleEyebrow").textContent =
  `MODULE ${current.num} OF ${String(modules.length).padStart(2,"0")}`;
document.getElementById("courseTitle").textContent = current.title;
document.getElementById("courseDescription").textContent = current.description;
document.getElementById("learningFocus").textContent = current.focus;
document.getElementById("quizButton").href = current.quiz;

if (current.guide) {
  guideButton.href = current.guide;
  guideButton.hidden = false;
} else {
  guideButton.removeAttribute("href");
  guideButton.hidden = true;
}

openCourseDirect.href = current.course;
openSelectedDirect.href = current.course;

const checklist = document.getElementById("checklist");
current.checklist.forEach(item => {
  const li = document.createElement("li");
  li.textContent = item;
  checklist.appendChild(li);
});

const moduleList = document.getElementById("moduleList");
modules.forEach(m => {
  const a = document.createElement("a");
  a.className = "module-link" + (m.num === current.num ? " active" : "");
  a.href = `course.html?module=${m.num}`;
  a.innerHTML = `<span class="n">${m.num}</span><span class="t">${escapeHtml(m.title)}</span>`;
  moduleList.appendChild(a);
});

/* -------------------------------
   Completion + notes
-------------------------------- */
const completeKey = `aims3-complete-${current.num}`;
const notesKey = `aims3-note-${current.num}`;
const completeBtn = document.getElementById("markComplete");
const chip = document.getElementById("courseStatus");
const value = document.getElementById("completionValue");
const mini = document.getElementById("miniProgress");

function refreshCompletion() {
  const done = localStorage.getItem(completeKey) === "1";
  completeBtn.textContent = done ? "✓ Course completed" : "Mark course complete";
  completeBtn.classList.toggle("done", done);
  chip.textContent = done ? "Completed" : "In progress";
  chip.classList.toggle("done", done);
  value.textContent = done ? "100%" : "0%";
  mini.style.width = done ? "100%" : "0%";
}

completeBtn.addEventListener("click", () => {
  localStorage.setItem(completeKey, localStorage.getItem(completeKey) === "1" ? "0" : "1");
  refreshCompletion();
});
refreshCompletion();

const notes = document.getElementById("courseNotes");
notes.value = localStorage.getItem(notesKey) || "";
notes.addEventListener("input", () => localStorage.setItem(notesKey, notes.value));

/* -------------------------------
   Previous / next course
-------------------------------- */
const moduleIndex = modules.findIndex(m => m.num === current.num);
const prevCourse = document.getElementById("prevCourse");
const nextCourse = document.getElementById("nextCourse");

if (moduleIndex > 0) {
  const m = modules[moduleIndex - 1];
  prevCourse.href = `course.html?module=${m.num}`;
  prevCourse.innerHTML = `← &nbsp; ${m.num} ${escapeHtml(m.title)}`;
}
if (moduleIndex < modules.length - 1) {
  const m = modules[moduleIndex + 1];
  nextCourse.href = `course.html?module=${m.num}`;
  nextCourse.innerHTML = `${m.num} ${escapeHtml(m.title)} &nbsp; →`;
}

/* -------------------------------
   Simple course-video list
-------------------------------- */
function renderLessons() {
  lessonListEl.innerHTML = "";

  if (!lessons.length) {
    lessonListEl.innerHTML = `
      <div class="simple-list-fallback">
        <strong>Video list is not available in this browser.</strong>
        <span>You can still open the official course directly in YouTube.</span>
        <a href="${escapeHtml(current.course)}" target="_blank" rel="noopener">Open official course ↗</a>
      </div>`;
    return;
  }

  lessons.forEach((lesson, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "simple-video-item" + (index === activeIndex ? " active" : "");
    button.innerHTML = `
      <span class="simple-video-number">${String(index + 1).padStart(2,"0")}</span>
      <span class="simple-video-copy">
        <strong>${escapeHtml(lesson.title)}</strong>
        <small>Click to play inside this page</small>
      </span>
      <span class="simple-video-play">▶</span>`;
    button.addEventListener("click", () => selectLesson(index));
    lessonListEl.appendChild(button);
  });
}

async function getVideoTitle(videoId, fallback) {
  const cacheKey = `aims3-video-title-${videoId}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(videoId))}&format=json`;
    const response = await fetch(endpoint, { mode: "cors" });
    if (!response.ok) throw new Error("metadata unavailable");
    const data = await response.json();
    const title = data.title || fallback;
    localStorage.setItem(cacheKey, title);
    return title;
  } catch (_) {
    return fallback;
  }
}

function populateLessons(videoIds) {
  lessons = videoIds.map((videoId, i) => ({
    videoId,
    title: `Training Video ${String(i + 1).padStart(2,"0")}`
  }));

  lessonSummary.textContent = `${lessons.length} official training video${lessons.length === 1 ? "" : "s"}. Choose one below.`;
  renderLessons();
  setMessage("");

  /* Titles update quietly; the list never waits for them. */
  videoIds.forEach(async (videoId, i) => {
    const title = await getVideoTitle(videoId, lessons[i].title);
    if (!lessons[i]) return;
    lessons[i].title = title;
    renderLessons();
    if (i === activeIndex) activeLessonTitle.textContent = title;
  });
}

function selectLesson(index) {
  if (!lessons[index]) return;

  // Keep the user at the same place on the page
  const savedScrollY = window.scrollY;

  activeIndex = index;
  const lesson = lessons[index];
  pendingVideoId = lesson.videoId;

  renderLessons();
  activeLessonTitle.textContent = lesson.title;
  openSelectedDirect.href = watchUrl(lesson.videoId);

  playerPlaceholder.hidden = true;
  playerWrap.hidden = false;

  setMessage("Loading the selected official training video…");

  // Restore current scroll position after DOM changes
  requestAnimationFrame(() => {
    window.scrollTo(0, savedScrollY);
  });

  if (!ytPlayer) {
    ytPlayer = new YT.Player("coursePlayer", {
      videoId: lesson.videoId,

      playerVars: {
        rel: 0,
        playsinline: 1,
        origin: location.origin
      },

      events: {
        onReady: event => {
          playerReady = true;

          const idToPlay = pendingVideoId || lesson.videoId;
          event.target.loadVideoById(idToPlay);

          setMessage("");

          // Do not allow YouTube player creation to jump the page
          requestAnimationFrame(() => {
            window.scrollTo(0, savedScrollY);
          });
        },

        onError: handlePlayerError
      }
    });

    return;
  }

  if (playerReady) {
    ytPlayer.loadVideoById(lesson.videoId);
    setMessage("");

    // Changing videos should not move the page
    requestAnimationFrame(() => {
      window.scrollTo(0, savedScrollY);
    });
  }
}

function showPlaylistFallback(message) {
  lessons = [];
  lessonSummary.textContent = message;
  renderLessons();
  setMessage("Embedded lesson discovery is unavailable. Use the direct YouTube course link above.");
}

window.onYouTubeIframeAPIReady = function () {
  if (location.protocol === "file:") {
    showPlaylistFallback("Open this portal with VS Code Live Server or another HTTP/HTTPS host.");
    return;
  }

  if (ytInfo.type === "video") {
    populateLessons([ytInfo.videoId]);
    return;
  }

  if (ytInfo.type !== "playlist") {
    showPlaylistFallback("A valid YouTube course link was not found for this module.");
    return;
  }

  /* Tiny hidden probe only discovers playlist IDs. It never creates the visible video player. */
  const probeHost = document.createElement("div");
  probeHost.id = "playlistProbeSimple";
  probeHost.style.cssText = "position:fixed;left:-99999px;top:-99999px;width:2px;height:2px;overflow:hidden;";
  document.body.appendChild(probeHost);

  playlistProbe = new YT.Player("playlistProbeSimple", {
    playerVars: {
      rel: 0,
      playsinline: 1,
      origin: location.origin,
      listType: "playlist",
      list: ytInfo.playlistId
    },
    events: {
      onReady: event => {
        let attempts = 0;
        const read = () => {
          const ids = event.target.getPlaylist?.() || [];
          if (ids.length) {
            populateLessons(ids);
            return;
          }
          attempts += 1;
          if (attempts <= 5) {
            setTimeout(read, 400);
          } else {
            showPlaylistFallback("The browser could not read this YouTube playlist's video list.");
          }
        };
        read();
      },
      onError: () => showPlaylistFallback("YouTube blocked automatic playlist reading in this browser.")
    }
  });
};

function handlePlayerError(event) {
  let text = "This video could not be played inside the portal. Use ‘Open selected video’ to watch it directly in YouTube.";
  if (event.data === 101 || event.data === 150) {
    text = "This video does not allow embedding. Use ‘Open selected video’ to watch it directly in YouTube.";
  } else if (event.data === 153) {
    text = "YouTube blocked the embedded player for this origin. Use the direct YouTube link instead.";
  }
  setMessage(text);
}

/* -------------------------------
   Mobile navigation
-------------------------------- */
(function setupMobileNavigation() {
  const btn = document.getElementById("mobileMenuBtn");
  const backdrop = document.getElementById("mobileBackdrop");
  const sidebar = document.getElementById("courseSidebar") || document.querySelector("aside.sidebar, .sidebar");
  if (!btn || !backdrop || !sidebar) return;

  function closeMenu() {
    sidebar.classList.remove("open");
    backdrop.classList.remove("show");
    backdrop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }
  function openMenu() {
    sidebar.classList.add("open");
    backdrop.hidden = false;
    backdrop.classList.add("show");
    btn.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
  }
  btn.addEventListener("click", () => sidebar.classList.contains("open") ? closeMenu() : openMenu());
  backdrop.addEventListener("click", closeMenu);
  sidebar.addEventListener("click", e => { if (e.target.closest("a")) closeMenu(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
  window.addEventListener("resize", () => { if (window.innerWidth > 760) closeMenu(); });
})();
