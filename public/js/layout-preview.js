const previewViewport = document.getElementById('preview-viewport');
const previewFrame = document.getElementById('game-preview');
const resizeHandle = document.getElementById('preview-resize-handle');
const dimensionsOutput = document.getElementById('preview-dimensions');
const stage = document.querySelector('.preview-stage');

const requestedScreen = new URLSearchParams(window.location.search).get('screen');
const previewScreen = requestedScreen === 'result' ? 'result' : 'game';
previewFrame.src = `/?preview=${previewScreen}`;

function updateDimensions() {
  const bounds = previewViewport.getBoundingClientRect();
  dimensionsOutput.value = `${Math.round(bounds.width)} × ${Math.round(bounds.height)} px`;
}

function getResizeLimits() {
  const stageBounds = stage.getBoundingClientRect();
  return {
    maxWidth: Math.max(320, stageBounds.width - 24),
    maxHeight: Math.max(360, stageBounds.height - 24)
  };
}

let resizeStart = null;

resizeHandle.addEventListener('pointerdown', event => {
  event.preventDefault();
  const bounds = previewViewport.getBoundingClientRect();
  resizeStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    width: bounds.width,
    height: bounds.height
  };
  resizeHandle.setPointerCapture(event.pointerId);
  previewViewport.classList.add('is-resizing');
});

resizeHandle.addEventListener('pointermove', event => {
  if (!resizeStart || event.pointerId !== resizeStart.pointerId) return;
  const limits = getResizeLimits();
  const width = Math.min(limits.maxWidth, Math.max(320, resizeStart.width + event.clientX - resizeStart.x));
  const height = Math.min(limits.maxHeight, Math.max(360, resizeStart.height + event.clientY - resizeStart.y));
  previewViewport.style.width = `${Math.round(width)}px`;
  previewViewport.style.height = `${Math.round(height)}px`;
  updateDimensions();
});

function finishResize(event) {
  if (!resizeStart || event.pointerId !== resizeStart.pointerId) return;
  resizeStart = null;
  previewViewport.classList.remove('is-resizing');
}

resizeHandle.addEventListener('pointerup', finishResize);
resizeHandle.addEventListener('pointercancel', finishResize);
window.addEventListener('resize', updateDimensions);
window.addEventListener('load', updateDimensions);

updateDimensions();