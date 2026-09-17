(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { report: null, sessions: [], selected: 0, sourceName: "" };

  const fileInput = $("#report-file");
  const dropZone = $("#drop-zone");
  const reportView = $("#report-view");
  const errorMessage = $("#error-message");
  const printButton = $("#print-report");

  function directChildren(parent, tagName) {
    if (!parent) return [];
    return [...parent.children].filter((child) => child.tagName.toUpperCase() === tagName);
  }

  function child(parent, tagName) {
    return directChildren(parent, tagName)[0] || null;
  }

  function attribute(node, name, fallback = "") {
    const value = node?.getAttribute(name);
    return value == null || value === "" ? fallback : value;
  }

  function tagRecords(parent) {
    return directChildren(parent, "TAG").map((tag) => ({
      pro: attribute(tag, "PRO"),
      value: attribute(tag, "VALUE"),
      text: tag.textContent?.trim() || "",
    }));
  }

  function parseAmr(xmlText) {
    const documentNode = new DOMParser().parseFromString(xmlText, "application/xml");
    const parserError = documentNode.querySelector("parsererror");
    if (parserError) {
      throw new Error(`The AMR file is not valid XML: ${parserError.textContent.trim()}`);
    }
    const root = documentNode.documentElement;
    if (!root || root.tagName.toUpperCase() !== "GAME") {
      throw new Error("This file does not use the Gut Feel AMR schema (expected a GAME root element). ");
    }
    const hostNode = child(root, "HOST");
    if (!hostNode) throw new Error("The AMR file has no HOST record.");

    const scenarios = directChildren(root, "SCENARIO").map((scenarioNode) => ({
      name: attribute(scenarioNode, "NAME", "Unnamed scenario"),
      sessions: directChildren(scenarioNode, "SESSION").map((sessionNode) => parseSession(sessionNode)),
    }));
    if (!scenarios.some((scenario) => scenario.sessions.length)) {
      throw new Error("The AMR file has no scenario sessions.");
    }
    return {
      host: {
        name: attribute(hostNode, "NAME", "—"),
        date: attribute(hostNode, "DATE", "—"),
        time: attribute(hostNode, "TIME", "—"),
        total: attribute(hostNode, "TOTAL", "—"),
      },
      scenarios,
    };
  }

  function parseSession(sessionNode) {
    const group = child(sessionNode, "GROUP");
    if (!group) throw new Error("A SESSION record has no GROUP record.");
    const foods = directChildren(child(sessionNode, "INFO"), "FOOD").map((food) => ({
      label: attribute(food, "TEXT", "Food choices"),
      count: attribute(food, "VALUE"),
      items: tagRecords(food).map((tag) => tag.text),
    }));
    return {
      group: attribute(group, "NAME", "Unnamed group"),
      score: attribute(group, "SCORE", "—"),
      players: tagRecords(group).map((tag) => tag.text),
      objective: tagRecords(child(sessionNode, "OBJECTIVE")),
      startingScore: attribute(child(sessionNode, "SCORES"), "STARTING", "—"),
      burgerBonus: attribute(child(sessionNode, "BURGER"), "BONUS", "—"),
      wastageScore: attribute(child(sessionNode, "WASTAGE_METER"), "SCORE", "—"),
      mouthSaliva: tagRecords(child(sessionNode, "MOUTHSALIVA")),
      mouthBiting: tagRecords(child(sessionNode, "MOUTHBITING")),
      oesophagus: tagRecords(child(sessionNode, "OESOPHAGUS")),
      stomachHcl: tagRecords(child(sessionNode, "STOMACHHCL")),
      stomachChurn: tagRecords(child(sessionNode, "STOMACHCHURN")),
      turret1: tagRecords(child(sessionNode, "SITURRET1")),
      turret2: tagRecords(child(sessionNode, "SITURRET2")),
      absorption: tagRecords(child(sessionNode, "SIABSORPTION")),
      crisis: tagRecords(child(sessionNode, "CRISIS")).map((tag) => tag.text),
      projection: tagRecords(child(sessionNode, "PROJECTION")),
      foods,
    };
  }

  function findEndOfCentralDirectory(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const minimum = Math.max(0, bytes.length - 65557);
    for (let offset = bytes.length - 22; offset >= minimum; offset--) {
      if (view.getUint32(offset, true) === 0x06054b50) return offset;
    }
    return -1;
  }

  async function extractAmrFromZip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const endOffset = findEndOfCentralDirectory(bytes);
    if (endOffset < 0) throw new Error("The ZIP file has no central directory.");
    const entryCount = view.getUint16(endOffset + 10, true);
    let offset = view.getUint32(endOffset + 16, true);
    const decoder = new TextDecoder();
    let match = null;

    for (let index = 0; index < entryCount; index++) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("The ZIP central directory is damaged.");
      const compression = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      if (!match && /(^|\/)\w[^/]*\.amr$/i.test(name)) {
        match = { compression, compressedSize, localOffset, name };
      }
      offset += 46 + nameLength + extraLength + commentLength;
    }
    if (!match) throw new Error("The ZIP file does not contain an AMR report.");
    if (view.getUint32(match.localOffset, true) !== 0x04034b50) throw new Error("The AMR ZIP entry is damaged.");
    const localNameLength = view.getUint16(match.localOffset + 26, true);
    const localExtraLength = view.getUint16(match.localOffset + 28, true);
    const dataOffset = match.localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataOffset, dataOffset + match.compressedSize);
    if (match.compression === 0) return { text: decoder.decode(compressed), name: match.name };
    if (match.compression !== 8) throw new Error(`Unsupported ZIP compression method ${match.compression}.`);
    if (!("DecompressionStream" in window)) throw new Error("This browser cannot decompress the Host report ZIP. Open the AMR file directly.");
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return { text: await new Response(stream).text(), name: match.name };
  }

  async function readReportFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isZip = file.name.toLowerCase().endsWith(".zip") ||
      (bytes[0] === 0x50 && bytes[1] === 0x4b);
    if (isZip) {
      const extracted = await extractAmrFromZip(bytes);
      return { text: extracted.text, sourceName: `${file.name} › ${extracted.name}` };
    }
    return { text: new TextDecoder().decode(bytes), sourceName: file.name };
  }

  async function loadFile(file) {
    clearError();
    try {
      const source = await readReportFile(file);
      showReport(parseAmr(source.text), source.sourceName);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
  }

  function clearError() {
    errorMessage.hidden = true;
    errorMessage.textContent = "";
  }

  function setText(selector, value) {
    $(selector).textContent = value == null || value === "" ? "—" : value;
  }

  function showReport(report, sourceName) {
    state.report = report;
    state.sourceName = sourceName;
    state.sessions = report.scenarios.flatMap((scenario, scenarioIndex) =>
      scenario.sessions.map((session, sessionIndex) => ({ scenario, session, scenarioIndex, sessionIndex }))
    );
    state.selected = 0;
    setText("#host-name", report.host.name);
    setText("#host-total", report.host.total);
    setText("#host-time", report.host.time);
    setText("#host-date", report.host.date);
    setText("#source-name", sourceName);
    buildSessionList();
    buildPrintReport();
    renderSelectedSession();
    dropZone.hidden = true;
    reportView.hidden = false;
    printButton.disabled = false;
  }

  function buildSessionList() {
    const navigation = $("#session-list");
    navigation.replaceChildren();
    let flatIndex = 0;
    for (const scenario of state.report.scenarios) {
      const group = document.createElement("section");
      group.className = "scenario-group";
      const label = document.createElement("h3");
      label.className = "scenario-label";
      label.textContent = scenario.name;
      group.append(label);
      for (const session of scenario.sessions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "session-link";
        button.textContent = session.group;
        button.dataset.index = String(flatIndex);
        button.addEventListener("click", () => {
          state.selected = Number(button.dataset.index);
          renderSelectedSession();
        });
        group.append(button);
        flatIndex++;
      }
      navigation.append(group);
    }
  }

  function buildPrintReport() {
    const container = $("#print-report-pages");
    container.replaceChildren();
    for (const selection of state.sessions) {
      const { scenario, session } = selection;
      const page = document.createElement("article");
      page.className = "print-page";

      const header = document.createElement("header");
      header.className = "print-page-header";
      const identity = document.createElement("div");
      const title = document.createElement("h1");
      title.textContent = session.group;
      const context = document.createElement("p");
      context.textContent = `Scenario: ${scenario.name} · Players: ${session.players.join(", ") || "None recorded"}`;
      identity.append(title, context);
      const brand = document.createElement("div");
      brand.className = "print-brand";
      brand.textContent = "GutFeel Reporter";
      header.append(identity, brand);
      page.append(header);

      const scores = document.createElement("section");
      scores.className = "print-score-grid";
      [["Final score", session.score], ["Burger bonus", session.burgerBonus],
       ["Starting score", session.startingScore], ["Wastage meter", session.wastageScore]]
        .forEach(([label, value]) => {
          const block = document.createElement("div");
          const caption = document.createElement("span");
          caption.textContent = label;
          const strong = document.createElement("strong");
          strong.textContent = value;
          block.append(caption, strong);
          scores.append(block);
        });
      page.append(scores);

      const nutrients = document.createElement("section");
      nutrients.className = "print-section";
      const nutrientHeading = document.createElement("h2");
      nutrientHeading.textContent = "Absorbed / Eaten / Recommended (blocks)";
      const table = document.createElement("table");
      table.className = "print-table";
      const tableHead = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["Nutrient", "Absorbed", "Eaten", "Recommended"].forEach((label) => {
        const cell = document.createElement("th");
        cell.textContent = label;
        headRow.append(cell);
      });
      tableHead.append(headRow);
      const tableBody = document.createElement("tbody");
      [["Carbohydrates", 0, 3, 6], ["Protein", 1, 4, 7], ["Fats", 2, 5, 8]]
        .forEach(([label, absorbed, eaten, recommended]) => {
          const row = document.createElement("tr");
          [label, objectiveValue(session, absorbed), objectiveValue(session, eaten), objectiveValue(session, recommended)]
            .forEach((value) => {
              const cell = document.createElement("td");
              cell.textContent = value;
              row.append(cell);
            });
          tableBody.append(row);
        });
      table.append(tableHead, tableBody);
      nutrients.append(nutrientHeading, table);
      page.append(nutrients);

      const roomSection = document.createElement("section");
      roomSection.className = "print-section";
      const roomHeading = document.createElement("h2");
      roomHeading.textContent = "Control-room results";
      const roomGrid = document.createElement("div");
      roomGrid.className = "print-room-grid";
      [
        ["Mouth · Saliva", session.mouthSaliva], ["Mouth · Biting", session.mouthBiting],
        ["Oesophagus", session.oesophagus], ["Stomach · Churning", session.stomachChurn],
        ["Stomach · HCL", session.stomachHcl], ["Small Intestine · Turret 1", session.turret1],
        ["Small Intestine · Turret 2", session.turret2], ["Small Intestine · Absorption", session.absorption],
      ].forEach(([label, records]) => roomGrid.append(printRoom(label, records)));
      roomSection.append(roomHeading, roomGrid);
      page.append(roomSection);

      const details = document.createElement("section");
      details.className = "print-section print-details";
      const detailsHeading = document.createElement("h2");
      detailsHeading.textContent = "Projection and crises";
      const detailTable = document.createElement("table");
      detailTable.className = "print-table";
      const detailBody = document.createElement("tbody");
      [["Recommended daily intake", session.projection[0]?.value || "—"],
       ["Total calorie intake", session.projection[1]?.value || "—"]]
        .forEach(([label, value]) => {
          const row = document.createElement("tr");
          const heading = document.createElement("th");
          heading.textContent = label;
          const cell = document.createElement("td");
          cell.textContent = value;
          row.append(heading, cell);
          detailBody.append(row);
        });
      detailTable.append(detailBody);
      const appendLog = (label, items, fallback) => {
        const log = document.createElement("section");
        log.className = "print-log";
        const heading = document.createElement("h3");
        heading.textContent = label;
        const content = document.createElement("p");
        content.textContent = items.join("; ") || fallback;
        log.append(heading, content);
        details.append(log);
      };
      details.append(detailsHeading, detailTable);
      appendLog("Crises faced", session.crisis, "None recorded");
      appendLog("Food choices", session.foods.flatMap((food) => food.items), "None recorded");
      page.append(details);

      const provenance = document.createElement("p");
      provenance.className = "print-section";
      provenance.textContent = `Host: ${state.report.host.name} · Total students: ${state.report.host.total} · Created: ${state.report.host.date} ${state.report.host.time} · Unofficial browser viewer · Original report format © 2009 Amdon Consulting Pte Ltd.`;
      page.append(provenance);
      container.append(page);
    }
  }

  function printRoom(label, records) {
    const room = document.createElement("section");
    room.className = "print-room";
    const heading = document.createElement("h3");
    heading.textContent = label;
    const metrics = document.createElement("dl");
    const entries = records.length ? records : [{ pro: "Result", value: "Not recorded" }];
    for (const record of entries) {
      const term = document.createElement("dt");
      term.textContent = record.pro || "Result";
      const value = document.createElement("dd");
      value.textContent = record.value || "—";
      metrics.append(term, value);
    }
    room.append(heading, metrics);
    return room;
  }

  function renderSelectedSession() {
    const selection = state.sessions[state.selected];
    if (!selection) return;
    $$(".session-link").forEach((button) => {
      button.setAttribute("aria-current", String(Number(button.dataset.index) === state.selected));
    });
    const { scenario, session } = selection;
    setText("#scenario-name", scenario.name);
    setText("#group-name", session.group);
    setText("#players", session.players.length ? `Players: ${session.players.join(" · ")}` : "Players: none recorded");
    setText("#final-score", session.score);
    setText("#burger-bonus", session.burgerBonus);
    setText("#starting-score", session.startingScore);
    setText("#wastage-score", session.wastageScore);
    renderNutrients(session);
    renderFoods(session);
    renderRooms(session);
    renderProjection(session);
    renderCrises(session);
  }

  function numericValue(value) {
    const number = Number(String(value).trim());
    return Number.isFinite(number) ? number : null;
  }

  function objectiveValue(session, index) {
    return session.objective[index]?.value || "—";
  }

  function renderNutrients(session) {
    const chart = $("#nutrient-chart");
    chart.replaceChildren();
    const nutrients = [
      { key: "carbohydrates", name: "Carbohydrates", values: [0, 3, 6] },
      { key: "protein", name: "Protein", values: [1, 4, 7] },
      { key: "fats", name: "Fats", values: [2, 5, 8] },
    ];
    for (const nutrient of nutrients) {
      const values = nutrient.values.map((index) => objectiveValue(session, index));
      const numbers = values.map(numericValue).filter((value) => value != null);
      const maximum = Math.max(1, ...numbers);
      const row = document.createElement("div");
      row.className = "nutrient-row";
      row.dataset.nutrient = nutrient.key;
      const name = document.createElement("div");
      name.className = "nutrient-name";
      name.textContent = nutrient.name;
      row.append(name);
      ["Absorbed", "Eaten", "Recommended"].forEach((label, index) => {
        const cell = document.createElement("div");
        cell.className = "nutrient-value";
        const numeric = numericValue(values[index]);
        cell.style.setProperty("--ratio", numeric == null ? "0" : String(Math.max(0, numeric) / maximum));
        const small = document.createElement("small");
        small.textContent = label;
        const strong = document.createElement("strong");
        strong.textContent = values[index];
        cell.append(small, strong);
        row.append(cell);
      });
      chart.append(row);
    }
  }

  function renderFoods(session) {
    const container = $("#food-choices");
    container.replaceChildren();
    const overview = document.createElement("section");
    overview.className = "food-block food-block-hero";
    const overviewImage = document.createElement("img");
    overviewImage.src = "report-assets/brain.png";
    overviewImage.alt = "Brain Room food selection screen";
    const overviewHeading = document.createElement("h4");
    overviewHeading.textContent = "Game Info";
    overview.append(overviewImage, overviewHeading);
    container.append(overview);
    const foods = session.foods.length ? session.foods : [{ label: "Food choices", items: [] }];
    for (const food of foods) {
      const block = document.createElement("section");
      block.className = "food-block";
      const heading = document.createElement("h4");
      heading.textContent = food.label || "Food choices";
      const list = document.createElement("ul");
      const items = food.items.length ? food.items : ["None recorded"];
      for (const item of items) {
        const entry = document.createElement("li");
        entry.textContent = item;
        list.append(entry);
      }
      block.append(heading, list);
      container.append(block);
    }
  }

  function renderRooms(session) {
    const mechanical = [
      {
        title: "Mouth Room · Biting control",
        image: "report-assets/biting.png",
        description: "The softer the food, the more points gained. Chewing at the molar area and applying saliva reduces hardness faster.",
        records: session.mouthBiting,
      },
      {
        title: "Mouth Room · Oesophagus",
        image: "report-assets/oesophagus.png",
        description: "Five points are given for each perfect peristalsis.",
        records: session.oesophagus,
      },
      {
        title: "Stomach Room · Churning",
        image: "report-assets/churning.png",
        description: "Food chewed properly in the Mouth Room can be broken down more easily in the Stomach Room.",
        records: session.stomachChurn,
      },
    ];
    const chemical = [
      {
        title: "Mouth Room · Saliva control",
        image: "report-assets/saliva.png",
        description: "Red numbers represent carbohydrate molecules available for saliva enzymes to react with.",
        records: session.mouthSaliva,
      },
      {
        title: "Stomach Room · HCL control",
        image: "report-assets/hcl.png",
        description: "Sixteen points are given for every successful activation of protein enzymes after solving the puzzle.",
        records: session.stomachHcl,
      },
      {
        title: "Small Intestine · Turret 1",
        image: "report-assets/turret-1.png",
        description: "Break food molecules into simple forms using the correct pancreatic enzymes.",
        records: session.turret1,
      },
      {
        title: "Small Intestine · Turret 2",
        image: "report-assets/turret-2.png",
        description: "Break food molecules into simple forms using the correct intestinal enzymes.",
        records: session.turret2,
      },
      {
        title: "Small Intestine · Absorption",
        image: "report-assets/absorption.png",
        description: "Punch digested food molecules into the intestinal villi walls accordingly.",
        records: session.absorption,
      },
    ];
    fillRoomGrid($("#mechanical-rooms"), mechanical);
    fillRoomGrid($("#chemical-rooms"), chemical);
  }

  function fillRoomGrid(container, rooms) {
    container.replaceChildren();
    for (const room of rooms) {
      const card = document.createElement("section");
      card.className = "room-card";
      const image = document.createElement("img");
      image.src = room.image;
      image.alt = "";
      const copy = document.createElement("div");
      copy.className = "room-card-copy";
      const heading = document.createElement("h4");
      heading.textContent = room.title;
      const description = document.createElement("p");
      description.textContent = room.description;
      const metrics = document.createElement("dl");
      metrics.className = "metric-list";
      const records = room.records.length ? room.records : [{ pro: "Result", value: "Not recorded" }];
      for (const record of records) {
        const term = document.createElement("dt");
        term.textContent = record.pro || "Result";
        const value = document.createElement("dd");
        value.textContent = record.value || "—";
        metrics.append(term, value);
      }
      copy.append(heading, description, metrics);
      card.append(image, copy);
      container.append(card);
    }
  }

  function renderProjection(session) {
    const recommended = session.projection[0]?.value || "—";
    const projected = session.projection[1]?.value || "—";
    setText("#recommended-intake", recommended);
    setText("#calorie-intake", projected);
    const carbs = numericValue(objectiveValue(session, 0));
    const protein = numericValue(objectiveValue(session, 1));
    const fats = numericValue(objectiveValue(session, 2));
    const projectedNumber = numericValue(projected);
    const audit = $("#calorie-audit");
    audit.className = "formula-note";
    if ([carbs, protein, fats].every((value) => value != null)) {
      const computed = 12 * carbs + 27 * fats + 12 * protein;
      const matches = projectedNumber != null && Math.abs(computed - projectedNumber) < 0.000001;
      audit.textContent = `Host formula: 12 × absorbed carbohydrate blocks (${carbs}) + 27 × absorbed fat blocks (${fats}) + 12 × absorbed protein blocks (${protein}) = ${computed}. ` +
        (matches ? "This matches the AMR projection." : `The AMR projection records ${projected}.`);
      audit.classList.add(matches ? "is-match" : "is-mismatch");
    } else {
      audit.textContent = "The Host records projection values as NA for this scenario; no calorie calculation is performed.";
    }
  }

  function renderCrises(session) {
    const list = $("#crisis-list");
    list.replaceChildren();
    const crises = session.crisis.length ? session.crisis : ["No crises recorded"];
    for (const crisis of crises) {
      const item = document.createElement("li");
      item.textContent = crisis;
      if (!session.crisis.length) item.className = "empty";
      list.append(item);
    }
  }

  function showTab(name) {
    $$(".report-tabs button").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.tab === name));
    });
    $$(".tab-panel").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== name;
    });
  }

  $$(".report-tabs button").forEach((button) => {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files?.[0]) loadFile(fileInput.files[0]);
    fileInput.value = "";
  });
  printButton.addEventListener("click", () => window.print());
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });
  ["dragenter", "dragover"].forEach((type) => dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  }));
  ["dragleave", "drop"].forEach((type) => dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  }));
  dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });

  const sourceParams = new URLSearchParams(location.search);
  const sourceUrl = sourceParams.get("src");
  if (sourceUrl) {
    let trustedSource;
    try {
      trustedSource = new URL(sourceUrl, location.href);
      // Host export links use an in-memory Blob URL created by the same page
      // origin. Existing fixtures also use same-origin HTTP(S) and relative
      // URLs. Preserve those while refusing cross-origin or other protocols;
      // `?src=` must not become a general fetch proxy.
      const allowedProtocol = trustedSource.protocol === "blob:" ||
        trustedSource.protocol === "http:" || trustedSource.protocol === "https:";
      if (!allowedProtocol || trustedSource.origin !== location.origin) {
        throw new Error("The report link is not from this site.");
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
      return;
    }
    const sourceName = (sourceParams.get("name") || "Report.zip")
      .split(/[\\/]/).pop() || "Report.zip";
    fetch(trustedSource.href)
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load report (${response.status}).`);
        return response.blob();
      })
      .then((blob) => loadFile(new File([blob], sourceName, { type: blob.type })))
      .catch((error) => showError(error.message));
  }
})();
