import { store } from '../state.js';

export function renderSkeletons(container, count = 6) {
  if (!container) return;
  const isGrid = store.state.viewMode === 'grid';
  container.classList.toggle('grid-view', isGrid);
  container.classList.toggle('list-view', !isGrid);

  let html = '';
  for (let i = 0; i < count; i++) {
    html += `<div class="skeleton skeleton-card">
  <div class="skeleton-thumb"></div>
  <div class="skeleton-body">
    <div class="skeleton-line w-80"></div>
    <div class="skeleton-line w-60"></div>
  </div>
</div>`;
  }
  container.innerHTML = html;
}