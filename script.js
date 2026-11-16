const ADMIN_ID = "djvol123";
const ADMIN_PASSWORD = "0000";
// Demo only: these credentials live in frontend JavaScript for presentation.
// Replace this with server-side authentication before any real deployment.

const STORAGE_KEY = "sgsApplications";
const SESSION_KEY = "sgsSession";
const DRAFTS_KEY = "sgsCertificationDrafts";
const SUPABASE_URL = "https://bibywfudseuryqhcsewe.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_-ZMKta5IJylzm6M7Tr719A_ki1Om0TD";
const APPLICATIONS_API = `${SUPABASE_URL}/rest/v1/sgs_applications`;
const PHOTO_BUCKET = "sgs-photos";
const PHOTO_STORAGE_API = `${SUPABASE_URL}/storage/v1/object/${PHOTO_BUCKET}`;
const BUILDINGS = [
  { name: "베어드홀", category: "강의동", bins: 12, clean: 86, x: 30, y: 24, floors: ["B1", "1", "2", "3", "4", "5"] },
  { name: "형남공학관", category: "공학관", bins: 18, clean: 78, x: 58, y: 26, floors: ["1", "2", "3", "4", "5", "6", "7", "8", "9"] },
  { name: "정보과학관", category: "공학관", bins: 10, clean: 82, x: 70, y: 43, floors: ["B1", "1", "2", "3", "4", "5", "6"] },
  { name: "문화관", category: "학생시설", bins: 9, clean: 74, x: 40, y: 47, floors: ["B1", "1", "2", "3", "4"] },
  { name: "중앙도서관", category: "학습공간", bins: 14, clean: 91, x: 54, y: 62, floors: ["B1", "1", "2", "3", "4", "5", "6"] },
  { name: "미래관", category: "강의동", bins: 11, clean: 84, x: 29, y: 68, floors: ["1", "2", "3", "4", "5", "6"] },
  { name: "숭덕경상관", category: "강의동", bins: 13, clean: 80, x: 72, y: 74, floors: ["1", "2", "3", "4", "5", "6"] }
];

const photoCache = {};
let appCache = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
let certificationDrafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}");
let currentBuilding = null;
let selectedMapBuilding = BUILDINGS[0].name;
let selectedAdminId = null;
let activeFilter = "전체";
let quizPassed = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(date) {
  return date.replaceAll("-", ".");
}

function formatNow() {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function startTimeFor(date) {
  const day = new Date(`${date}T12:00:00`).getDay();
  return day === 0 || day === 6 ? "14:00" : "18:00";
}

function readApps() {
  return appCache;
}

function writeApps(apps) {
  appCache = apps;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(apps));
}

function saveDraft(app) {
  certificationDrafts[app.id] = { floorProofs: app.floorProofs };
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(certificationDrafts));
}

function clearDraft(id) {
  delete certificationDrafts[id];
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(certificationDrafts));
}

function withDraft(app) {
  const draft = certificationDrafts[app.id];
  return draft ? { ...app, floorProofs: draft.floorProofs } : app;
}

function supabaseHeaders(extra = {}) {
  return { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json", ...extra };
}

async function syncRemoteApps() {
  const response = await fetch(`${APPLICATIONS_API}?select=data&order=created_at.asc`, { headers: supabaseHeaders() });
  if (!response.ok) throw new Error(`신청 데이터 조회 실패 (${response.status})`);
  const rows = await response.json();
  writeApps(rows.map((row) => row.data));
  return readApps();
}

async function insertRemoteApp(app) {
  const response = await fetch(APPLICATIONS_API, {
    method: "POST",
    headers: supabaseHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ id: app.id, building: app.building, activity_date: app.date, assignment_id: app.assignmentId || "all", data: app })
  });
  if (!response.ok) {
    const error = new Error(`신청 저장 실패 (${response.status})`);
    error.status = response.status;
    throw error;
  }
}

async function persistRemoteApp(app) {
  const response = await fetch(`${APPLICATIONS_API}?id=eq.${encodeURIComponent(app.id)}`, {
    method: "PATCH",
    headers: supabaseHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ data: app, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`신청 데이터 수정 실패 (${response.status})`);
}

async function deleteRemoteApp(id) {
  const response = await fetch(`${APPLICATIONS_API}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: supabaseHeaders({ Prefer: "return=representation" })
  });
  if (!response.ok) throw new Error(`신청 취소 실패 (${response.status})`);
  const deleted = await response.json();
  if (!deleted.length) throw new Error("삭제 권한이 없거나 이미 취소된 신청입니다.");
}

async function uploadPhoto(appId, floor, type, file) {
  const extension = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${appId}/${encodeURIComponent(floor)}/${type}-${Date.now()}.${extension}`;
  const response = await fetch(`${PHOTO_STORAGE_API}/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": file.type || "image/jpeg", "x-upsert": "true" },
    body: file
  });
  if (!response.ok) throw new Error(`사진 업로드 실패 (${response.status})`);
  return {
    path,
    url: `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`
  };
}

function floorGroups(building) {
  if (building.name !== "형남공학관") return [{ id: "all", label: "건물 전체", floors: building.floors }];
  const groups = [];
  for (let i = 0; i < building.floors.length; i += 3) {
    const floors = building.floors.slice(i, i + 3);
    groups.push({ id: floors.join("-"), label: `${floors[0]}~${floors.at(-1)}층`, floors });
  }
  return groups;
}

function appAssignmentId(app) {
  return app.assignmentId || "all";
}

function isBooked(building, date, assignmentId = "all", ignoreId) {
  return readApps().some((app) => app.building === building && app.date === date && appAssignmentId(app) === assignmentId && app.id !== ignoreId);
}

function setSession(role) {
  sessionStorage.setItem(SESSION_KEY, role);
  renderAuth();
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  renderAuth();
}

function renderAuth() {
  const role = sessionStorage.getItem(SESSION_KEY);
  $("#login-screen").hidden = Boolean(role);
  $("#student-app").hidden = role !== "student";
  $("#admin-app").hidden = role !== "admin";
  if (role === "student") renderStudent();
  if (role === "admin") renderAdmin();
}

function renderStudent() {
  renderFilters();
  renderBuildings();
  renderActivities();
  renderMap();
}

function renderFilters() {
  const filters = ["전체", ...new Set(BUILDINGS.map((b) => b.category))];
  $(".filters").innerHTML = filters.map((filter) => `<button type="button" aria-pressed="${filter === activeFilter}">${filter}</button>`).join("");
  $$(".filters button").forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.textContent;
      renderBuildings();
      renderFilters();
    });
  });
}

function renderBuildings() {
  const q = $("#search-input").value.trim();
  const items = BUILDINGS.filter((b) => (activeFilter === "전체" || b.category === activeFilter) && b.name.includes(q));
  $("#result-count").textContent = `${items.length}개 건물`;
  $("#building-list").innerHTML = items.map((b) => buildingCard(b)).join("");
  $$("#building-list .apply").forEach((button) => button.addEventListener("click", () => openApply(button.dataset.name)));
}

function buildingCard(b) {
  return `<article class="card"><div class="card-head"><div class="building-icon"><svg><use href="#building"/></svg></div><div><span class="category">${b.category}</span><h3>${b.name}</h3></div><p class="count">쓰레기통<strong>${b.bins}</strong></p></div><span class="badge">CLEAN SCORE ${b.clean}</span><button class="apply" data-name="${b.name}">활동 신청하기</button></article>`;
}

function openApply(name) {
  currentBuilding = BUILDINGS.find((b) => b.name === name);
  quizPassed = false;
  $("#quiz-form").reset();
  $("#quiz-error").textContent = "";
  $("#guide-dialog").showModal();
}

async function openApplicationForm() {
  try {
    await syncRemoteApps();
  } catch (error) {
    $("#quiz-error").textContent = "공용 신청 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    console.error(error);
    return;
  }
  $("#apply-date").min = todayISO();
  $("#apply-date").value = $("#map-date").value || todayISO();
  $("#dialog-title").textContent = `${currentBuilding.name} 활동 신청`;
  const groups = floorGroups(currentBuilding);
  $("#assignment-field").hidden = groups.length === 1;
  $("#apply-assignment").innerHTML = groups.map((group) => `<option value="${group.id}">${group.label}</option>`).join("");
  $("#dialog-description").textContent = currentBuilding.name === "형남공학관" ? "형남공학관은 한 팀이 3개 층을 맡고, 담당 층마다 전후 사진을 인증합니다." : "한 팀이 건물 전체를 맡고, 모든 층에서 전후 사진을 인증합니다.";
  updateApplyDetail();
  $("#apply-dialog").showModal();
}

function updateApplyDetail() {
  const date = $("#apply-date").value || todayISO();
  const group = floorGroups(currentBuilding).find((item) => item.id === $("#apply-assignment").value) || floorGroups(currentBuilding)[0];
  const booked = isBooked(currentBuilding.name, date, group.id);
  $("#dialog-detail").innerHTML = `활동일: <strong>${formatDate(date)}</strong><br>담당 구역: <strong>${group.label}</strong><br>인증 층: <strong>${group.floors.map((floor) => `${floor}층`).join(", ")}</strong><br>시작 시간: <strong>${startTimeFor(date)}</strong><br>예약 상태: <strong>${booked ? "이미 신청 완료" : "신청 가능"}</strong>`;
  $("#confirm").disabled = booked;
}

async function confirmApply() {
  if (!quizPassed) return;
  const date = $("#apply-date").value;
  const group = floorGroups(currentBuilding).find((item) => item.id === $("#apply-assignment").value) || floorGroups(currentBuilding)[0];
  try {
    await syncRemoteApps();
  } catch (error) {
    $("#dialog-detail").innerHTML = `<strong>공용 신청 현황을 확인하지 못했습니다.</strong><br>인터넷 연결을 확인하고 다시 눌러 주세요.`;
    console.error(error);
    return;
  }
  if (!date || date < todayISO() || isBooked(currentBuilding.name, date, group.id)) return updateApplyDetail();
  const apps = readApps();
  const app = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    building: currentBuilding.name,
    date,
    startTime: startTimeFor(date),
    people: Number($("#apply-people").value),
    applicant: "김숭실",
    assignmentId: group.id,
    assignmentLabel: group.label,
    floors: group.floors,
    floorProofs: Object.fromEntries(group.floors.map((floor) => [floor, { beforeOverallTime: "", beforeInsideTime: "", afterInsideTime: "", afterOverallTime: "", overflow: [], misplaced: [] }])),
    status: "신청 완료",
    beforeTime: "",
    afterTime: "",
    createdAt: formatNow()
  };
  $("#confirm").disabled = true;
  try {
    await insertRemoteApp(app);
  } catch (error) {
    if (error.status === 409) {
      await syncRemoteApps().catch(() => {});
      updateApplyDetail();
    } else {
      $("#dialog-detail").innerHTML = `<strong>신청을 저장하지 못했습니다.</strong><br>잠시 후 다시 시도해 주세요.`;
      $("#confirm").disabled = false;
    }
    console.error(error);
    return;
  }
  writeApps([...apps, app]);
  $("#apply-dialog").close();
  showPage("activity");
  renderStudent();
}

function renderActivities() {
  const apps = readApps();
  $("#profile-count").textContent = `${apps.length}건`;
  if (!apps.length) {
    $("#activity-list").innerHTML = `<div class="empty">아직 신청한 활동이 없어요.<br>홈에서 원하는 건물을 선택해 주세요.</div>`;
    return;
  }
  $("#activity-list").innerHTML = apps.map((app) => activityCard(withDraft(app))).join("");
  $$("#activity-list input[type=file]").forEach((input) => input.addEventListener("change", handlePhoto));
  $$("#activity-list input[type=checkbox]").forEach((input) => input.addEventListener("change", handleSurveyChange));
  $$("#activity-list .cancel-activity").forEach((button) => button.addEventListener("click", () => cancelApplication(button.dataset.id)));
  $$("#activity-list .submit-certification").forEach((button) => button.addEventListener("click", () => submitCertification(button.dataset.id)));
}

function activityCard(app) {
  const building = BUILDINGS.find((item) => item.name === app.building);
  const floors = app.floors || building?.floors || ["전체"];
  const cancelButton = app.status === "인증 완료"
    ? `<button class="cancel-activity" disabled>인증 완료 · 취소 불가</button>`
    : `<button class="cancel-activity" data-id="${app.id}">신청 취소</button>`;
  const allComplete = floors.every((floor) => floorComplete(app, floor));
  const canSubmit = app.status === "신청 완료" || app.status === "재인증 요청";
  const submitArea = canSubmit
    ? `<button class="submit-certification" data-id="${app.id}" ${allComplete ? "" : "disabled"}>${allComplete ? "인증 완료하기" : "필수 사진을 모두 등록해 주세요"}</button>`
    : `<div class="certification-submitted"><svg><use href="#check"/></svg>${app.status === "인증 완료" ? "봉사활동 인증 완료" : "인증 제출 완료 · 관리자 확인 대기"}</div>`;
  return `<article class="card"><span class="category">${app.status}</span><h3>${app.building}</h3><div class="activity-meta"><span>활동일 ${formatDate(app.date)} · ${app.startTime}</span><span>담당 구역 ${app.assignmentLabel || "건물 전체"} · 참여 인원 ${app.people}명</span><span>각 층의 필수 사진 4장을 모두 등록한 뒤 인증을 제출해 주세요.</span></div>${cancelButton}<div class="floor-proof-list">${floors.map((floor) => floorProof(app, floor)).join("")}</div>${submitArea}</article>`;
}

async function submitCertification(id) {
  const baseApp = readApps().find((item) => item.id === id);
  if (!baseApp) return;
  const app = withDraft(baseApp);
  const building = BUILDINGS.find((item) => item.name === app.building);
  const floors = app.floors || building?.floors || [];
  if (!floors.length || !floors.every((floor) => floorComplete(app, floor))) {
    window.alert("담당한 모든 층의 필수 사진 4장을 등록해 주세요.");
    return;
  }
  if (!window.confirm("등록한 사진과 조사 내용을 관리자에게 제출할까요?")) return;
  const submitted = { ...app, status: "인증 대기", certificationSubmittedAt: formatNow() };
  const button = $(`.submit-certification[data-id="${id}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "제출 중...";
  }
  try {
    await persistRemoteApp(submitted);
    writeApps(readApps().map((item) => item.id === id ? submitted : item));
    clearDraft(id);
    renderActivities();
  } catch (error) {
    console.error(error);
    if (button) {
      button.disabled = false;
      button.textContent = "다시 제출하기";
    }
    window.alert("인증 정보를 제출하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.");
  }
}

async function cancelApplication(id) {
  const app = readApps().find((item) => item.id === id);
  if (!app || app.status === "인증 완료") return;
  if (!window.confirm(`${app.building} ${formatDate(app.date)} 신청을 취소할까요?`)) return;
  const button = $(`.cancel-activity[data-id="${id}"]`) || $("#admin-cancel");
  if (button) {
    button.disabled = true;
    button.textContent = "취소 중...";
  }
  try {
    await deleteRemoteApp(id);
    writeApps(readApps().filter((item) => item.id !== id));
    clearDraft(id);
    if (photoCache[id]) {
      Object.values(photoCache[id]).forEach((floor) => Object.values(floor).forEach((url) => URL.revokeObjectURL(url)));
      delete photoCache[id];
    }
    selectedAdminId = null;
    if (sessionStorage.getItem(SESSION_KEY) === "admin") renderAdmin();
    else renderStudent();
  } catch (error) {
    console.error(error);
    if (button) {
      button.disabled = false;
      button.textContent = "다시 취소하기";
    }
    window.alert("신청을 취소하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.");
  }
}

function floorProof(app, floor) {
  const proof = proofFor(app, floor);
  return `<section class="floor-proof"><div class="floor-proof-title"><b>${floor}층 인증</b><span>${floorComplete(app, floor) ? "등록 완료" : "사진 필요"}</span></div><p class="photo-step">활동 전</p><div class="photo-grid">${photoBox(app, floor, "beforeOverall", "이름표·전체 촬영")}${photoBox(app, floor, "beforeInside", "캔·플라스틱 내부 촬영")}</div><div class="survey-block"><b>쓰레기 포화도</b><p>쓰레기가 통 윗부분을 넘은 칸을 선택해 주세요.</p>${checkGroup(app, floor, "overflow", ["일반쓰레기", "병·플라스틱", "캔"], proof.overflow)}</div><div class="survey-block"><b>분리수거 미준수 폐기물</b><p>주로 잘못 분리되어 있던 폐기물을 선택해 주세요.</p>${checkGroup(app, floor, "misplaced", ["음료용기", "배달용기", "기타"], proof.misplaced)}</div><p class="photo-step">활동 후</p><div class="photo-grid">${photoBox(app, floor, "afterOverall", "이름표·전체 촬영")}${photoBox(app, floor, "afterInside", "정리된 내부 촬영")}</div></section>`;
}

function checkGroup(app, floor, field, options, selected = []) {
  return `<div class="check-grid">${options.map((option) => `<label><input type="checkbox" data-id="${app.id}" data-floor="${floor}" data-field="${field}" value="${option}" ${selected.includes(option) ? "checked" : ""}>${option}</label>`).join("")}</div>`;
}

function proofFor(app, floor) {
  if (app.floorProofs?.[floor]) return app.floorProofs[floor];
  return { beforeOverallTime: app.beforeTime || "", beforeInsideTime: "", afterInsideTime: "", afterOverallTime: app.afterTime || "", overflow: [], misplaced: [] };
}

function floorComplete(app, floor) {
  const proof = proofFor(app, floor);
  return Boolean(proof.beforeOverallTime && proof.beforeInsideTime && proof.afterInsideTime && proof.afterOverallTime);
}

function photoBox(app, floor, type, label) {
  const proof = proofFor(app, floor);
  const src = photoCache[app.id]?.[floor]?.[type] || proof[`${type}Url`];
  const time = proof[`${type}Time`];
  return `<div class="photo-box"><b>${label}</b>${src ? `<img src="${src}" alt="${floor}층 ${label} 미리보기">` : `<div class="placeholder">사진 미등록</div>`}<label class="camera-label"><svg><use href="#camera"/></svg>사진 촬영<input type="file" accept="image/*" capture="environment" data-id="${app.id}" data-floor="${floor}" data-type="${type}"></label><div class="time-text">${time || "등록 시각 대기"}</div></div>`;
}

async function handlePhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  const id = event.target.dataset.id;
  const floor = event.target.dataset.floor;
  const type = event.target.dataset.type;
  photoCache[id] ||= {};
  photoCache[id][floor] ||= {};
  if (photoCache[id][floor][type]) URL.revokeObjectURL(photoCache[id][floor][type]);
  photoCache[id][floor][type] = URL.createObjectURL(file);
  renderActivities();
  let uploaded;
  try {
    uploaded = await uploadPhoto(id, floor, type, file);
  } catch (error) {
    console.error(error);
    window.alert("사진을 공용 저장소에 업로드하지 못했습니다. 인터넷 연결을 확인하고 다시 촬영해 주세요.");
    return;
  }
  const baseApp = readApps().find((app) => app.id === id);
  if (!baseApp) return;
  const currentApp = withDraft(baseApp);
  let changedApp = null;
  readApps().forEach((app) => {
    if (app.id !== id) return;
    const building = BUILDINGS.find((item) => item.name === app.building);
    const floors = currentApp.floors || building?.floors || [floor];
    const floorProofs = { ...(currentApp.floorProofs || {}) };
    floorProofs[floor] = { ...proofFor(currentApp, floor), [`${type}Time`]: formatNow(), [`${type}Url`]: uploaded.url, [`${type}Path`]: uploaded.path };
    const changed = { ...currentApp, floors, floorProofs, beforeTime: "", afterTime: "" };
    changedApp = changed;
  });
  if (changedApp) saveDraft(changedApp);
  renderActivities();
}

function handleSurveyChange(event) {
  const { id, floor, field } = event.target.dataset;
  const checked = $$(`input[type=checkbox][data-id="${id}"][data-floor="${floor}"][data-field="${field}"]:checked`).map((input) => input.value);
  const baseApp = readApps().find((app) => app.id === id);
  if (!baseApp) return;
  const currentApp = withDraft(baseApp);
  const floorProofs = { ...(currentApp.floorProofs || {}) };
  floorProofs[floor] = { ...proofFor(currentApp, floor), [field]: checked };
  saveDraft({ ...currentApp, floorProofs });
}

function showPage(page) {
  ["home", "activity", "map", "profile"].forEach((name) => {
    $(`#${name}-page`).hidden = name !== page;
    $(`.bottom-nav [data-page="${name}"]`).setAttribute("aria-current", name === page ? "page" : "false");
  });
  if (page === "map") renderMap();
}

function renderMap() {
  $("#map-date").min = todayISO();
  if (!$("#map-date").value) $("#map-date").value = todayISO();
  $("#map-time").textContent = `${startTimeFor($("#map-date").value)} 시작`;
  $("#campus-map").innerHTML = BUILDINGS.map((b) => {
    const full = floorGroups(b).every((group) => isBooked(b.name, $("#map-date").value, group.id));
    return `<button class="pin ${full ? "full" : ""}" style="left:${b.x}%;top:${b.y}%" data-name="${b.name}" aria-pressed="${b.name === selectedMapBuilding}">${b.name}</button>`;
  }).join("");
  $$(".pin").forEach((pin) => pin.addEventListener("click", () => {
    selectedMapBuilding = pin.dataset.name;
    renderMap();
  }));
  const b = BUILDINGS.find((item) => item.name === selectedMapBuilding);
  const groups = floorGroups(b);
  const available = groups.filter((group) => !isBooked(b.name, $("#map-date").value, group.id));
  const full = available.length === 0;
  const availability = b.name === "형남공학관" ? `신청 가능 구역 ${available.length}/${groups.length}` : (full ? "신청 완료" : "신청 가능");
  $("#map-detail").innerHTML = `<strong>${b.name}</strong><br>쓰레기통 ${b.bins}개 · CLEAN SCORE ${b.clean}<br>${formatDate($("#map-date").value)} ${startTimeFor($("#map-date").value)} · ${availability}<br><button class="apply" ${full ? "disabled" : ""} data-name="${b.name}">활동 신청하기</button>`;
  $("#map-detail .apply")?.addEventListener("click", () => openApply(b.name));
}

function renderAdmin() {
  renderSummary();
  renderAdminFilters();
  renderAdminList();
}

function renderSummary() {
  const apps = readApps();
  const today = todayISO();
  const items = [
    ["전체 신청 건수", apps.length],
    ["오늘 활동 팀", apps.filter((a) => a.date === today).length],
    ["인증 대기", apps.filter((a) => a.status === "인증 대기").length],
    ["인증 완료", apps.filter((a) => a.status === "인증 완료").length]
  ];
  $("#summary-grid").innerHTML = items.map(([label, value]) => `<div class="summary-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function renderAdminFilters() {
  $("#filter-building").innerHTML = `<option value="">전체 건물</option>${BUILDINGS.map((b) => `<option>${b.name}</option>`).join("")}`;
  $("#filter-status").innerHTML = `<option value="">전체 상태</option><option>신청 완료</option><option>인증 대기</option><option>인증 완료</option><option>재인증 요청</option>`;
}

function filteredApps() {
  return readApps().filter((app) => {
    return (!$("#filter-date").value || app.date === $("#filter-date").value) &&
      (!$("#filter-building").value || app.building === $("#filter-building").value) &&
      (!$("#filter-status").value || app.status === $("#filter-status").value);
  });
}

function renderAdminList() {
  const apps = filteredApps();
  if (!apps.length) {
    $("#admin-list").innerHTML = `<div class="empty">조건에 맞는 신청이 없습니다.</div>`;
    $("#admin-detail").innerHTML = "왼쪽 목록에서 신청을 선택해 주세요.";
    return;
  }
  selectedAdminId ||= apps[0].id;
  if (!apps.some((a) => a.id === selectedAdminId)) selectedAdminId = apps[0].id;
  $("#admin-list").innerHTML = apps.map((app) => `<button class="admin-row" data-id="${app.id}" aria-pressed="${app.id === selectedAdminId}"><b>${formatDate(app.date)} · ${app.building}</b><span>${app.assignmentLabel || "건물 전체"} · ${app.startTime} · ${app.applicant} · ${app.people}명</span><span>${app.status}</span></button>`).join("");
  $$(".admin-row").forEach((row) => row.addEventListener("click", () => {
    selectedAdminId = row.dataset.id;
    renderAdminList();
  }));
  renderAdminDetail();
}

function renderAdminDetail() {
  const app = readApps().find((a) => a.id === selectedAdminId);
  if (!app) return;
  const building = BUILDINGS.find((item) => item.name === app.building);
  const floors = app.floors || building?.floors || ["전체"];
  const adminCancel = app.status === "인증 완료"
    ? `<button class="admin-cancel" disabled>인증 완료 · 취소 불가</button>`
    : `<button class="admin-cancel" id="admin-cancel">신청 취소</button>`;
  $("#admin-detail").innerHTML = `<h3>${app.building}</h3><p>${formatDate(app.date)} ${app.startTime}<br>담당 구역 ${app.assignmentLabel || "건물 전체"}<br>신청자 ${app.applicant} · ${app.people}명<br>상태 ${app.status}</p><div class="admin-floor-list">${floors.map((floor) => adminFloor(app, floor)).join("")}</div><div class="admin-buttons"><button class="primary" id="approve">인증 승인</button><button class="retry" id="retry">재인증 요청</button>${adminCancel}</div>`;
  $("#approve").addEventListener("click", () => updateStatus(app.id, "인증 완료"));
  $("#retry").addEventListener("click", () => updateStatus(app.id, "재인증 요청"));
  $("#admin-cancel")?.addEventListener("click", () => cancelApplication(app.id));
}

function adminFloor(app, floor) {
  const proof = proofFor(app, floor);
  const overflow = proof.overflow?.length ? proof.overflow.join(", ") : "해당 없음";
  const misplaced = proof.misplaced?.length ? proof.misplaced.join(", ") : "해당 없음";
  return `<section class="admin-floor"><h4>${floor}층</h4><p class="photo-step">활동 전</p><div class="compare">${adminPhoto(app,floor,"beforeOverall","이름표·전체")}${adminPhoto(app,floor,"beforeInside","캔·플라스틱 내부")}</div><div class="survey-summary"><b>윗부분을 넘은 칸</b><span>${overflow}</span><b>분리수거 미준수</b><span>${misplaced}</span></div><p class="photo-step">활동 후</p><div class="compare">${adminPhoto(app,floor,"afterOverall","이름표·전체")}${adminPhoto(app,floor,"afterInside","정리된 내부")}</div></section>`;
}

function adminPhoto(app, floor, type, label) {
  const proof = proofFor(app, floor);
  const src = proof[`${type}Url`];
  const time = proof[`${type}Time`];
  return `<div><b>${label}</b>${src ? `<img src="${src}" alt="${label} 사진">` : `<div class="placeholder">${label} 사진<br>미등록</div>`}<p class="time-text">${time || "등록 시각 없음"}</p></div>`;
}

function updateStatus(id, status) {
  let changedApp = null;
  writeApps(readApps().map((app) => {
    if (app.id !== id) return app;
    changedApp = { ...app, status };
    return changedApp;
  }));
  if (changedApp) persistRemoteApp(changedApp).catch(console.error);
  renderAdmin();
}

function downloadCsv() {
  const header = ["활동일","건물","담당 구역","층","시작시간","신청자","인원","활동 전 전체 사진","활동 전 내부 사진","활동 후 전체 사진","활동 후 내부 사진","포화 쓰레기통","분리수거 미준수 폐기물","상태"];
  const rows = readApps().flatMap((a) => {
    const building = BUILDINGS.find((item) => item.name === a.building);
    return (a.floors || building?.floors || ["전체"]).map((floor) => {
      const proof = proofFor(a, floor);
      return [formatDate(a.date), a.building, a.assignmentLabel || "건물 전체", `${floor}층`, a.startTime, a.applicant, a.people, proof.beforeOverallTime, proof.beforeInsideTime, proof.afterOverallTime, proof.afterInsideTime, (proof.overflow || []).join(" / "), (proof.misplaced || []).join(" / "), a.status];
    });
  });
  const csv = "\uFEFF" + [header, ...rows].map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sgs-volunteer-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

$("#student-demo").addEventListener("click", () => setSession("student"));
$("#student-logout").addEventListener("click", clearSession);
$("#admin-logout").addEventListener("click", clearSession);
$("#admin-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if ($("#admin-id").value === ADMIN_ID && $("#admin-password").value === ADMIN_PASSWORD) {
    $("#login-error").textContent = "";
    setSession("admin");
  } else {
    $("#login-error").textContent = "관리자 ID 또는 비밀번호를 확인해 주세요.";
  }
});
$("#search-input").addEventListener("input", renderBuildings);
$("#guide-cancel").addEventListener("click", () => $("#guide-dialog").close());
$("#start-quiz").addEventListener("click", () => {
  $("#guide-dialog").close();
  $("#quiz-dialog").showModal();
});
$("#quiz-back").addEventListener("click", () => {
  $("#quiz-dialog").close();
  $("#guide-dialog").showModal();
});
$("#quiz-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const answers = new FormData(event.currentTarget);
  if (answers.get("q1") === "a" && answers.get("q2") === "b" && answers.get("q3") === "a") {
    quizPassed = true;
    $("#quiz-error").textContent = "";
    $("#quiz-dialog").close();
    openApplicationForm();
  } else {
    $("#quiz-error").textContent = "아직 맞지 않은 답이 있어요. 가이드를 다시 확인해 주세요.";
  }
});
$("#cancel").addEventListener("click", () => $("#apply-dialog").close());
$("#confirm").addEventListener("click", confirmApply);
$("#apply-date").addEventListener("change", updateApplyDetail);
$("#apply-assignment").addEventListener("change", updateApplyDetail);
$("#map-date").addEventListener("change", renderMap);
$(".bottom-nav").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-page]");
  if (button) showPage(button.dataset.page);
});
["filter-date","filter-building","filter-status"].forEach((id) => $(`#${id}`).addEventListener("change", renderAdminList));
$("#excel-download").addEventListener("click", downloadCsv);

renderAuth();
syncRemoteApps().then(renderAuth).catch((error) => console.warn("Supabase 동기화 대기:", error));
