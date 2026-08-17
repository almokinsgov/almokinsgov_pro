(() => {
  'use strict';

  const source = window.PUBLIC_ROADS;
  if (!source || !Array.isArray(source.roads)) {
    document.body.innerHTML = '<main style="padding:2rem;font-family:Arial,sans-serif"><h1>Who Maintains My Road?</h1><p>Road information could not be loaded.</p></main>';
    return;
  }

  const PAGE_SIZE = 10;
  const roads = source.roads;
  const els = {
    search: document.getElementById('roadSearch'),
    clear: document.getElementById('clearSearch'),
    list: document.getElementById('roadList'),
    headingRow: document.querySelector('.results-heading-row'),
    summary: document.getElementById('resultSummary'),
    empty: document.getElementById('emptyState'),
    details: document.getElementById('roadDetails'),
    pagination: document.getElementById('pagination'),
    previous: document.getElementById('previousPage'),
    pageStatus: document.getElementById('pageStatus'),
    next: document.getElementById('nextPage')
  };

  let selectedRoad = null;
  let matchedRoads = [];
  let visibleRoads = [];
  let currentPage = 1;

  function normalise(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\bsh\s*(\d+)\b/g, 'state highway $1')
      .replace(/\brd\b/g, 'road')
      .replace(/\bst\b/g, 'street')
      .replace(/\bave\b/g, 'avenue')
      .replace(/\bdr\b/g, 'drive')
      .replace(/\bln\b/g, 'lane')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[character]);
  }

  function formatRoadLength(value) {
    const number = Number(value) || 0;
    return `${number.toFixed(2)} km`;
  }

  function formatChainageKm(value) {
    const number = Number(value) || 0;
    return `${number.toFixed(3)} km`;
  }

  function searchRoads(query) {
    const q = normalise(query);
    if (!q) return [];

    const tokens = q.split(' ').filter(Boolean);
    const scored = [];

    for (const road of roads) {
      const name = normalise(road.name);
      const aliases = (road.aliases || []).map(normalise);
      const searchable = [name, ...aliases].join(' ');

      if (!tokens.every(token => searchable.includes(token))) continue;

      let score = 0;
      if (name === q) score += 1000;
      if (aliases.includes(q)) score += 850;
      if (name.startsWith(q)) score += 500;
      if (aliases.some(alias => alias.startsWith(q))) score += 350;
      if (name.includes(q)) score += 220;
      score += Math.max(0, 80 - Math.abs(name.length - q.length));
      scored.push({ score, road });
    }

    scored.sort((a, b) => b.score - a.score || a.road.name.localeCompare(b.road.name, 'en-NZ') || a.road.length_km - b.road.length_km);
    return scored.map(item => item.road);
  }

  function totalPages() {
    return Math.max(1, Math.ceil(matchedRoads.length / PAGE_SIZE));
  }

  function clearSelectedRoad() {
    selectedRoad = null;
    els.details.hidden = true;
    els.details.innerHTML = '';
  }

  function renderPagination() {
    const pages = totalPages();
    const showPagination = matchedRoads.length > PAGE_SIZE;
    els.pagination.hidden = !showPagination;

    if (!showPagination) return;

    els.previous.disabled = currentPage <= 1;
    els.next.disabled = currentPage >= pages;
    els.pageStatus.textContent = `Page ${currentPage} of ${pages}`;
  }

  function renderResults() {
    const query = els.search.value.trim();
    els.clear.hidden = !query;
    els.headingRow.hidden = false;
    clearSelectedRoad();

    if (!query) {
      matchedRoads = [];
      visibleRoads = [];
      currentPage = 1;
      els.summary.textContent = '';
      els.list.innerHTML = '';
      els.pagination.hidden = true;
      els.empty.hidden = false;
      els.empty.textContent = 'Start typing a road name to see roads.';
      return;
    }

    matchedRoads = searchRoads(query);

    if (!matchedRoads.length) {
      visibleRoads = [];
      currentPage = 1;
      els.summary.textContent = 'No roads found';
      els.list.innerHTML = '';
      els.pagination.hidden = true;
      els.empty.hidden = false;
      els.empty.textContent = 'No roads were found. Check the spelling or try a shorter road name.';
      return;
    }

    const pages = totalPages();
    currentPage = Math.min(Math.max(currentPage, 1), pages);
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const endIndex = Math.min(startIndex + PAGE_SIZE, matchedRoads.length);
    visibleRoads = matchedRoads.slice(startIndex, endIndex);

    els.empty.hidden = true;
    els.summary.textContent = matchedRoads.length > PAGE_SIZE
      ? `Showing ${startIndex + 1} to ${endIndex} of ${matchedRoads.length} roads`
      : `${matchedRoads.length} road${matchedRoads.length === 1 ? '' : 's'} found`;

    els.list.innerHTML = visibleRoads.map((road, index) => `
      <button
        type="button"
        class="road-result"
        role="option"
        aria-selected="false"
        data-index="${index}"
      >
        <span class="road-result-name">${escapeHtml(road.name)}</span>
        <span class="road-result-length">${formatRoadLength(road.length_km)}</span>
      </button>
    `).join('');

    renderPagination();
  }

  function renderDetails(road) {
    selectedRoad = road;
    const sections = road.sections || [];
    const multiple = sections.length > 1;

    els.details.innerHTML = `
      <h2 class="detail-heading" tabindex="-1">${escapeHtml(road.name)}</h2>
      <p class="detail-length">Road length: ${formatRoadLength(road.length_km)}</p>
      ${multiple ? '<p class="section-intro">Ownership or maintenance changes along this road. The sections are shown below.</p>' : ''}
      <div class="sections">
        ${sections.map(section => `
          <article class="road-section">
            <h3 class="section-range">${formatChainageKm(section.from_km)} to ${formatChainageKm(section.to_km)}</h3>
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">Road owned by</span>
                <span class="detail-value">${escapeHtml(section.owner)}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Maintained by</span>
                <span class="detail-value">${escapeHtml(section.maintained_by)}</span>
              </div>
            </div>
          </article>
        `).join('')}
      </div>
    `;
    els.details.hidden = false;
  }

  function selectRoad(road) {
    selectedRoad = road;

    // Clear the search and all search-result UI so the selected details move
    // directly below the search card instead of remaining below a long result list.
    els.search.value = '';
    els.clear.hidden = true;
    matchedRoads = [];
    visibleRoads = [];
    currentPage = 1;
    els.list.innerHTML = '';
    els.summary.textContent = '';
    els.empty.hidden = true;
    els.pagination.hidden = true;
    els.headingRow.hidden = true;

    renderDetails(road);

    const heading = els.details.querySelector('.detail-heading');
    if (heading) heading.focus({ preventScroll: true });
  }

  els.search.addEventListener('input', () => {
    currentPage = 1;
    renderResults();
  });

  els.clear.addEventListener('click', () => {
    els.search.value = '';
    currentPage = 1;
    renderResults();
    els.search.focus();
  });

  els.list.addEventListener('click', event => {
    const button = event.target.closest('.road-result');
    if (!button) return;
    const road = visibleRoads[Number(button.dataset.index)];
    if (road) selectRoad(road);
  });

  els.previous.addEventListener('click', () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    renderResults();
    els.list.querySelector('.road-result')?.focus();
  });

  els.next.addEventListener('click', () => {
    if (currentPage >= totalPages()) return;
    currentPage += 1;
    renderResults();
    els.list.querySelector('.road-result')?.focus();
  });

  renderResults();
})();
