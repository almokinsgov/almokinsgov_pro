import { featureStyles, formats, nzLocations, templates } from "./data.js";
import { routeRoadNamesForProject } from "./reference-layers.js";
import { escapeHtml } from "./utils.js";

const optionList = (items, selected) =>
  [
    `<option value="" ${selected ? "" : "selected"}>Select…</option>`,
    ...items.map(
      (item) =>
        `<option value="${item}" ${item === selected ? "selected" : ""}>${item}</option>`
    )
  ].join("");

export const renderAppShell = (project) => `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-lockup" aria-label="Road Closure Studio">
        <div class="brand-mark" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <div>
          <strong>Road Closure Studio</strong>
          <small>Plan · map · publish</small>
        </div>
        <span class="version-pill">V5</span>
      </div>

      <div class="topbar-centre">
        <span class="autosave-dot" aria-hidden="true"></span>
        <span id="saveState">Draft saved locally</span>
        <span class="save-divider" aria-hidden="true">·</span>
        <span id="cloudSaveState">Drive not connected</span>
      </div>

      <div class="topbar-actions">
        <button class="button button-cloud" id="cloudAccountBtn" type="button" aria-haspopup="dialog">
          <span class="cloud-account-avatar" id="cloudAccountAvatar" aria-hidden="true">G</span>
          <span id="cloudAccountLabel">Sign in with Google</span>
        </button>
        <button class="button button-quiet" id="newProjectBtn" type="button">
          <span aria-hidden="true">＋</span> New closure
        </button>
        <button class="button button-primary" id="saveProjectBtn" type="button">
          Save record
        </button>
      </div>
    </header>

    <div class="workspace">
      <aside class="rail" aria-label="Primary navigation">
        <button class="rail-logo" type="button" data-view="editor" aria-label="Open editor">
          <span>RC</span>
        </button>
        <nav class="rail-nav">
          <button class="rail-item active" type="button" data-view="editor">
            <span class="rail-icon" aria-hidden="true">✦</span>
            <span>Create</span>
          </button>
          <button class="rail-item" type="button" data-view="records">
            <span class="rail-icon" aria-hidden="true">▤</span>
            <span>Closures</span>
            <b id="recordCount" class="rail-count">0</b>
          </button>
        </nav>
        <div class="rail-spacer"></div>
        <button class="rail-item" type="button" id="helpBtn">
          <span class="rail-icon" aria-hidden="true">?</span>
          <span>Guide</span>
        </button>
      </aside>

      <main class="main">
        <section class="editor-view view-panel active" id="editorView">
          <aside class="step-sidebar">
            <div class="eyebrow">Graphic workflow</div>
            <h1>Create a road update</h1>
            <p>Build a clear, map-led public information graphic in four steps.</p>

            <ol class="step-list">
              ${[
                ["1", "What", "Closure type & message"],
                ["2", "Where", "Location & map"],
                ["3", "When", "Timing & public details"],
                ["4", "Publish", "Review & export"]
              ]
                .map(
                  ([number, title, detail], index) => `
                    <li>
                      <button class="step-link ${index === 0 ? "active" : ""}" data-step="${index}" type="button">
                        <span class="step-number">${number}</span>
                        <span><strong>${title}</strong><small>${detail}</small></span>
                        <span class="step-tick" aria-hidden="true">✓</span>
                      </button>
                    </li>`
                )
                .join("")}
            </ol>

            <div class="workflow-tip">
              <span class="tip-icon" aria-hidden="true">i</span>
              <div>
                <strong>Local-first with optional Drive sync</strong>
                <p>Your work is always saved in this browser. Google Drive sync can add a persistent profile, preferences, history and saved closures.</p>
              </div>
            </div>
          </aside>

          <section class="step-content">
            ${renderStepWhat(project)}
            ${renderStepWhere(project)}
            ${renderStepWhen(project)}
            ${renderStepPublish(project)}
            <footer class="step-footer">
              <button class="button button-quiet" id="backBtn" type="button" disabled>
                ← Back
              </button>
              <span id="stepCounter">Step 1 of 4</span>
              <button class="button button-primary button-next" id="nextBtn" type="button">
                Map the location <span aria-hidden="true">→</span>
              </button>
            </footer>
          </section>
        </section>

        <section class="records-view view-panel" id="recordsView">
          ${renderRecordsShell()}
        </section>
      </main>
    </div>
  </div>

  <div class="toast-region" id="toastRegion" aria-live="polite"></div>
  <input id="geojsonInput" type="file" accept=".geojson,.json,application/geo+json,application/json" hidden />
  <input id="closuresInput" type="file" accept=".json,application/json" hidden />
  <dialog id="helpDialog" class="help-dialog">
    <button class="dialog-close" type="button" data-close-dialog aria-label="Close">×</button>
    <span class="dialog-kicker">Quick guide</span>
    <h2>From disruption to graphic</h2>
    <div class="guide-grid">
      <div><b>1</b><span><strong>Choose what</strong>Set the event, severity and public headline.</span></div>
      <div><b>2</b><span><strong>Map where</strong>Centre the map, then draw closures and detours.</span></div>
      <div><b>3</b><span><strong>Add when</strong>Enter dates, hours, recurrence and advice.</span></div>
      <div><b>4</b><span><strong>Publish</strong>Review the live composition and export a PNG.</span></div>
    </div>
    <p class="dialog-note">This prototype uses original generic branding and is not an official NZ Transport Agency product.</p>
  </dialog>

  <dialog id="cloudDialog" class="cloud-dialog">
    <button class="dialog-close" type="button" data-close-cloud-dialog aria-label="Close">×</button>
    <div class="cloud-dialog-header">
      <div>
        <span class="dialog-kicker">Optional cloud profile</span>
        <h2>Google Drive Sync</h2>
        <p>Keep the local-first editor and add a persistent user experience across browsers and devices.</p>
      </div>
      <span class="cloud-status-pill" id="cloudStatusPill">Not connected</span>
    </div>

    <div class="cloud-dialog-grid">
      <section class="cloud-card cloud-account-card">
        <div class="cloud-profile" id="cloudProfile">
          <span class="cloud-profile-avatar" id="cloudProfileAvatar">G</span>
          <div>
            <strong id="cloudProfileName">No Google account connected</strong>
            <span id="cloudProfileEmail">Configure a Google OAuth web client ID to begin.</span>
          </div>
        </div>
        <div class="cloud-folder-line">
          <span>Drive folder</span>
          <a id="cloudFolderLink" href="#" target="_blank" rel="noreferrer" hidden>Open Road Closure Studio</a>
          <strong id="cloudFolderState">Not created</strong>
        </div>
        <p class="cloud-security-note">Access tokens stay in memory only. The app requests access only to files and folders it creates.</p>
      </section>

      <section class="cloud-card cloud-setup-card">
        <div class="cloud-card-heading">
          <div>
            <h3>Google Setup</h3>
            <p>The OAuth client ID is public configuration, not a client secret.</p>
          </div>
        </div>
        <label class="field field-wide">
          <span>Google OAuth web client ID</span>
          <input id="googleClientIdInput" autocomplete="off" placeholder="1234567890-example.apps.googleusercontent.com" />
        </label>
        <label class="field field-wide">
          <span>Drive folder name</span>
          <input id="googleDriveFolderInput" maxlength="80" value="Road Closure Studio" />
        </label>
        <div class="cloud-origin-box">
          <span>Authorised JavaScript origin for this copy</span>
          <code id="cloudOriginValue"></code>
        </div>
        <div class="cloud-button-row">
          <button class="button button-quiet" id="saveCloudSetupBtn" type="button">Save setup</button>
          <button class="button button-google" id="googleSignInBtn" type="button">Sign in with Google</button>
        </div>
      </section>

      <section class="cloud-card cloud-preferences-card">
        <div class="cloud-card-heading">
          <div>
            <h3>Profile And Preferences</h3>
            <p>These settings are stored locally and included in Drive sync.</p>
          </div>
        </div>
        <div class="form-grid two cloud-preference-grid">
          <label class="field">
            <span>Display name</span>
            <input id="cloudDisplayNameInput" maxlength="80" placeholder="Use Google account name" />
          </label>
          <label class="field">
            <span>Open on</span>
            <select id="cloudStartViewSelect">
              <option value="editor">Create</option>
              <option value="records">Closures</option>
            </select>
          </label>
          <label class="field">
            <span>Default graphic format</span>
            <select id="cloudDefaultFormatSelect">
              ${Object.entries(formats).map(([key, format]) => `<option value="${key}">${format.label}</option>`).join("")}
            </select>
          </label>
          <label class="switch-row cloud-switch-row">
            <input id="cloudRememberStepToggle" type="checkbox" checked />
            <span>Remember the last workflow step</span>
          </label>
        </div>
        <button class="button button-quiet" id="saveCurrentDefaultsBtn" type="button">Use current map and graphic settings as my defaults</button>
      </section>

      <section class="cloud-card cloud-sync-card">
        <div class="cloud-card-heading">
          <div>
            <h3>Sync Controls</h3>
            <p id="cloudSyncSummary">Connect Google Drive to create the persistent workspace.</p>
          </div>
        </div>
        <label class="switch-row cloud-switch-row">
          <input id="cloudAutoSyncToggle" type="checkbox" checked />
          <span>Automatically sync after local changes</span>
        </label>
        <label class="switch-row cloud-switch-row">
          <input id="cloudRestoreToggle" type="checkbox" />
          <span>Load a newer Drive workspace after sign-in</span>
        </label>
        <div class="cloud-button-row cloud-sync-actions">
          <button class="button button-primary" id="cloudSyncNowBtn" type="button" disabled>Upload local now</button>
          <button class="button button-quiet" id="cloudLoadBtn" type="button" disabled>Load from Drive</button>
          <button class="button button-quiet" id="cloudMergeBtn" type="button" disabled>Merge local and Drive</button>
        </div>
        <div class="cloud-conflict" id="cloudConflictPanel" hidden>
          <strong>A newer Drive workspace is available.</strong>
          <p>Choose whether to load it, merge by record ID and modification time, or upload this browser copy.</p>
        </div>
        <button class="button button-danger-quiet" id="googleDisconnectBtn" type="button" disabled>Disconnect Google</button>
      </section>

      <section class="cloud-card cloud-history-card">
        <div class="cloud-card-heading">
          <div>
            <h3>Recent History</h3>
            <p>Major save, import, record and cloud actions are retained.</p>
          </div>
        </div>
        <ol class="cloud-history-list" id="cloudHistoryList"></ol>
      </section>
    </div>

    <footer class="cloud-dialog-footer">
      <span id="cloudDialogStatus">Local mode is ready.</span>
      <button class="button button-quiet" type="button" data-close-cloud-dialog>Close</button>
    </footer>
  </dialog>
`;

const renderStepWhat = (project) => `
  <article class="step-panel active" data-step-panel="0">
    <header class="section-heading">
      <div>
        <span class="eyebrow">Step 1 · What</span>
        <h2>What is happening?</h2>
        <p>Choose a starting point, then make the public message specific.</p>
      </div>
      <span class="completion-badge"><i></i> Live preview</span>
    </header>

    <div class="template-grid" role="radiogroup" aria-label="Closure template">
      ${Object.entries(templates)
        .map(
          ([key, item]) => `
            <button class="template-card ${project.template === key ? "selected" : ""}" data-template="${key}" role="radio" aria-checked="${project.template === key}" type="button">
              <span class="template-symbol template-${key}" aria-hidden="true">
                ${key === "full" ? "⊘" : key === "lane" ? "⇆" : key === "detour" ? "↗" : "●"}
              </span>
              <span><strong>${item.label}</strong><small>${key === "full" ? "No through access" : key === "lane" ? "Part road affected" : key === "detour" ? "Alternative route" : "Pinpoint activity"}</small></span>
              <i aria-hidden="true">✓</i>
            </button>`
        )
        .join("")}
    </div>

    <div class="form-card">
      <div class="form-card-heading">
        <h3>Public message</h3>
        <span>Appears on the graphic</span>
      </div>
      <div class="form-grid two">
        <label class="field field-wide">
          <span>Headline <em>Required</em></span>
          <input data-field="headline" value="${project.headline}" maxlength="58" />
          <small><span data-count-for="headline">${project.headline.length}</span>/58 characters</small>
        </label>
        <label class="field field-wide">
          <span>Supporting line</span>
          <input data-field="subheadline" value="${project.subheadline}" maxlength="72" />
          <small><span data-count-for="subheadline">${project.subheadline.length}</span>/72 characters</small>
        </label>
        <label class="field">
          <span>Interruption type</span>
          <select data-field="eventType">
            ${optionList(
              ["Full road closure", "Lane closure", "Detour in place", "Roadworks", "Crash or incident", "Weather disruption"],
              project.eventType
            )}
          </select>
        </label>
        <label class="field">
          <span>Impact level</span>
          <select data-field="severity">
            ${optionList(["Closed", "Major delays", "Minor delays", "Caution"], project.severity)}
          </select>
        </label>
        <label class="field">
          <span>Direction</span>
          <select data-field="direction">
            ${optionList(["Both directions", "Northbound", "Southbound", "Eastbound", "Westbound"], project.direction)}
          </select>
        </label>
        <label class="field">
          <span>Who is affected?</span>
          <select data-field="audience">
            ${optionList(["All traffic", "Heavy vehicles", "Light vehicles", "Cyclists and pedestrians", "Local residents"], project.audience)}
          </select>
        </label>
      </div>
    </div>
  </article>
`;

const renderReferenceZoomOptions = (selected) =>
  Array.from({ length: 14 }, (_, index) => index + 6)
    .map(
      (zoom) =>
        `<option value="${zoom}" ${Number(selected) === zoom ? "selected" : ""}>Zoom ${zoom}+</option>`
    )
    .join("");

const renderReferenceLayerControls = (project, surface) => {
  const layers = project.referenceLayers || {};
  const routeRoadNames = routeRoadNamesForProject(project);
  const rows = [
    {
      key: "roads",
      title: "Road geometry",
      detail: "Bundled road lines and polygons",
      visible: layers.roads?.visible !== false
    },
    {
      key: "roadNames",
      title: "Road names",
      detail: "Labels visible road geometry",
      visible: layers.roadNames?.visible === true,
      minZoom: Number(layers.roadNames?.minZoom) || 14
    },
    {
      key: "addresses",
      title: "Addresses",
      detail: "Address points and labels",
      visible: layers.addresses?.visible === true,
      minZoom: Number(layers.addresses?.minZoom) || 17
    },
    {
      key: "areas",
      title: "Areas",
      detail: "Actual locality polygons and names",
      visible: layers.areas?.visible === true,
      minZoom: Number(layers.areas?.minZoom) || 11
    }
  ];
  return `
    <section class="reference-layer-controls" data-reference-surface="${surface}" aria-label="Far North reference map layers">
      <div class="reference-layer-heading">
        <div>
          <span class="control-label">Reference map layers</span>
          <p>${surface === "publication" ? "Choose which bundled GIS layers appear. Drag visible road, address and area labels directly on the graphic; they remain above route lines." : "Choose which bundled GIS layers appear. Zoom thresholds prevent dense labels from overwhelming the map."}</p>
        </div>
        <span class="reference-layer-scope">Far North GIS</span>
      </div>
      <div class="reference-layer-list">
        ${rows
          .map(
            (row) => `
              <div class="reference-layer-row" data-reference-layer-row="${row.key}">
                <label>
                  <input type="checkbox" data-reference-layer-toggle="${row.key}" ${row.visible ? "checked" : ""} />
                  <span><strong>${row.title}</strong><small>${row.detail}</small></span>
                </label>
                ${
                  row.minZoom
                    ? `<select data-reference-layer-zoom="${row.key}" aria-label="${row.title} minimum zoom">${renderReferenceZoomOptions(row.minZoom)}</select>`
                    : `<small class="reference-all-zooms">All zooms</small>`
                }
                ${
                  surface === "publication" && row.key === "roadNames"
                    ? `<label class="reference-route-road-filter">
                        <input type="checkbox" data-reference-detour-roads-only ${layers.roadNames?.detourRoadsOnly === true ? "checked" : ""} ${routeRoadNames.length ? "" : "disabled"} />
                        <span>
                          <strong>Detour/access roads only</strong>
                          <small data-reference-detour-roads-status>${routeRoadNames.length ? `Show labels only for ${routeRoadNames.length} ${routeRoadNames.length === 1 ? "road" : "roads"} used by mapped routes.` : "Add a calculated or imported detour/access route with road-name data first."}</small>
                        </span>
                      </label>`
                    : ""
                }
                <details class="reference-choice-panel">
                  <summary>Filter or select items <span data-reference-selected-count="${row.key}">${(layers[row.key]?.selectedIds || []).length ? `${layers[row.key].selectedIds.length} selected` : ""}</span></summary>
                  <div class="reference-choice-tools">
                    <input type="search" value="${escapeHtml(layers[row.key]?.filterText || "")}" data-reference-layer-filter="${row.key}" placeholder="Filter ${row.title.toLowerCase()}" aria-label="Filter ${row.title}" />
                    <button class="button button-quiet" data-clear-reference-selection="${row.key}" type="button" ${(layers[row.key]?.selectedIds || []).length ? "" : "disabled"}>Clear selected</button>
                  </div>
                  <div class="reference-choice-list" data-reference-layer-choices="${row.key}">
                    <small>Move the map to load choices in this view.</small>
                  </div>
                </details>
              </div>`
          )
          .join("")}
      </div>
      ${
        surface === "publication"
          ? `<div class="reference-label-move-tools">
              <span data-reference-label-move-status>Drag a visible reference label to reposition it for this graphic.</span>
              <button class="button button-quiet" id="resetReferenceLabelPositionsBtn" type="button" ${Object.keys(project.referenceLabelPositions || {}).length ? "" : "disabled"}>Reset moved labels</button>
            </div>`
          : ""
      }
      <small class="reference-layer-live-status" data-reference-layer-status>Layers update as the map zoom changes.</small>
    </section>`;
};

const renderGraphicKeyEditor = (project) => {
  const keyItems = project.graphicKeyItems || {};
  return Object.entries(featureStyles)
    .map(([type, style]) => {
      const item = keyItems[type] || style;
      return `
        <div class="key-editor-row" data-key-editor-type="${type}">
          <label class="key-editor-visible">
            <input type="checkbox" data-key-item-visible="${type}" ${item.visible !== false ? "checked" : ""} />
            <span>${escapeHtml(style.label)}</span>
          </label>
          <input type="text" value="${escapeHtml(item.label || style.label)}" data-key-item-label="${type}" aria-label="${escapeHtml(style.label)} key text" />
          <input type="color" value="${escapeHtml(item.color || style.color)}" data-key-item-colour="${type}" aria-label="${escapeHtml(style.label)} key colour" />
        </div>`;
    })
    .join("");
};

const renderStepWhere = (project) => `
  <article class="step-panel" data-step-panel="1">
    <header class="section-heading">
      <div>
        <span class="eyebrow">Step 2 · Where</span>
        <h2>Map the affected road</h2>
        <p>Set the place, then draw the closure, detour and access routes.</p>
      </div>
      <div class="map-legend-inline">
        <span><i class="legend-dot closure"></i> Closure</span>
        <span><i class="legend-dot detour"></i> Detour</span>
        <span><i class="legend-dot access"></i> Access</span>
      </div>
    </header>

    <div class="location-strip">
      <label class="field location-search">
        <span>Quick place list</span>
        <div class="input-with-action">
          <select id="locationPreset">
            <optgroup label="National examples">
              ${nzLocations.map((location) => `<option value="${location.name}" ${location.name === project.area ? "selected" : ""}>${location.name}</option>`).join("")}
            </optgroup>
            <optgroup label="Far North GIS locations" id="farNorthLocationOptions">
              <option value="" disabled>Loading Far North placenames…</option>
            </optgroup>
          </select>
          <button class="button button-soft" id="goLocationBtn" type="button">Go</button>
        </div>
        <small class="location-data-status" id="locationDataStatus">Loading Far North placenames…</small>
      </label>
      <label class="field">
        <span>Road</span>
        <input data-field="road" value="${project.road}" placeholder="e.g. SH1" />
      </label>
      <label class="field">
        <span>Route shield</span>
        <input data-field="routeNumber" value="${project.routeNumber}" maxlength="4" />
      </label>
    </div>

    <section class="explore-card" aria-labelledby="exploreHeading">
      <div class="explore-heading">
        <div>
          <span class="eyebrow">Far North GIS explorer</span>
          <h3 id="exploreHeading">Search roads, addresses and areas</h3>
          <p>Search exact roads, addresses and area polygons, then use a result as a location, route endpoint, mapped feature or note.</p>
        </div>
        <span class="gis-ready-badge"><i></i> Local GIS</span>
      </div>
      <div class="explore-search-row">
        <label class="field explore-search-field">
          <span>Explore search</span>
          <input id="exploreSearchInput" type="search" autocomplete="off" placeholder="Try Redan Road, 48B Redan Road, or Kaitaia" />
        </label>
        <button class="button button-dark" id="runExploreSearchBtn" type="button">Search</button>
      </div>
      <div class="explore-filter-row">
        <div class="explore-tabs" role="group" aria-label="Explore result type">
          ${[
            ["all", "All"],
            ["road", "Roads"],
            ["address", "Addresses"],
            ["area", "Areas"]
          ]
            .map(
              ([key, label], index) =>
                `<button class="${index === 0 ? "active" : ""}" data-explore-type="${key}" type="button">${label}</button>`
            )
            .join("")}
        </div>
        <span id="exploreDataStatus" class="explore-data-status">Loading road, address and area indexes…</span>
      </div>
      <div class="explore-results" id="exploreResults" aria-live="polite">
        <div class="explore-empty">
          <span aria-hidden="true">⌕</span>
          <p>Search the Far North reference data to choose an exact location.</p>
        </div>
      </div>
    </section>

    ${renderReferenceLayerControls(project, "editor")}

    <div class="map-card">
      <div class="map-toolbar" aria-label="Map drawing tools">
        <div class="tool-group">
          <span>Draw</span>
          <button class="map-tool active" data-map-tool="pan" type="button"><i>✥</i> Pan</button>
          <button class="map-tool" data-map-tool="closure" type="button"><i class="tool-line closure"></i> Closure</button>
          <button class="map-tool" data-map-tool="detour" type="button"><i class="tool-line detour"></i> Detour</button>
          <button class="map-tool" data-map-tool="access" type="button"><i class="tool-line access"></i> Access</button>
          <button class="map-tool" data-map-tool="works" type="button"><i class="tool-point works"></i> Works</button>
          <button class="map-tool" data-map-tool="note" type="button"><i class="tool-point note"></i> Note</button>
          <button class="map-tool" data-map-tool="edit" type="button"><i>✥</i> Edit routes</button>
        </div>
        <div class="tool-group map-actions">
          <label class="stick-road-toggle" title="Magnetically snap the moved route section to the nearest bundled roads">
            <input id="stickToRoadInput" type="checkbox" ${project.editing?.stickToRoad !== false ? "checked" : ""} />
            <span>Stick to road</span>
          </label>
          <button class="button button-soft" id="undoPointBtn" type="button" disabled>Undo point</button>
          <button class="button button-dark" id="finishDrawingBtn" type="button" disabled>Finish route</button>
        </div>
      </div>
      <div class="map-wrap">
        <div id="editorMap" aria-label="Interactive map editor"></div>
        <div class="map-status" id="mapStatus">
          <span class="status-crosshair">⌖</span>
          <span><strong>Pan mode</strong><small>Select a draw tool to add an overlay.</small></span>
        </div>
        <div class="feature-edit-bar" id="featureEditBar" hidden>
          <span aria-hidden="true">✥</span>
          <div><strong id="selectedFeatureLabel">Route selected</strong><small id="selectedFeatureHelp">Drag onto another road to recalculate through it, or use the road-stop controls below.</small></div>
          <button class="button button-soft" id="finishEditingBtn" type="button">Done</button>
        </div>
        <div class="north-arrow" aria-label="North">N</div>
      </div>
      <div class="feature-strip">
        <div>
          <strong id="featureCount">${project.features.length} mapped ${project.features.length === 1 ? "item" : "items"}</strong>
          <span>These overlays appear in the export composition.</span>
        </div>
        <div class="feature-strip-actions">
          <button class="button button-quiet" id="importGeoJsonBtn" type="button">Import GeoJSON</button>
          <button class="button button-quiet" id="exportGeoJsonBtn" type="button">Export GeoJSON</button>
          <button class="button button-danger-text" id="clearMapBtn" type="button">Clear map</button>
        </div>
      </div>
      <section class="mapped-feature-editor" aria-labelledby="mappedFeatureHeading">
        <div class="mapped-feature-editor-heading">
          <div>
            <strong id="mappedFeatureHeading">Mapped item details</strong>
            <span>Edit names, select route shapes directly, move point items, or remove an item.</span>
          </div>
        </div>
        <div class="mapped-feature-list" id="mappedFeatureList"></div>
        <datalist id="farNorthRoadNames"></datalist>
      </section>
    </div>

    <section class="route-planner-card" aria-labelledby="routePlannerHeading">
      <div class="route-planner-heading">
        <div>
          <span class="eyebrow">Network route detection</span>
          <h3 id="routePlannerHeading">Check a closure-aware route</h3>
          <p>Endpoints snap to the bundled road geometry. Mapped red closure lines are excluded when avoidance is on.</p>
        </div>
        <span class="network-badge">1,961 source roads</span>
      </div>
      <div class="route-endpoints">
        <div class="route-endpoint">
          <span class="route-endpoint-marker start">A</span>
          <div>
            <small>Start</small>
            <strong id="routeStartSummary">${project.routing?.start?.label || "Not set"}</strong>
            <input class="route-endpoint-label-input" data-route-endpoint-label="start" value="${project.routing?.start?.label || ""}" placeholder="Start pin label" ${project.routing?.start ? "" : "disabled"} />
          </div>
          <button class="button button-soft" data-route-map-centre="start" type="button">Use map centre</button>
        </div>
        <span class="route-arrow" aria-hidden="true">→</span>
        <div class="route-endpoint">
          <span class="route-endpoint-marker end">B</span>
          <div>
            <small>Destination</small>
            <strong id="routeEndSummary">${project.routing?.end?.label || "Not set"}</strong>
            <input class="route-endpoint-label-input" data-route-endpoint-label="end" value="${project.routing?.end?.label || ""}" placeholder="Destination pin label" ${project.routing?.end ? "" : "disabled"} />
          </div>
          <button class="button button-soft" data-route-map-centre="end" type="button">Use map centre</button>
        </div>
      </div>
      <div class="route-controls">
        <label class="route-checkbox">
          <input id="avoidClosuresInput" type="checkbox" ${project.routing?.avoidClosures !== false ? "checked" : ""} />
          <span>Avoid mapped closures</span>
        </label>
        <label class="route-checkbox">
          <input id="preferHighwaysInput" type="checkbox" ${project.routing?.preferHighways !== false ? "checked" : ""} />
          <span>Prefer state highways</span>
        </label>
        <label class="route-checkbox">
          <input id="includeAlternativesInput" type="checkbox" ${project.routing?.includeAlternatives === true ? "checked" : ""} />
          <span>Show a second route option</span>
        </label>
        <div class="route-control-actions">
          <button class="button button-quiet" id="swapRouteBtn" type="button">Swap</button>
          <button class="button button-quiet" id="clearRouteBtn" type="button">Clear</button>
          <button class="button button-primary" id="detectRouteBtn" type="button">Detect route</button>
        </div>
      </div>
      <div class="route-status" id="routeStatus" data-tone="muted">
        Choose a search result for A and B, or use the current map centre.
      </div>
      <div class="route-results" id="routeResults"></div>
      <details class="route-diagnostics" id="routeDiagnostics">
        <summary>
          <span>Route diagnostics</span>
          <small id="routeDiagnosticsCount">No runs logged</small>
        </summary>
        <div class="route-diagnostics-controls">
          <label class="route-checkbox">
            <input id="includeNetworkRoutesInput" type="checkbox" ${project.routing?.includeNetworkRoutesInGeoJson !== false ? "checked" : ""} />
            <span>Include the last detected network route in GeoJSON export</span>
          </label>
          <button class="button button-quiet" id="downloadRouteDiagnosticsBtn" type="button">Download diagnostic log</button>
        </div>
        <pre id="routeDiagnosticsLog">No route detection has been run for this draft.</pre>
      </details>
      <p class="route-caveat">Planning aid only: this road graph is undirected and does not include live traffic, turn restrictions or one-way rules.</p>
    </section>

    <div class="form-card compact-card">
      <div class="form-grid three">
        <label class="field">
          <span>Town or area</span>
          <input data-field="area" value="${project.area}" />
        </label>
        <label class="field field-span-two">
          <span>Location detail</span>
          <input data-field="locationDetail" value="${project.locationDetail}" />
        </label>
      </div>
    </div>
  </article>
`;

const renderStepWhen = (project) => `
  <article class="step-panel" data-step-panel="2">
    <header class="section-heading">
      <div>
        <span class="eyebrow">Step 3 · When</span>
        <h2>When will it affect people?</h2>
        <p>Add the exact window, recurrence and advice that people need.</p>
      </div>
      <span class="timezone-badge">NZ time · Pacific/Auckland</span>
    </header>

    <div class="form-card">
      <div class="form-card-heading">
        <h3>Closure window</h3>
        <span>Required for scheduling</span>
      </div>
      <div class="form-grid four">
        <label class="field">
          <span>Start date</span>
          <input type="date" data-field="startDate" value="${project.startDate}" />
        </label>
        <label class="field">
          <span>Start time</span>
          <input type="time" data-field="startTime" value="${project.startTime}" />
        </label>
        <label class="field">
          <span>End date</span>
          <input type="date" data-field="endDate" value="${project.endDate}" />
        </label>
        <label class="field">
          <span>End time</span>
          <input type="time" data-field="endTime" value="${project.endTime}" />
        </label>
        <label class="field">
          <span>Recurrence</span>
          <select data-field="recurrence">
            ${optionList(["Once", "Nightly", "Daily", "Weeknights", "Weekends", "Intermittent"], project.recurrence)}
          </select>
        </label>
        <label class="field field-span-three">
          <span>Short schedule label</span>
          <input data-field="scheduleNote" value="${project.scheduleNote}" placeholder="e.g. 9pm–5am each night" />
        </label>
      </div>
    </div>

    <div class="form-card">
      <div class="form-card-heading">
        <h3>Public advice</h3>
        <span>Keep it short and actionable</span>
      </div>
      <div class="form-grid two">
        <label class="field field-wide">
          <span>What people need to know</span>
          <textarea data-field="details" rows="4">${project.details}</textarea>
        </label>
        <label class="field field-wide">
          <span>Detour or access advice</span>
          <textarea data-field="detour" rows="4">${project.detour}</textarea>
        </label>
        <label class="field">
          <span>Journey information</span>
          <input data-field="contact" value="${project.contact}" />
        </label>
        <label class="field">
          <span>Internal reference</span>
          <input data-field="reference" value="${project.reference}" />
        </label>
      </div>
    </div>

    <div class="notice-card">
      <span class="notice-icon" aria-hidden="true">✓</span>
      <div>
        <strong>Ready for review</strong>
        <p>Your message, map and schedule will be combined into one export graphic on the next step.</p>
      </div>
    </div>
  </article>
`;

const renderStepPublish = (project) => `
  <article class="step-panel publish-panel" data-step-panel="3">
    <header class="section-heading publish-heading">
      <div>
        <span class="eyebrow">Step 4 · Publish</span>
        <h2>Review the graphic</h2>
        <p>Choose a format, check the composition, then export a production PNG.</p>
      </div>
      <div class="publish-actions">
        <button class="button button-quiet" id="publishGeoJsonBtn" type="button">GeoJSON</button>
        <button class="button button-primary" id="exportPngBtn" type="button">
          <span aria-hidden="true">↓</span> Export PNG
        </button>
      </div>
    </header>

    <div class="publish-workspace">
      <aside class="export-controls">
        <div class="control-section">
          <span class="control-label">Graphic format</span>
          <div class="format-grid">
            ${Object.entries(formats)
              .map(
                ([key, format]) => `
                  <button class="format-card ${project.format === key ? "selected" : ""}" data-format="${key}" type="button">
                    <i class="format-shape format-${key}" aria-hidden="true"></i>
                    <span><strong>${format.label}</strong><small>${format.width} × ${format.height}</small></span>
                    <b aria-hidden="true">✓</b>
                  </button>`
              )
              .join("")}
          </div>
        </div>

        <div class="control-section">
          <span class="control-label">Graphic map position</span>
          <p class="control-help">Drag the map in the graphic or use these controls. The chosen view is kept in the PNG.</p>
          <div class="graphic-map-controls">
            <button class="button button-soft" id="graphicMapZoomOutBtn" type="button" aria-label="Zoom graphic map out">−</button>
            <button class="button button-soft" id="graphicMapZoomInBtn" type="button" aria-label="Zoom graphic map in">＋</button>
            <button class="button button-quiet" id="graphicMapResetBtn" type="button">Auto fit</button>
          </div>
          <small class="graphic-map-mode" id="graphicMapMode">${project.publicationMap?.manual ? "Custom position" : "Auto fit to mapped features"}</small>
        </div>

        <div class="control-section">
          <span class="control-label">Map labels</span>
          <div class="graphic-label-options">
            <label><input type="checkbox" data-graphic-label="showFeatureLabels" ${project.graphicLabels?.showFeatureLabels !== false ? "checked" : ""} /> Feature names</label>
            <label><input type="checkbox" data-graphic-label="showDistances" ${project.graphicLabels?.showDistances !== false ? "checked" : ""} /> Route distances</label>
            <label><input type="checkbox" data-graphic-label="showMapCaption" ${project.graphicLabels?.showMapCaption !== false ? "checked" : ""} /> Area and road</label>
            <label><input type="checkbox" data-graphic-label="showLegend" ${project.graphicLabels?.showLegend !== false ? "checked" : ""} /> Legend</label>
            <label><input type="checkbox" data-graphic-label="showNorthArrow" ${project.graphicLabels?.showNorthArrow !== false ? "checked" : ""} /> North arrow</label>
            <label><input type="checkbox" data-graphic-label="showLabelBorders" ${project.graphicLabels?.showLabelBorders !== false ? "checked" : ""} /> Map label borders</label>
            <label><input type="checkbox" data-graphic-label="showLegendBorder" ${project.graphicLabels?.showLegendBorder !== false ? "checked" : ""} /> Legend border</label>
          </div>
        </div>

        <div class="control-section">
          <span class="control-label">Feature label editor</span>
          <p class="control-help">Edit label wording here. Drag a label directly on the graphic map to position it.</p>
          <div class="publication-label-list" id="publicationLabelList"></div>
        </div>

        <div class="control-section">
          <span class="control-label">Key item editor</span>
          <p class="control-help">Choose the key items to show and edit their wording or colour.</p>
          <div class="key-editor-list" id="keyEditorList">
            ${renderGraphicKeyEditor(project)}
          </div>
        </div>

        <div class="control-section reference-export-control">
          ${renderReferenceLayerControls(project, "publication")}
        </div>

        <div class="control-section">
          <span class="control-label">Export checklist</span>
          <ul class="checklist" id="exportChecklist">
            <li data-check="headline"><i>✓</i><span>Public headline</span></li>
            <li data-check="location"><i>✓</i><span>Mapped location</span></li>
            <li data-check="schedule"><i>✓</i><span>Closure schedule</span></li>
            <li data-check="detour"><i>✓</i><span>Travel advice</span></li>
          </ul>
        </div>

        <div class="control-section">
          <span class="control-label">Record status</span>
          <div class="segmented">
            ${["Draft", "Scheduled", "Active"]
              .map(
                (status) =>
                  `<button class="${project.status === status ? "active" : ""}" data-status="${status}" type="button">${status}</button>`
              )
              .join("")}
          </div>
        </div>

        <div class="export-note">
          <span aria-hidden="true">ⓘ</span>
          <p>PNG export is created in your browser. No closure data or graphic is uploaded.</p>
        </div>
      </aside>

      <section class="graphic-preview-panel">
        <div class="preview-toolbar">
          <div>
            <strong>Live composition</strong>
            <span id="previewDimensions">1080 × 1350 px</span>
          </div>
          <div class="preview-toolbar-actions">
            <button class="icon-button" id="zoomOutBtn" type="button" aria-label="Zoom out">−</button>
            <span id="zoomLabel">Fit</span>
            <button class="icon-button" id="zoomInBtn" type="button" aria-label="Zoom in">＋</button>
          </div>
        </div>
        <div class="graphic-viewport" id="graphicViewport">
          ${renderGraphicStage(project)}
        </div>
      </section>
    </div>
  </article>
`;

const renderGraphicStage = (project) => `
  <div class="graphic-stage" id="graphicStage" data-brand-style="far-north-district" role="img" aria-label="Road closure graphic preview">
    <header class="graphic-header">
      <img class="graphic-fndc-logo" src="./brand/fndc-logo-white.png" alt="Far North District Council" />
      <div class="graphic-titles">
        <h3 id="graphicHeadline">${project.headline}</h3>
        <p id="graphicSubheadline">${project.subheadline}</p>
      </div>
      <div class="graphic-status-pill" id="graphicStatus">${project.severity}</div>
    </header>
    <div class="graphic-map" id="graphicMap">
      <div class="graphic-leaflet-map" id="graphicLeafletMap" data-gis-context="OpenStreetMap"></div>
      <div class="graphic-north"><span>N</span></div>
      <div class="graphic-map-caption"><strong id="graphicArea">${project.area}</strong><span id="graphicRoad">${project.road}</span></div>
      <div class="graphic-key" id="graphicKey"></div>
    </div>
    <footer class="graphic-footer">
      <div class="graphic-info">
        <span class="graphic-calendar" aria-hidden="true">▣</span>
        <div>
          <small id="graphicRecurrence">${project.recurrence}</small>
          <strong id="graphicDateRange"></strong>
          <p id="graphicDetour">${project.detour}</p>
        </div>
      </div>
      <div class="graphic-brand">
        <strong>Far North road updates</strong>
        <span>Travel information</span>
        <small id="graphicReference">${project.reference}</small>
      </div>
    </footer>
  </div>
`;

const renderRecordsShell = () => `
  <div class="records-shell">
    <header class="records-header">
      <div>
        <span class="eyebrow">Interruption register</span>
        <h1>Road closures</h1>
        <p>Create, update and reuse planned public travel notices.</p>
      </div>
      <div class="records-header-actions">
        <button class="button button-quiet" type="button" id="importClosuresBtn">Import closures</button>
        <button class="button button-quiet" type="button" id="exportClosuresBtn">Export closures</button>
        <button class="button button-primary" type="button" data-view="editor" id="recordsNewBtn">＋ Create closure</button>
      </div>
    </header>

    <div class="record-stats">
      <div><span class="stat-icon red">⊘</span><strong id="statActive">0</strong><small>Active</small></div>
      <div><span class="stat-icon amber">◷</span><strong id="statScheduled">0</strong><small>Scheduled</small></div>
      <div><span class="stat-icon blue">✎</span><strong id="statDraft">0</strong><small>Drafts</small></div>
      <div><span class="stat-icon green">✓</span><strong id="statTotal">0</strong><small>Total records</small></div>
    </div>

    <div class="records-card">
      <div class="records-toolbar">
        <label class="record-search">
          <span aria-hidden="true">⌕</span>
          <input id="recordSearch" placeholder="Search road, place or reference" />
        </label>
        <div class="record-filters" role="group" aria-label="Filter closure records">
          ${["All", "Active", "Scheduled", "Draft"]
            .map(
              (filter) =>
                `<button class="${filter === "All" ? "active" : ""}" data-record-filter="${filter}" type="button">${filter}</button>`
            )
            .join("")}
        </div>
      </div>
      <div class="records-list" id="recordsList"></div>
      <div class="records-empty" id="recordsEmpty" hidden>
        <span>⌕</span>
        <h3>No closures found</h3>
        <p>Try another search or clear the current filter.</p>
      </div>
    </div>
  </div>
`;
