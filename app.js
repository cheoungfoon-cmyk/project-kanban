const state = {
  board: null,
  query: "",
  filter: "all",
  itemFilter: null,
  view: "overview",
  selectedPath: "",
  focusedItemName: ""
};

const rootPath = document.querySelector("#rootPath");
const stats = document.querySelector("#stats");
const viewRoot = document.querySelector("#viewRoot");
const sideList = document.querySelector("#sideList");
const searchInput = document.querySelector("#searchInput");

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function listItems(items, limit = 3) {
  const visible = (items || []).slice(0, limit);
  if (!visible.length) return `<p class="empty compact">暂无条目</p>`;
  return `<ul>${visible.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function matches(item, query) {
  if (!query) return true;
  return JSON.stringify(item).toLowerCase().includes(query.toLowerCase());
}

function projectColumn(project) {
  if (project.risks?.some((risk) => /红|合同到期|暂停|偏差|风险|未定|不确定/.test(risk))) return "高风险";
  if (/P0/i.test(project.level)) return "P0";
  if (/完成|已上线|绿/i.test(project.status)) return "稳定";
  return "P1/推进";
}

function filteredProjects() {
  return state.board.projects.filter((project) => {
    if (!matches(project, state.query)) return false;
    if (state.filter === "all") return true;
    if (state.filter === "风险") return projectColumn(project) === "高风险";
    if (state.filter === "稳定") return projectColumn(project) === "稳定";
    return project.level.includes(state.filter);
  });
}

function itemStage(item) {
  if (item.stage) return item.stage;
  const text = `${item.type || ""} ${item.next || ""} ${item.risk || ""}`;
  if (/合同|续签|签署|法务/.test(text)) return "合同签署";
  if (/上线|运营|试点|优先随单/.test(text)) return "正式上线/运营验证";
  if (/开发|联调|测试|规则整理|推进中/.test(text)) return "产品开发/联调测试";
  if (/方案|准入|孵化|待补充|Demo|设计/.test(text)) return "方案确认";
  if (/商务|沟通|待对齐|低频关注/.test(text)) return "商务沟通";
  if (/暂停|待领导|待同步/.test(text)) return "推进管理";
  return "推进管理";
}

function isRiskItem(item) {
  return /风险|暂停|无法|不能|不明确|未定|缺少|待补充|待同步|慢|不满|超时|架空|到期|无效|偏差|不对称|沉淀/.test(`${item.type || ""} ${item.risk || ""} ${item.next || ""}`);
}

function itemBucket(item) {
  if (item.parentProject === "待建项") return "待建项";
  if (/孵化中|待补充|低频关注/.test(item.type || "")) return "孵化中";
  if (/暂停/.test(item.type || "")) return "暂停";
  return "推进中";
}

function itemMatchesFilter(item) {
  const filter = state.itemFilter;
  if (!filter) return true;
  if (filter.kind === "bucket") return itemBucket(item) === filter.value;
  if (filter.kind === "owner") return item.owner === filter.value;
  if (filter.kind === "stage") return itemStage(item) === filter.value;
  if (filter.kind === "risk") return isRiskItem(item);
  if (filter.kind === "all") return true;
  return true;
}

function filteredProjectItems() {
  return (state.board.projectItems || []).filter((item) => matches(item, state.query) && itemMatchesFilter(item));
}

function itemFilterLabel() {
  const filter = state.itemFilter;
  if (!filter) return "";
  if (filter.kind === "risk") return "风险小项";
  if (filter.kind === "all") return "全部小项";
  return filter.value;
}

function cssId(path) {
  return `p-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function renderStats() {
  const { counts } = state.board;
  const items = [
    ["小项", counts.projectItems || counts.projects, "projects", "projectItems"],
    ["周报", counts.weekly, "weekly", ""],
    ["日志", counts.logs || 0, "logs", ""],
    ["人员", counts.people, "team", ""],
    ["风险", counts.risks, "overview", "riskLedger"]
  ];
  stats.innerHTML = items.map(([label, value, view, section]) => `
    <button class="stat" data-view-jump="${view}" ${section ? `data-section="${section}"` : ""}>
      <b>${value}</b><span>${label}</span>
    </button>
  `).join("");
}

function renderSideList() {
  if (state.view === "projects") {
    const projects = filteredProjects();
    sideList.innerHTML = projects.map((project) => `
      <button class="nav-item ${project.path === state.selectedPath ? "active" : ""}" data-select="${escapeHtml(project.path)}">
        <span>
          <strong>${escapeHtml(project.title)}</strong><br>
          <span>${escapeHtml(project.status)}</span>
        </span>
        <span class="badge">${escapeHtml(project.level)}</span>
      </button>
    `).join("");
    return;
  }

  const shortcuts = {
    overview: [],
    weekly: ["汇总周报", "项目周报", "成员周报"],
    logs: (state.board.dailyLog?.entries || []).map((entry) => entry.date),
    team: state.board.team.members.map((member) => member.name)
  }[state.view] || [];
  sideList.innerHTML = shortcuts.map((label) => `<div class="side-chip">${escapeHtml(label)}</div>`).join("");
}

function todayTile(name) {
  const items = state.board.today?.groups?.[name] || [];
  return `
    <article class="today-group compact">
      <h3>${escapeHtml(name)}</h3>
      ${listItems(items, 2)}
    </article>
  `;
}

function parseBoardDate() {
  const text = state.board.today?.updatedAt || "";
  const match = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
}

const chinaHolidayOverrides = new Set([]);
const chinaWorkdayOverrides = new Set([]);

function isChinaWorkday(date) {
  const key = dateKey(date);
  if (chinaWorkdayOverrides.has(key)) return true;
  if (chinaHolidayOverrides.has(key)) return false;
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function ownerForTodayItem(item) {
  const text = String(item || "");
  const direct = text.match(/^对([^：:]+)[：:]/);
  if (direct) return direct[1].trim();
  const prefix = text.match(/^([^：:]+)[：:]/)?.[1]?.trim() || "";
  const rules = [
    [/二手车线索|充电券|汇隆思|天猫|高德/, "严相"],
    [/底盘检测|中保车服|猿金刚|电暴猿|壹电利|充电生态/, "杨宛博"],
    [/渝秒充|喵充充|金融贷中|车生活|闲鱼|车辆估值|静态数据|家充桩|充电桩金融|保险入会/, "张欢"],
    [/九音/, "九音"],
    [/数科商务/, "数科商务"],
    [/项目负责人/, "项目负责人"]
  ];
  const hit = rules.find(([pattern]) => pattern.test(`${prefix} ${text}`));
  return hit ? hit[1] : "待确认";
}

function delayStartForTodayBoard() {
  const boardDate = parseBoardDate();
  if (!boardDate) return null;
  const now = new Date();
  if (!isChinaWorkday(now) || !isChinaWorkday(boardDate)) return null;
  return new Date(boardDate.getFullYear(), boardDate.getMonth(), boardDate.getDate(), 18, 0, 0, 0);
}

function trackingKeywords(item) {
  const text = String(item || "");
  const known = [
    "渝秒充", "二手车线索", "闲鱼估值", "车辆估值", "静态数据", "家充桩",
    "壹电利", "喵充充", "金融贷中", "车生活", "AI Agent", "汇隆思",
    "天猫", "高德", "ETC", "充电券", "充电桩金融", "底盘检测",
    "中保车服", "猿金刚", "电暴猿", "电爆猿", "保险入会"
  ];
  const hits = known.filter((keyword) => text.includes(keyword));
  const prefix = text.match(/^([^：:]+)[：:]/)?.[1]?.trim();
  if (prefix && !/^对/.test(prefix) && !hits.includes(prefix)) hits.unshift(prefix);
  return hits;
}

function isWorkLogBlock(block) {
  const title = String(block?.title || "");
  if (/自动同步|工作日同步|Delay|规则|提纲|口径修正/.test(title)) return false;
  return true;
}

function syncedWorkText(dayKey) {
  const entry = (state.board.dailyLog?.entries || []).find((item) => item.date === dayKey);
  return (entry?.blocks || [])
    .filter(isWorkLogBlock)
    .map((block) => `${block.title || ""}\n${(block.items || []).join("\n")}`)
    .join("\n");
}

function itemSyncStatus(item, dayKey) {
  const keywords = trackingKeywords(item);
  if (!keywords.length) return { synced: false, keyword: "" };
  const text = syncedWorkText(dayKey);
  const hit = keywords.find((keyword) => text.includes(keyword));
  return { synced: Boolean(hit), keyword: hit || keywords[0] };
}

function todayDelayItems() {
  const start = delayStartForTodayBoard();
  if (!start) return [];
  const now = new Date();
  if (now <= start) return [];
  const dayKey = dateKey(start);
  const delay = formatDuration(Math.floor((now - start) / 60000));
  const groups = state.board.today?.groups || {};
  const sources = [
    ["今日必须完成", groups["今日必须完成"] || []],
    ["等待反馈事项", groups["等待反馈事项"] || []],
    ["今日待回复", groups["今日待回复"] || []]
  ];
  return sources.flatMap(([group, items]) => items.map((item) => {
    const status = itemSyncStatus(item, dayKey);
    return {
      group,
      item,
      owner: ownerForTodayItem(item),
      delay,
      synced: status.synced,
      keyword: status.keyword
    };
  })).sort((a, b) => Number(a.synced) - Number(b.synced));
}

function renderTodayDelayPanel() {
  const entries = todayDelayItems();
  if (!entries.length) return "";
  const delayCount = entries.filter((entry) => !entry.synced).length;
  const syncedCount = entries.length - delayCount;
  return `
    <section class="today-delay-panel">
      <div class="section-head tight">
        <div>
          <p class="eyebrow">今日事项 · 逐项同步追踪</p>
          <h3>今日事项 Delay</h3>
          <small>已同步 ${syncedCount} · Delay ${delayCount}</small>
        </div>
        <strong>${delayCount}</strong>
      </div>
      <div class="delay-list">
        ${entries.slice(0, 12).map((entry) => `
          <article class="delay-row ${entry.synced ? "synced" : "delayed"}">
            <span>${escapeHtml(entry.group)}</span>
            <b>${escapeHtml(entry.owner)}</b>
            <em>${entry.synced ? "已同步" : escapeHtml(entry.delay)}</em>
            <i>${escapeHtml(entry.keyword || "待识别")}</i>
            <p>${escapeHtml(entry.item)}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderMiniCard(project) {
  const kind = projectColumn(project);
  const className = kind === "P0" ? "p0" : kind === "高风险" ? "risk" : kind === "稳定" ? "done" : "p1";
  return `
    <article class="mini-card ${className}" data-select="${escapeHtml(project.path)}" data-section="projectItems">
      <div class="card-title">
        <h4>${escapeHtml(project.title)}</h4>
        <span class="badge">${escapeHtml(project.level)}</span>
      </div>
      <div class="meta">
        <span>${escapeHtml(project.status)}</span>
        <span>${escapeHtml(project.owner)}</span>
      </div>
      <p class="one-line">${escapeHtml(project.next?.[0] || project.risks?.[0] || "暂无下一步")}</p>
    </article>
  `;
}

function renderOverview() {
  const projects = filteredProjects();
  const items = (state.board.projectItems || []).filter((item) => matches(item, state.query));
  const groups = { P0: [], "P1/推进": [], 高风险: [], 稳定: [] };
  for (const project of projects) groups[projectColumn(project)].push(project);

  viewRoot.innerHTML = `
    ${renderDashboard(items, projects)}
    <section class="overview-grid">
      <div class="today-band short">
        ${["今日必须完成", "今日推进事项", "等待反馈事项", "今日待回复"].map(todayTile).join("")}
      </div>
      ${renderTodayDelayPanel()}
      <section class="risk-panel" id="riskLedger">
        <div class="section-head tight">
          <h3>风险台账</h3>
          <button class="icon-button" data-refresh title="刷新">↻</button>
        </div>
        <div class="risk-list compact-list">
          ${(state.board.cockpit.risks || []).slice(0, 5).map((item) => `
            <article class="risk-row" data-risk-project="${escapeHtml(item.project)}">
              <b>${escapeHtml(item.level)}</b>
              <span>${escapeHtml(item.risk)}</span>
              <em>${escapeHtml(item.project)}</em>
            </article>
          `).join("") || `<div class="empty compact">暂无风险</div>`}
        </div>
      </section>
    </section>

    <section class="compact-columns">
      ${Object.entries(groups).map(([name, items]) => `
        <section class="compact-column">
          <button class="column-head jump-head" data-category-filter="${escapeHtml(name)}">
            <h3>${escapeHtml(name)}</h3>
            <span class="count">${items.length}</span>
          </button>
          <div class="mini-cards">
            ${items.length ? items.slice(0, 2).map(renderMiniCard).join("") : `<div class="empty compact">暂无项目</div>`}
            ${items.length > 2 ? `<button class="more-button" data-category-filter="${escapeHtml(name)}">${items.length - 2} 个更多</button>` : ""}
          </div>
        </section>
      `).join("")}
    </section>
  `;
}

function renderDashboard(items, projects) {
  const byBucket = countByValue(items, itemBucket);
  const byOwner = countBy(items, "owner");
  const stageCounts = countByValue(items, itemStage);
  const riskCount = state.board.cockpit?.risks?.length || state.board.counts?.risks || 0;
  const mustDo = state.board.today?.groups?.["今日必须完成"] || [];
  const waiting = state.board.today?.groups?.["等待反馈事项"] || [];
  const focusItems = [...mustDo.slice(0, 3), ...waiting.slice(0, 2)];
  const maxOwnerCount = Math.max(...Object.values(byOwner), 1);
  const progressCount = byBucket["推进中"] || 0;
  const progressPercent = Math.round(progressCount / Math.max(items.length, 1) * 100);
  const sync = dailySyncStatus();

  return `
    <section class="sync-alert ${sync.state}">
      <div>
        <span>${escapeHtml(sync.title)}</span>
        <p>${escapeHtml(sync.message)}</p>
      </div>
      <strong>${escapeHtml(sync.badge)}</strong>
    </section>
    <section class="dashboard-grid">
      <article class="dashboard-card overview-card">
        <div class="dashboard-head">
          <span>项目总览</span>
          <button class="metric-number" data-item-filter-kind="all" data-item-filter-value="全部小项">${items.length}</button>
        </div>
        <div class="overview-visual">
          <button class="donut metric-click" style="--p:${progressPercent}" data-item-filter-kind="bucket" data-item-filter-value="推进中">
            <strong>${progressCount}</strong>
            <span>推进中</span>
          </button>
          <div class="metric-stack">
            <button data-item-filter-kind="bucket" data-item-filter-value="孵化中"><strong>${byBucket["孵化中"] || 0}</strong><span>孵化中</span></button>
            <button data-item-filter-kind="bucket" data-item-filter-value="待建项"><strong>${byBucket["待建项"] || 0}</strong><span>待建项</span></button>
            <button data-view-jump="overview" data-section="riskLedger"><strong>${riskCount}</strong><span>风险</span></button>
          </div>
        </div>
      </article>

      <article class="dashboard-card">
        <div class="dashboard-head">
          <span>负责人负载</span>
        </div>
        <div class="owner-loads">
          ${Object.entries(byOwner).map(([owner, count]) => `
            <button class="load-row" data-item-filter-kind="owner" data-item-filter-value="${escapeHtml(owner)}">
              <label>${escapeHtml(owner)}</label>
              <div class="load-track"><i style="width:${Math.round(count / maxOwnerCount * 100)}%"></i></div>
              <b>${count}</b>
            </button>
          `).join("")}
        </div>
      </article>

      <article class="dashboard-card">
        <div class="dashboard-head">
          <span>项目阶段漏斗</span>
        </div>
        <div class="funnel-chart">
          ${["商务沟通", "方案确认", "合同签署", "产品开发/联调测试", "正式上线/运营验证", "推进管理"].map((stage, index) => `
            <button class="funnel-layer" style="--w:${100 - index * 10}%" data-item-filter-kind="stage" data-item-filter-value="${escapeHtml(stage)}">
              <span>${escapeHtml(stage)}</span>
              <b>${stageCounts[stage] || 0}</b>
            </button>
          `).join("")}
        </div>
      </article>

      <article class="dashboard-card focus-card">
        <div class="dashboard-head">
          <span>本周关键节点</span>
        </div>
        <div class="focus-timeline">
          ${focusItems.slice(0, 5).map((item, index) => `
            <div class="timeline-item">
              <i>${index + 1}</i>
              <span>${escapeHtml(item)}</span>
            </div>
          `).join("") || `<p class="empty compact">暂无关键节点</p>`}
        </div>
      </article>
    </section>
  `;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function minutesToClock(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function blockMinutes(title) {
  const text = String(title || "");
  const match = text.match(/(\d{1,2})[:：](\d{2})/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  if (/早间|早上|上午/.test(text)) return 9 * 60;
  if (/中午|午间/.test(text)) return 12 * 60;
  if (/下午/.test(text)) return 15 * 60;
  if (/晚间|晚上|傍晚/.test(text)) return 18 * 60;
  return null;
}

function latestDailyLogMinutes(dayKey) {
  const entry = (state.board.dailyLog?.entries || []).find((item) => item.date === dayKey);
  const blockTimes = (entry?.blocks || []).map((block) => blockMinutes(block.title)).filter((value) => value !== null);
  return blockTimes.length ? Math.max(...blockTimes) : null;
}

function formatDuration(minutes) {
  const safeMinutes = Math.max(0, minutes);
  const hour = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;
  if (!hour) return `${minute}分钟`;
  if (!minute) return `${hour}小时`;
  return `${hour}小时${minute}分钟`;
}

function dailySyncStatus() {
  const now = new Date();
  const today = dateKey(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const slots = [9 * 60, 12 * 60, 18 * 60];
  if (!isChinaWorkday(now)) {
    return {
      state: "pending",
      title: "周末休眠中",
      message: "每日待办与同步提醒只在中国工作日执行，周末不计 Delay。",
      badge: "休息日"
    };
  }
  const dueSlot = slots.filter((slot) => slot <= nowMinutes).pop();
  const nextSlot = slots.find((slot) => slot > nowMinutes);
  const latest = latestDailyLogMinutes(today);

  if (!dueSlot) {
    return {
      state: "pending",
      title: "今日同步待开始",
      message: `下一次同步 ${minutesToClock(nextSlot || slots[0])}，暂不需要处理。`,
      badge: "待同步"
    };
  }

  if (latest !== null && latest >= dueSlot) {
    return {
      state: "ok",
      title: "每日跟进已同步",
      message: `最近同步已覆盖 ${minutesToClock(dueSlot)} 节点。`,
      badge: "OK"
    };
  }

  const delay = formatDuration(nowMinutes - dueSlot);
  return {
    state: "delay",
    title: "每日跟进同步 Delay",
    message: `应在 ${minutesToClock(dueSlot)} 完成同步，当前已延迟 ${delay}。请补充今日项目进展、风险、下一步动作和完成信息。`,
    badge: delay
  };
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "待确认";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function countByValue(items, getValue) {
  return items.reduce((acc, item) => {
    const value = getValue(item) || "待确认";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function selectedProject() {
  const projects = filteredProjects();
  if (!state.selectedPath || !projects.some((project) => project.path === state.selectedPath)) {
    state.selectedPath = projects[0]?.path || "";
  }
  return projects.find((project) => project.path === state.selectedPath);
}

function sectionId(section) {
  return {
    majorProjects: "majorProjects",
    projectItems: "projectItems",
    projectProgress: "projectProgress",
    projectRisk: "projectRisk",
    riskLedger: "riskLedger"
  }[section] || section;
}

function syncMenu() {
  document.querySelectorAll(".menu-item").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
}

function scrollToSection(section) {
  if (!section) return;
  window.requestAnimationFrame(() => {
    document.querySelector(`#${sectionId(section)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function setView(view, section = "") {
  state.view = view;
  syncMenu();
  render();
  scrollToSection(section);
}

function categoryToFilter(category) {
  if (category === "高风险") return "风险";
  if (category === "P1/推进") return "P1";
  if (category === "稳定") return "稳定";
  return category;
}

function selectProject(path, section = "projectProgress", focusedItemName = "") {
  if (path) state.selectedPath = path;
  state.focusedItemName = focusedItemName;
  setView("projects", section);
}

function renderProjects() {
  const project = selectedProject();
  if (!project) {
    viewRoot.innerHTML = `<div class="empty">没有匹配的项目</div>`;
    return;
  }
  const projects = filteredProjects();
  const projectItems = filteredProjectItems();
  const activeItem = projectItems.find((item) => item.parentPath === project.path && item.name === state.focusedItemName)
    || projectItems.find((item) => item.parentPath === project.path);
  viewRoot.innerHTML = `
    <section class="project-management secondary-management" id="majorProjects">
      <div class="section-head management-head">
        <div>
          <p class="eyebrow">第一层 · 大项目</p>
          <h3>大项目管理台账</h3>
        </div>
      </div>
      <div class="project-table-wrap">
        <table class="project-table">
          <thead>
            <tr>
              <th>项目</th>
              <th>负责人</th>
              <th>角色</th>
              <th>当前阶段</th>
              <th>状态</th>
              <th>下一关键动作</th>
              <th>风险/支持</th>
            </tr>
          </thead>
          <tbody>
            ${projects.map((item) => `
              <tr class="${item.path === project.path ? "selected" : ""}" data-select="${escapeHtml(item.path)}" data-section="projectItems">
                <td>
                  <strong>${escapeHtml(item.title)}</strong>
                  <span>${escapeHtml(item.level)}</span>
                </td>
                <td>${escapeHtml(item.owner)}</td>
                <td>${escapeHtml(item.ownerRole)}</td>
                <td>${escapeHtml(item.stage)}</td>
                <td>${escapeHtml(item.status)}</td>
                <td>${escapeHtml(item.management?.plan || "")}</td>
                <td>
                  <b>${escapeHtml(item.management?.risk || "")}</b>
                  <em>${escapeHtml(item.supportNeed || "")}</em>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="project-management" id="projectItems">
      <div class="section-head management-head">
        <div>
          <p class="eyebrow">第二层 · 小项目${itemFilterLabel() ? ` · 当前筛选：${escapeHtml(itemFilterLabel())}` : ""}</p>
          <h3>项目小项台账</h3>
        </div>
        <div class="head-actions">
          ${state.itemFilter ? `<button class="open-button inline" data-clear-item-filter>清除筛选</button>` : ""}
          <button class="open-button inline" data-open="${escapeHtml(project.path)}">打开当前项目</button>
        </div>
      </div>
      <div class="project-table-wrap">
        <table class="project-table item-table">
          <thead>
            <tr>
              <th>项目名称</th>
              <th>等级</th>
              <th>项目类型</th>
              <th>项目负责人</th>
              <th>关联项目</th>
              <th>下一关键动作</th>
              <th>风险/支持</th>
            </tr>
          </thead>
          <tbody>
            ${projectItems.map((item) => `
              <tr class="${item.name === state.focusedItemName ? "selected" : ""}" data-select="${escapeHtml(item.parentPath)}" data-section="projectProgress" data-item-name="${escapeHtml(item.name)}">
                <td><strong>${escapeHtml(item.name)}</strong></td>
                <td><span class="level-chip ${item.level === "P0" ? "p0-chip" : ""}">${escapeHtml(item.level || "P1")}</span></td>
                <td><span class="type-chip ${item.type === "孵化中" ? "incubating" : ""}">${escapeHtml(item.type)}</span></td>
                <td>${escapeHtml(item.owner)}</td>
                <td>${escapeHtml(item.parentProject)}</td>
                <td>${escapeHtml(item.next)}</td>
                <td>
                  <b>${escapeHtml(item.risk)}</b>
                  <em>${escapeHtml(item.supportNeed)}</em>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="7"><div class="empty compact">当前筛选下暂无小项</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    <section class="project-detail management-detail" id="projectProgress">
      <div class="detail-header">
        <div>
          <p class="eyebrow">第三层 · 跟进情况 · ${escapeHtml(project.level)} · ${escapeHtml(project.owner)} · ${escapeHtml(project.ownerRole)} · ${escapeHtml(project.updatedAt)}</p>
          <h3>${escapeHtml(project.title)}</h3>
          <p class="owner-work">${escapeHtml(project.ownerWork)}</p>
        </div>
        <span class="stage-pill">${escapeHtml(project.stage)}</span>
      </div>
      <div class="detail-grid">
        ${activeItem ? `
        <article class="active-item-card">
          <h4>项目背景</h4>
          <p><strong>${escapeHtml(activeItem.name)}</strong></p>
          <p>${escapeHtml(activeItem.background || project.background || "待补充")}</p>
        </article>
        <article class="active-item-card">
          <h4>业务逻辑</h4>
          <p>${escapeHtml(activeItem.logic || "待补充")}</p>
        </article>
        <article class="active-item-card">
          <h4>当前进展</h4>
          <p>${escapeHtml(activeItem.progress || activeItem.next)}</p>
        </article>
        <article class="active-item-card">
          <h4>客户/联系人</h4>
          <p>${escapeHtml(activeItem.contacts || "联系人待补充")}</p>
        </article>
        ` : ""}
        <article class="${activeItem ? "" : "active-item-card"}">
          <h4>大项目背景</h4>
          <p>${escapeHtml(project.background || "待补充")}</p>
        </article>
        <article>
          <h4>项目目标</h4>
          <p>${escapeHtml(project.management?.goal)}</p>
        </article>
        <article>
          <h4>推进计划</h4>
          ${activeItem ? `<p>${escapeHtml(activeItem.next)}</p>` : listItems(project.next, 5)}
        </article>
        <article id="projectRisk">
          <h4>风险与协调</h4>
          <p>${escapeHtml(activeItem?.risk || project.management?.risk)}</p>
          <p class="support-line">${escapeHtml(project.management?.support)}</p>
        </article>
      </div>
    </section>
  `;
}

function renderWeekly() {
  const reports = state.board.weeklyReports.filter((report) => matches(report, state.query));
  const current = reports.find((report) => report.path === "项目周报.md") || reports[0];
  const history = reports.filter((report) => report !== current);
  viewRoot.innerHTML = `
    <section class="weekly-workspace">
      <article class="current-report">
        <div class="section-head management-head">
          <div>
            <p class="eyebrow">每日更新 · 周五 17:50 固化最终汇报</p>
            <h3>本周周报</h3>
          </div>
          ${current ? `<button class="open-button inline" data-open="${escapeHtml(current.path)}">打开本周周报</button>` : ""}
        </div>
        ${current ? `
          <div class="current-report-body">
            <div class="card-title">
              <h4>${escapeHtml(current.title)}</h4>
              <span class="badge">${escapeHtml(current.updatedAt || "本周")}</span>
            </div>
            <div class="weekly-full-report">
              ${(current.sections || []).map(renderWeeklySection).join("") || listItems(current.highlights, 8)}
            </div>
          </div>
        ` : `<div class="empty">没有找到本周周报</div>`}
      </article>

      <aside class="history-reports">
        <div class="section-head management-head">
          <div>
            <p class="eyebrow">历史归档 · 项目周报 · 同事周报</p>
            <h3>历史周报</h3>
          </div>
        </div>
        <details open>
          <summary>我的历史周报</summary>
          <div class="history-list">
            ${history.filter((report) => report.scope !== "成员周报").map(renderHistoryReport).join("") || `<div class="empty compact">暂无历史周报</div>`}
          </div>
        </details>
        <details>
          <summary>同事周报</summary>
          <div class="history-list">
            ${history.filter((report) => report.scope === "成员周报").map(renderHistoryReport).join("") || `<div class="empty compact">暂无同事周报</div>`}
          </div>
        </details>
      </aside>
    </section>
  `;
}

function renderWeeklySection(section) {
  return `
    <section class="weekly-section">
      <h4>${escapeHtml(section.title)}</h4>
      ${renderMarkdownLite(section.body)}
    </section>
  `;
}

function renderMarkdownLite(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let list = [];
  const flushList = () => {
    if (!list.length) return;
    html.push(`<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
    list = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    const h3 = trimmed.match(/^###\s+(.+)$/);
    if (h3) {
      flushList();
      html.push(`<h5>${escapeHtml(h3[1])}</h5>`);
      continue;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flushList();
    html.push(`<p>${escapeHtml(trimmed)}</p>`);
  }
  flushList();
  return html.join("");
}

function renderHistoryReport(report) {
  return `
    <article class="history-report">
      <div>
        <strong>${escapeHtml(report.title)}</strong>
        <span>${escapeHtml(report.scope)} · ${escapeHtml(report.updatedAt || report.path)}</span>
      </div>
      <button class="open-button inline small" data-open="${escapeHtml(report.path)}">打开</button>
    </article>
  `;
}

function renderTeam() {
  const evaluations = (state.board.team.evaluations || []).filter((item) => matches(item, state.query));
  viewRoot.innerHTML = `
    <section class="people-dashboard">
      <div class="section-head management-head">
        <div>
          <p class="eyebrow">AI综合评分 · 趋势判断 · 成长建议</p>
          <h3>人员管理</h3>
        </div>
      </div>
      <div class="evaluation-grid">
      ${evaluations.map((evaluation) => {
        const avg = Number(evaluation.avg || 0);
        const trend = evaluation.trend;
        const trendLabel = trend === null ? "首次" : trend > 0 ? `+${trend.toFixed(1)}` : trend.toFixed(1);
        const trendClass = trend === null ? "flat" : trend >= 0 ? "up" : "down";
        return `
          <article class="evaluation-card">
            <div class="card-title">
              <div>
                <h4>${escapeHtml(evaluation.name)}</h4>
                <span class="muted">${escapeHtml(evaluation.date || "最新评估")} · 已纳入 ${escapeHtml(evaluation.history?.length || 1)} 期评估</span>
              </div>
              <div class="score-stack">
                <span class="score-badge">${avg.toFixed(1)}</span>
                <span class="trend-badge ${trendClass}">${escapeHtml(trendLabel)}</span>
              </div>
            </div>
            <div class="score-grid">
              ${Object.entries(evaluation.scores || {}).map(([name, value]) => `
                <div class="score-row">
                  <span>${escapeHtml(name)}</span>
                  <div class="score-track"><i style="width:${Math.min(value / 5 * 100, 100)}%"></i></div>
                  <b>${escapeHtml(value)}</b>
                </div>
              `).join("")}
            </div>
            <div class="eval-columns">
              <section>
                <strong>本周亮点</strong>
                ${listItems(evaluation.highlights, 3)}
              </section>
              <section>
                <strong>风险预警</strong>
                ${listItems(evaluation.risks, 3)}
              </section>
              <section>
                <strong>成长建议</strong>
                ${listItems(evaluation.growth, 3)}
              </section>
              <section>
                <strong>培训建议</strong>
                ${listItems(evaluation.training, 4)}
              </section>
            </div>
            <div class="card-actions">
              <button class="open-button" data-open="${escapeHtml(evaluation.path)}">打开最新评估</button>
              ${evaluation.history?.[1] ? `<button class="open-button inline" data-open="${escapeHtml(evaluation.history[1].path)}">查看上一期</button>` : ""}
            </div>
          </article>
        `;
      }).join("") || `<div class="empty">没有匹配的能力评估</div>`}
      </div>
    </section>
  `;
}

function renderLogs() {
  const log = state.board.dailyLog;
  const entries = (log?.entries || []).filter((entry) => matches(entry, state.query));
  viewRoot.innerHTML = `
    <section class="log-workspace">
      <div class="section-head management-head">
        <div>
          <p class="eyebrow">每日沟通 · 文件更新 · 看板同步</p>
          <h3>每日工作日志</h3>
        </div>
        ${log ? `<button class="open-button inline" data-open="${escapeHtml(log.path)}">打开日志文件</button>` : ""}
      </div>
      <div class="log-list">
        ${entries.map((entry) => `
          <article class="log-entry">
            <div class="log-date">${escapeHtml(entry.date)}</div>
            <div class="log-blocks">
              ${(entry.blocks || []).map((block) => `
                <section class="log-block">
                  <h4>${escapeHtml(block.title)}</h4>
                  ${listItems(block.items, 12)}
                </section>
              `).join("")}
            </div>
          </article>
        `).join("") || `<div class="empty">暂无日志</div>`}
      </div>
    </section>
  `;
}

function render() {
  rootPath.textContent = state.board.root;
  renderStats();
  renderSideList();
  if (state.view === "overview") renderOverview();
  if (state.view === "projects") renderProjects();
  if (state.view === "weekly") renderWeekly();
  if (state.view === "logs") renderLogs();
  if (state.view === "team") renderTeam();
}

async function loadBoard() {
  let response = await fetch("/api/board").catch(() => null);
  if (!response?.ok) {
    response = await fetch("board.json", { cache: "no-store" }).catch(() => null);
  }
  if (!response?.ok) throw new Error("加载看板失败");
  state.board = await response.json();
  render();
}

async function openMarkdown(path) {
  await fetch(`/api/open?path=${encodeURIComponent(path)}`).catch(() => null);
}

document.addEventListener("click", (event) => {
  const menuItem = event.target.closest(".menu-item");
  if (menuItem) {
    setView(menuItem.dataset.view, menuItem.dataset.view === "projects" ? "majorProjects" : "");
    return;
  }

  const viewJump = event.target.closest("[data-view-jump]");
  if (viewJump) {
    setView(viewJump.dataset.viewJump, viewJump.dataset.section || "");
    return;
  }

  const category = event.target.closest("[data-category-filter]");
  if (category) {
    state.itemFilter = null;
    state.filter = categoryToFilter(category.dataset.categoryFilter);
    document.querySelectorAll(".filter").forEach((button) => button.classList.toggle("active", button.dataset.filter === state.filter));
    const firstProject = filteredProjects()[0];
    state.selectedPath = firstProject?.path || "";
    setView("projects", "projectItems");
    return;
  }

  const filterButton = event.target.closest(".filter");
  if (filterButton) {
    state.itemFilter = null;
    state.filter = filterButton.dataset.filter;
    document.querySelectorAll(".filter").forEach((button) => button.classList.toggle("active", button === filterButton));
    render();
    return;
  }

  const itemFilter = event.target.closest("[data-item-filter-kind]");
  if (itemFilter) {
    state.itemFilter = {
      kind: itemFilter.dataset.itemFilterKind,
      value: itemFilter.dataset.itemFilterValue || ""
    };
    const firstItem = filteredProjectItems()[0];
    state.selectedPath = firstItem?.parentPath || state.selectedPath;
    state.focusedItemName = firstItem?.name || "";
    setView("projects", "projectItems");
    return;
  }

  if (event.target.closest("[data-clear-item-filter]")) {
    state.itemFilter = null;
    render();
    scrollToSection("projectItems");
    return;
  }

  const select = event.target.closest("[data-select]");
  if (select) {
    selectProject(select.dataset.select, select.dataset.section || "projectProgress", select.dataset.itemName || "");
    return;
  }

  const riskRow = event.target.closest("[data-risk-project]");
  if (riskRow) {
    const project = state.board.projects.find((item) => item.title.includes(riskRow.dataset.riskProject) || riskRow.dataset.riskProject.includes(item.title));
    if (project) selectProject(project.path, "projectRisk");
    else scrollToSection("riskLedger");
    return;
  }

  const openButton = event.target.closest("[data-open]");
  if (openButton) {
    openMarkdown(openButton.dataset.open);
    return;
  }

  if (event.target.closest("[data-refresh]")) loadBoard();
});

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  render();
});

loadBoard().catch((error) => {
  document.body.innerHTML = `<main class="workspace"><p class="empty">${escapeHtml(error.message)}</p></main>`;
});
