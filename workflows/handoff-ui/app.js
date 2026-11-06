const el = Object.fromEntries(
    [...document.querySelectorAll("[id]")].map((node) => [node.id, node]),
);
let storageKey;
let drafts = {};
let catalog;
let busy = false;
let ready = false;
let clipUrl;
let generation = 0;
const draft = () => drafts[el.scenario.value];
const save = () => localStorage.setItem(storageKey, JSON.stringify(drafts));
const time = (seconds) => {
    const ms = Math.round(seconds * 1000);
    return (
        Math.floor(ms / 60000) +
        ":" +
        String(Math.floor(ms / 1000) % 60).padStart(2, "0") +
        "." +
        String(ms % 1000).padStart(3, "0")
    );
};
async function post(route, data) {
    const response = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "The request failed.");
    return result;
}
function clock() {
    const t = el.video.currentTime;
    el.elapsed.value = time(t);
    el.noteTime.value = time(t);
    el.seek.value = t;
}
function render() {
    const d = draft();
    el.scenario.disabled = busy;
    el.record.disabled = busy || !el.scenario.value;
    el.recordLabel.textContent = d ? "Record again" : "Record case";
    el.play.disabled = el.seek.disabled = el.note.disabled = busy || !ready;
    el.add.disabled = busy || !ready || !el.note.value.trim();
    el.export.disabled =
        busy || !ready || !d?.notes.length || !!el.note.value.trim();
    el.hint.hidden = ready;
    el.count.textContent = d?.notes.length || 0;
    el.notes.replaceChildren();
    for (const n of d?.notes || []) {
        const row = document.createElement("li");
        const stamp = document.createElement("button");
        stamp.className = "stamp";
        stamp.textContent = time(n.timeMs / 1000);
        stamp.disabled = !ready || busy;
        stamp.onclick = () => {
            el.video.pause();
            el.video.currentTime = n.timeMs / 1000;
        };
        const body = document.createElement("span");
        body.textContent = n.text;
        const remove = document.createElement("button");
        remove.textContent = "Remove";
        remove.disabled = busy;
        remove.onclick = () => {
            d.notes.splice(d.notes.indexOf(n), 1);
            delete d.delivery;
            save();
            render();
        };
        row.append(stamp, body, remove);
        el.notes.append(row);
    }
    el.delivery.hidden = !d?.delivery || busy || !!el.note.value.trim();
    if (d?.delivery) el.download.href = d.delivery.url;
}
async function loadClip() {
    const own = ++generation;
    const fixture = catalog.fixtures.find(item => item.id === el.scenario.value);
    el.feature.textContent = fixture ? fixture.feature : "Replay";
    el.profile.textContent = fixture ? catalog.project.variant + " · " + fixture.viewport : "";
    ready = false;
    el.video.pause();
    el.video.removeAttribute("src");
    el.video.load();
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    el.seek.max = 0;
    el.duration.value = "0:00";
    el.note.value = draft()?.text || "";
    clock();
    render();
    if (!draft()) return;
    const response = await fetch("/clip/" + draft().id);
    if (!response.ok)
        throw Error(
            "The saved recording is unavailable. Record this case again.",
        );
    const blob = await response.blob();
    if (own !== generation) return;
    clipUrl = URL.createObjectURL(blob);
    el.video.src = clipUrl;
}
el.video.onloadedmetadata = () => {
    ready = Number.isFinite(el.video.duration) && el.video.duration > 0;
    if (!ready)
        el.status.textContent =
            "This recording could not be indexed for scrubbing.";
    if (ready && draft().text) el.video.currentTime = draft().draftTime;
    el.seek.max = el.video.duration;
    el.duration.value = ready ? time(el.video.duration) : "—";
    render();
};
el.video.onerror = () => {
    ready = false;
    el.status.textContent =
        "This browser could not open the WebM clip. Open this page in Chrome.";
    render();
};
el.video.ontimeupdate = clock;
el.video.onplay = () => {
    el.play.textContent = "Ⅱ";
    el.play.setAttribute("aria-label", "Pause recording");
};
el.video.onpause = () => {
    el.play.textContent = "▶";
    el.play.setAttribute("aria-label", "Play recording");
};
el.play.onclick = () =>
    el.video.paused ? el.video.play().catch(report) : el.video.pause();
el.seek.oninput = () => {
    el.video.pause();
    el.video.currentTime = Number(el.seek.value);
    clock();
};
el.video.onseeked = () => {
    if (ready && draft().text) {
        draft().draftTime = el.video.currentTime;
        save();
    }
};
el.note.onfocus = () => el.video.pause();
el.note.oninput = () => {
    draft().text = el.note.value;
    draft().draftTime = el.video.currentTime;
    save();
    render();
};
el.noteForm.onsubmit = (event) => {
    event.preventDefault();
    if (el.add.disabled) return;
    const d = draft();
    d.notes.push({
        timeMs: Math.round(el.video.currentTime * 1000),
        text: el.note.value.trim(),
    });
    d.notes.sort((a, b) => a.timeMs - b.timeMs);
    d.text = el.note.value = "";
    delete d.delivery;
    save();
    render();
};
function report(error) {
    el.status.textContent = error.message;
}
el.scenario.onchange = () => {
    el.status.textContent = "";
    loadClip().catch(report);
};
el.record.onclick = async () => {
    if (
        draft() &&
        !confirm(
            "Replace this recording and its draft notes? Previously exported ZIPs are kept.",
        )
    )
        return;
    busy = true;
    el.video.pause();
    el.pending.hidden = false;
    el.status.textContent = "";
    render();
    try {
        const result = await post("/record", { scenario: el.scenario.value });
        drafts[result.scenario] = { id: result.id, notes: [] };
        save();
        await loadClip();
    } catch (error) {
        report(error);
    } finally {
        busy = false;
        el.pending.hidden = true;
        render();
    }
};
el.export.onclick = async () => {
    busy = true;
    el.video.pause();
    render();
    try {
        const d = draft();
        d.delivery = await post("/export", { id: d.id, notes: d.notes });
        save();
        el.status.textContent =
            "Handoff ready. Attach the ZIP or copy the prompt for an agent in this workspace.";
    } catch (error) {
        report(error);
    } finally {
        busy = false;
        render();
    }
};
el.copy.onclick = async () => {
    const prompt =
        "Port the " +
        el.scenario.selectedOptions[0].text +
        " changes to Unity. Open the handoff at " +
        draft().delivery.path +
        " and follow the timestamped designer notes in README.md alongside motion.webm.";
    try {
        await navigator.clipboard.writeText(prompt);
        el.status.textContent = "Agent prompt copied.";
    } catch {
        el.status.textContent = prompt;
    }
};
async function discover() {
    const response = await fetch("/fixtures");
    if (!response.ok) throw Error("Could not discover fixtures. Check the project adapter.");
    catalog = await response.json();
    storageKey = "helix.handoff." + catalog.project.project + "." + catalog.project.variant;
    drafts = JSON.parse(localStorage.getItem(storageKey) || "{}");
    for (const item of catalog.fixtures) {
        el.scenario.add(new Option(item.feature + " — " + item.label, item.id));
        // The first authoring UI stored its drafts per feature instead of per project.
        const legacyKey = "helix." + item.feature.toLowerCase().replaceAll(" ", "-") + ".handoff.v1";
        const legacy = localStorage.getItem(legacyKey);
        if (legacy && !drafts[item.id]) {
            const previous = JSON.parse(legacy)[item.id];
            if (previous) drafts[item.id] = previous;
        }
    }
    save();
    await loadClip();
    if (!catalog.fixtures.length) el.status.textContent = "No fixtures registered. Ask your AI Kit agent to author a fixture for the feature.";
}
discover().catch(report);
