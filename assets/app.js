(() => {
  "use strict";
  const MODE   = window.MODE === "admin" ? "admin" : "view";
  const API    = (window.API_URL || "").trim();
  const PEOPLE = window.PEOPLE || [];
  const LOCAL  = "ij_fb_local";
  const DRAFT  = "ij_fb_draft";      // 아직 저장 버튼을 누르지 않은 초고(이 기기에만 남는다)

  let store = {};                 // { personId: { key: {text, updatedAt} } }
  const pending = new Map();      // 화면에는 이미 반영됐지만 아직 전송 중인 것
  let current = PEOPLE[0]?.id;
  // 비밀번호는 링크의 # 뒤에서 읽는다. 공개 파일에는 들어가지 않는다.
  let pass = decodeURIComponent((location.hash || "").replace(/^#/, "")).trim()
             || sessionStorage.getItem("ij_fb_pass") || "";
  if (pass) sessionStorage.setItem("ij_fb_pass", pass);

  const $  = (s, r = document) => r.querySelector(s);
  const el = (t, c, txt) => { const n = document.createElement(t);
                              if (c) n.className = c;
                              if (txt != null) n.textContent = txt;
                              return n; };
  const get = (pid, k) => (store[pid] || {})[k]?.text || "";

  const draftsAll = () => { try { return JSON.parse(localStorage.getItem(DRAFT)) || {}; }
                            catch { return {}; } };
  const draftGet  = (pid, k) => draftsAll()[pid + "|" + k];
  const draftSet  = (pid, k, v) => {
    const d = draftsAll();
    if (v == null) delete d[pid + "|" + k]; else d[pid + "|" + k] = v;
    try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch {}
  };

  /* ── 저장소 ─────────────────────────────────────────── */
  const localRead  = () => { try { return JSON.parse(localStorage.getItem(LOCAL)) || {}; }
                             catch { return {}; } };
  const localWrite = () => { try { localStorage.setItem(LOCAL, JSON.stringify(store)); }
                             catch {} };

  // 서버에서 새로 받은 내용 위에, 아직 전송 중인 내용을 다시 덮는다
  function overlay() {
    pending.forEach(v => {
      store[v.pid] = store[v.pid] || {};
      if (v.remove) delete store[v.pid][v.key];
      else store[v.pid][v.key] = { text: v.text, updatedAt: new Date().toISOString() };
    });
  }

  async function load() {
    if (!API) { store = localRead(); return; }
    const r = await fetch(API, { method: "GET" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "load_failed");
    store = j.data || {};
    overlay();
    localWrite();                    // 이 브라우저에도 사본을 남긴다
  }

  async function save(pid, key, text, remove) {
    if (!API) {
      store[pid] = store[pid] || {};
      if (remove || !text.trim()) delete store[pid][key];
      else store[pid][key] = { text, updatedAt: new Date().toISOString() };
      localWrite();
      return;
    }
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },  // preflight 회피
      body: JSON.stringify({ pass, person: pid, key,
                             text: remove ? "" : text,
                             action: remove ? "delete" : "save" }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "save_failed");
    store = j.data || {};
    overlay();
    localWrite();                    // 이 브라우저에도 사본을 남긴다
  }

  /* ── 상태 표시 ──────────────────────────────────────── */
  let statusTimer;
  function status(msg, keep) {
    const n = $("#status"); if (!n) return;
    n.textContent = msg;
    clearTimeout(statusTimer);
    if (!keep) statusTimer = setTimeout(() => { n.textContent = ""; }, 2600);
  }

  /* ── 렌더 ───────────────────────────────────────────── */
  function renderNav() {
    const nav = $("#nav"); nav.innerHTML = "";
    PEOPLE.forEach(p => {
      const b = el("button", p.cohort === "40기" ? "c40" : null);
      b.append(document.createTextNode(p.name));
      const n = Object.keys(store[p.id] || {}).length;
      if (n) b.append(el("span", "dot", String(n)));
      b.setAttribute("aria-current", String(p.id === current));
      b.onclick = () => { current = p.id; renderNav(); renderPerson();
                          window.scrollTo({ top: 0 }); };
      nav.append(b);
    });
  }

  function feedbackBlock(pid, key, placeholder) {
    const wrap = el("div", "fb");
    wrap.append(el("div", "sec-label", "선배님 피드백"));

    if (MODE !== "admin") {
      const saved = get(pid, key);
      if (saved) wrap.append(el("div", "read", saved));
      else       wrap.append(el("div", "empty", "아직 등록된 피드백이 없습니다."));
      return wrap;
    }

    const body = el("div", "fb-body"); wrap.append(body);
    const first = draftGet(pid, key);
    let buf     = first != null ? first : get(pid, key);
    let editing = !get(pid, key) || buf !== get(pid, key);

    function paint(focus) {
      const saved = get(pid, key);
      body.innerHTML = "";

      /* 저장된 피드백 보기 */
      if (!editing) {
        body.append(el("div", "read", saved));
        const row  = el("div", "row");
        const edit = el("button", null, "수정");
        edit.onclick = () => { buf = saved; editing = true; paint(true); };
        const del  = el("button", null, "삭제");
        del.onclick = async () => {
          if (!confirm("저장된 피드백을 삭제할까요?")) return;
          const keep = buf, job = commit(pid, key, "", true);
          buf = ""; editing = true; paint();
          if (!await job) { buf = keep; editing = false; }
          paint();
        };
        row.append(el("span", "saved", pending.has(pid + "|" + key) ? "저장 중…" : ""),
                   edit, del);
        body.append(row);
        return;
      }

      /* 작성·수정 */
      const ta = el("textarea");
      ta.value = buf; ta.placeholder = placeholder;
      const row  = el("div", "row");
      const mark = el("span", "saved", "");
      const sv   = el("button", "primary", saved ? "수정 저장" : "저장");
      const can  = saved ? el("button", null, "취소") : null;

      const sync = () => {
        const dirty = buf.trim() && buf !== saved;
        sv.disabled = !dirty;
        mark.textContent = dirty ? "저장 버튼을 눌러야 등록됩니다"
                                 : (saved ? "" : "");
      };
      ta.oninput = () => { buf = ta.value; draftSet(pid, key, buf); sync(); };
      sv.onclick = async () => {
        const job = commit(pid, key, buf, false);
        editing = false; paint();              // 기다리지 않고 바로 저장된 모습으로
        editing = !await job;                  // 실패하면 쓰시던 글 그대로 되돌린다
        paint();
      };
      if (can) can.onclick = () => {
        draftSet(pid, key, null);
        buf = saved; editing = false;
        paint();
      };

      row.append(mark, sv);
      if (can) row.append(can);
      body.append(ta, row);
      sync();
      if (focus) ta.focus();
    }

    paint();
    return wrap;
  }

  function commit(pid, key, text, remove) {
    const k    = pid + "|" + key;
    const prev = (store[pid] || {})[key];

    // 화면·목차 뱃지는 즉시 반영
    store[pid] = store[pid] || {};
    if (remove) delete store[pid][key];
    else store[pid][key] = { text, updatedAt: new Date().toISOString() };
    pending.set(k, { pid, key, text, remove });
    renderNav(); refreshProgress();
    status(remove ? "삭제 중…" : "저장 중…", true);

    return save(pid, key, text, remove).then(() => {
      pending.delete(k); overlay();
      draftSet(pid, key, null);
      status(remove ? "삭제되었습니다" : "저장되었습니다");
      renderNav(); refreshProgress();
      return true;
    }).catch(e => {
      pending.delete(k);                       // 실패하면 되돌린다
      if (prev) store[pid][key] = prev; else delete (store[pid] || {})[key];
      renderNav(); refreshProgress();
      if (String(e.message) === "bad_pass") {
        sessionStorage.removeItem("ij_fb_pass"); pass = "";
        status("비밀번호가 맞지 않습니다", true);
        askPass("비밀번호가 맞지 않습니다. 다시 입력해 주세요.");
      } else {
        status("저장되지 않았습니다 — 연결을 확인하고 다시 눌러 주세요", true);
      }
      return false;
    });
  }

  function refreshProgress() {
    const p = PEOPLE.find(x => x.id === current);
    const box = $("#main .progress"); if (!p || !box) return;
    const done = Object.keys(store[p.id] || {});
    const nSlide = done.filter(k => k !== "overall").length;
    box.children[1].textContent = `장표별 피드백 ${nSlide}개`;
    const ov = box.children[2];
    ov.textContent = done.includes("overall") ? "총평 작성됨" : "";
    ov.className = done.includes("overall") ? "ok" : "hide";
  }

  function renderPerson() {
    const p = PEOPLE.find(x => x.id === current);
    const main = $("#main"); main.innerHTML = "";
    if (!p) { main.append(el("p", null, "표시할 자료가 없습니다.")); return; }

    const head = el("div", "person-head");
    const h1 = el("h1", null, p.name);
    h1.append(el("small", null, `${p.cohort} · ${p.company}`));
    const done = Object.keys(store[p.id] || {});
    const nSlide = done.filter(k => k !== "overall").length;
    const meta = el("p", "progress");
    meta.append(el("span", null, `장표 ${p.slides.length}쪽`),
                el("span", null, `장표별 피드백 ${nSlide}개`),
                el("span", done.includes("overall") ? "ok" : "hide",
                   done.includes("overall") ? "총평 작성됨" : ""));
    const jump = el("button", "jump", "총평으로 ↓");
    jump.onclick = () => $("#overall").scrollIntoView({ behavior: "smooth", block: "start" });
    head.append(h1, el("p", null, p.topic), meta, jump);
    main.append(head);

    p.slides.forEach(s => {
      const card = el("div", "slide"); card.id = `s${s.n}`;
      const no = el("div", "slide-no");
      if (s.k) no.append(el("b", null, String(s.k)));
      no.append(el("span", s.k ? null : "plain", s.title));
      card.append(no);

      const grid = el("div", "grid");
      const left = el("div", "pane-img");
      const img = el("img"); img.src = s.img; img.alt = `${s.n}쪽`; img.loading = "lazy";
      img.onclick = () => zoom(s.img);
      left.append(img);

      const right = el("div", "pane-txt");
      right.append(el("div", "sec-label", "발표 대본"));
      const sc = el("div", "script");
      if (s.paras.length) s.paras.forEach(t => sc.append(el("p", null, t)));
      else sc.append(el("p", "none", "이 장표에는 대본이 없습니다."));
      right.append(sc, feedbackBlock(p.id, String(s.n), "이 장표에 대한 피드백"));

      grid.append(left, right);
      card.append(grid);
      main.append(card);
    });

    const ov = el("div", "overall"); ov.id = "overall";
    ov.append(el("h2", null, "총평"),
              el("p", "hint", `${p.name} 님의 발표 전반에 대한 의견입니다.`),
              feedbackBlock(p.id, "overall", "전체적인 강점과 보완점을 적어 주세요"));
    main.append(ov);
  }

  function zoom(src) {
    const d = $("#zoom"); $("#zoomImg").src = src; d.showModal();
    d.onclick = () => d.close();
  }

  function askPass(msg) {
    let d = $("#pass");
    if (!d) {
      d = el("dialog"); d.id = "pass";
      d.innerHTML =
        '<form method="dialog" class="passbox">' +
        '<h3>작성 모드</h3>' +
        '<p id="passMsg">피드백을 작성하시려면 비밀번호를 입력해 주세요.</p>' +
        '<input id="passInput" type="password" inputmode="numeric" autocomplete="off" ' +
        'placeholder="비밀번호">' +
        '<div class="passrow"><button value="ok">확인</button></div></form>';
      document.body.append(d);
      d.addEventListener("close", () => {
        const v = $("#passInput").value.trim();
        if (!v) return;
        pass = v; sessionStorage.setItem("ij_fb_pass", pass);
        status("확인되었습니다. 이어서 작성해 주세요.");
      });
    }
    $("#passMsg").textContent = msg ||
      "피드백을 작성하시려면 비밀번호를 입력해 주세요.";
    $("#passInput").value = "";
    if (!d.open) d.showModal();
    setTimeout(() => $("#passInput").focus(), 50);
  }

  /* ── 시작 ───────────────────────────────────────────── */
  (async () => {
    status("불러오는 중…", true);
    try { await load(); status(""); }
    catch {
      store = localRead();           // 연결이 안 되면 이 브라우저의 사본으로 보여 준다
      status(Object.keys(store).length
             ? "연결이 불안정합니다 — 저장된 사본을 보여 드립니다. 새로고침해 주세요"
             : "불러오기 실패 — 새로고침해 주세요", true);
    }
    renderNav(); renderPerson();
    if (MODE === "admin" && !pass) askPass();
    if (MODE === "view" && API) setInterval(async () => {
      try { const b = JSON.stringify(store); await load();
            if (JSON.stringify(store) !== b) { renderNav(); renderPerson(); } } catch {}
    }, 30000);
  })();
})();
