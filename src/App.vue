<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { createConnection, createElement } from './flow/defaults';
import {
  findAnchor,
  getElementBox,
  getFlowBounds,
  hasSignificantPointerMovement,
  inferTargetSide,
  resizeElementBox,
  snapElement,
  snapPreviewPoint,
} from './flow/geometry';
import {
  hitTestAnchorHandle,
  hitTestConnection,
  hitTestElement,
  hitTestElementAnchorOrEdge,
  hitTestResizeHandle,
  hitTestResizeHandleOnElements,
} from './flow/hitTesting';
import { renderFlow } from './flow/render';
import {
  applyElementSizeMode,
  cloneConnection,
  clearHoverState,
  cloneSelection,
  createFixedResizeBase,
  deleteSelectionFromFlow,
  getExportContent,
  getSharedValue,
  getSelectionItems,
  isSelected,
  normalizeConnectionNumber,
  normalizeElementNumber,
  pushHistory,
  redo,
  restoreElementPositions,
  toggleSelection,
  undo,
  type FlowSnapshot,
  type HistoryState,
} from './flow/state';
import type { Anchor, Connection, EditorState, FlowElement, Point, ResizeHandle } from './types/flow';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const stageRef = ref<HTMLElement | null>(null);
const elementTextInputRef = ref<HTMLInputElement | null>(null);

const state = reactive<EditorState>({
  elements: [
    {
      ...createElement(190, 170),
      text: 'Start',
    },
    {
      ...createElement(490, 280),
      text: 'Review',
    },
  ],
  connections: [],
  selection: null,
  viewport: {
    x: 0,
    y: 0,
    zoom: 1,
  },
  mode: 'idle',
  pendingConnectionSource: null,
  previewConnection: null,
  hoverElementId: null,
  hoverConnectionId: null,
  hoverAnchor: null,
  hoverResizeHandle: null,
  guides: [],
});

state.connections.push(createConnection(state.elements[0].id, state.elements[1].id, 'right', 'left'));

const history = reactive<HistoryState>({
  past: [],
  future: [],
});

const selectedItems = computed(() => getSelectionItems(state.selection));
const selectedCount = computed(() => selectedItems.value.length);
const selectedElement = computed(() => {
  const items = selectedItems.value;
  if (items.length !== 1 || items[0].type !== 'element') return null;
  return state.elements.find((element) => element.id === items[0].id) ?? null;
});
const selectedConnection = computed(() => {
  const items = selectedItems.value;
  if (items.length !== 1 || items[0].type !== 'connection') return null;
  return state.connections.find((connection) => connection.id === items[0].id) ?? null;
});
const selectedElements = computed(() =>
  selectedItems.value
    .filter((item) => item.type === 'element')
    .map((item) => state.elements.find((element) => element.id === item.id))
    .filter((element): element is FlowElement => Boolean(element)),
);
const selectedConnections = computed(() =>
  selectedItems.value
    .filter((item) => item.type === 'connection')
    .map((item) => state.connections.find((connection) => connection.id === item.id))
    .filter((connection): connection is Connection => Boolean(connection)),
);
const hasMixedSelection = computed(() => selectedElements.value.length > 0 && selectedConnections.value.length > 0);
const showBatchElementForm = computed(() => selectedElements.value.length > 1 && selectedConnections.value.length === 0);
const showBatchConnectionForm = computed(() => selectedConnections.value.length > 1 && selectedElements.value.length === 0);
const selectionSummary = computed(() => {
  const elementCount = selectedElements.value.length;
  const connectionCount = selectedConnections.value.length;
  if (elementCount === 0 && connectionCount === 0) return 'No selection';
  const parts = [];
  if (elementCount > 0) parts.push(`${elementCount} ${elementCount === 1 ? 'element' : 'elements'}`);
  if (connectionCount > 0) parts.push(`${connectionCount} ${connectionCount === 1 ? 'connection' : 'connections'}`);
  return parts.join(', ');
});
const exportStatus = ref('');

const drag = ref<{
  primaryId: string;
  ids: string[];
  offsetX: number;
  offsetY: number;
  originals: Array<{ id: string; x: number; y: number }>;
  startSnapshot: FlowSnapshot;
  moved: boolean;
} | null>(null);

const resize = ref<{
  id: string;
  handle: ResizeHandle;
  startPoint: Point;
  original: FlowElement;
  base: FlowElement;
  startSnapshot: FlowSnapshot;
  moved: boolean;
} | null>(null);

const pan = ref<{
  startPoint: Point;
  startViewport: { x: number; y: number; zoom: number };
  moved: boolean;
  preserveSelection: boolean;
} | null>(null);

const isSpacePressed = ref(false);
const connectionStartedAt = ref(0);
const canvasCursor = ref('default');
const EXPORT_FONT = '14px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const CONNECTION_CREATION_MOVE_THRESHOLD = 10;

function snapshot(): FlowSnapshot {
  return {
    elements: state.elements.map(cloneElement),
    connections: state.connections.map(cloneConnection),
    selection: cloneSelection(state.selection),
  };
}

function applySnapshot(next: FlowSnapshot) {
  clearExportStatus();
  state.elements = next.elements.map(cloneElement);
  state.connections = next.connections.map(cloneConnection);
  state.selection = cloneSelection(next.selection);
  state.mode = 'idle';
  state.pendingConnectionSource = null;
  state.previewConnection = null;
  state.guides = [];
  clearHover();
  nextTick(draw);
}

function recordHistory() {
  clearExportStatus();
  pushHistory(history, snapshot());
}

function clearExportStatus() {
  exportStatus.value = '';
}

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  renderFlow(context, canvas, state.elements, state.connections, state.selection, state.guides, {
    ...state.viewport,
  }, {
    hoverElementId: state.hoverElementId,
    hoverConnectionId: state.hoverConnectionId,
    hoverAnchor: state.hoverAnchor,
    hoverResizeHandle: state.hoverResizeHandle,
    previewConnection: state.previewConnection,
  });
}

function resizeCanvas() {
  const canvas = canvasRef.value;
  const stage = stageRef.value;
  if (!canvas || !stage) return;
  const pixelRatio = window.devicePixelRatio || 1;
  const rect = stage.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * pixelRatio);
  canvas.height = Math.floor(rect.height * pixelRatio);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  draw();
}

function canvasPoint(event: PointerEvent): Point {
  const canvas = canvasRef.value;
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function worldPoint(event: PointerEvent): Point {
  const point = canvasPoint(event);
  return screenToWorld(point);
}

function screenToWorld(point: Point): Point {
  return {
    x: (point.x - state.viewport.x) / state.viewport.zoom,
    y: (point.y - state.viewport.y) / state.viewport.zoom,
  };
}

function addElement() {
  recordHistory();
  const stage = stageRef.value;
  const rect = stage?.getBoundingClientRect();
  const center = screenToWorld({
    x: (rect?.width ?? 900) / 2,
    y: (rect?.height ?? 600) / 2,
  });
  const next = createElement(center.x - 75, center.y - 36);
  state.elements.push(next);
  state.selection = { type: 'element', id: next.id };
  state.mode = 'idle';
  nextTick(() => {
    draw();
    focusElementText();
  });
}

function isMultiSelectEvent(event: PointerEvent | MouseEvent) {
  return event.metaKey || event.ctrlKey;
}

function onPointerDown(event: PointerEvent) {
  clearExportStatus();
  const canvas = canvasRef.value;
  if (!canvas) return;
  const screenPoint = canvasPoint(event);
  const point = screenToWorld(screenPoint);
  const context = canvas.getContext('2d') ?? undefined;
  const multiSelect = isMultiSelectEvent(event);
  const elementControlsHidden = selectedElements.value.length > 1;

  if (state.mode === 'creating-connection' && state.pendingConnectionSource && state.previewConnection) {
    completeConnectionCreation(point, context);
    finishPointerInteraction();
    return;
  }

  if (isSpacePressed.value || event.button === 1) {
    state.mode = 'panning-canvas';
    pan.value = {
      startPoint: screenPoint,
      startViewport: { ...state.viewport },
      moved: false,
      preserveSelection: true,
    };
    canvas.setPointerCapture(event.pointerId);
    updateCursor('grabbing');
    return;
  }

  const anchor = elementControlsHidden ? null : hitTestAnchorHandle(point, state.elements, context);
  if (anchor) {
    state.mode = 'creating-connection';
    connectionStartedAt.value = Date.now();
    state.pendingConnectionSource = { elementId: anchor.elementId, side: anchor.side };
    state.previewConnection = { source: anchor, pointer: point, target: null };
    state.selection = { type: 'element', id: anchor.elementId };
    canvas.setPointerCapture(event.pointerId);
    updateCursor('crosshair');
    draw();
    return;
  }

  const element = hitTestElement(point, state.elements, context);
  const selected = selectedElement.value;
  const resizeHit = elementControlsHidden ? null : hitTestResizeHandleOnElements(point, state.elements, context);
  const resizeTarget = resizeHit?.element ?? element ?? selected;
  const resizeHandle = resizeHit?.handle ?? hitTestResizeHandle(point, resizeTarget, context);
  if (resizeTarget && resizeHandle) {
    const startSnapshot = snapshot();
    state.selection = { type: 'element', id: resizeTarget.id };
    const original = cloneElement(resizeTarget);
    const base = createFixedResizeBase(resizeTarget, getElementBox(resizeTarget, context));
    resize.value = {
      id: resizeTarget.id,
      handle: resizeHandle,
      startPoint: point,
      original,
      base,
      startSnapshot,
      moved: false,
    };
    state.mode = 'resizing-element';
    canvas.setPointerCapture(event.pointerId);
    updateCursor(cursorForResizeHandle(resizeHandle));
    return;
  }

  const connection = hitTestConnection(point, state.connections, state.elements, context);
  if (connection) {
    state.selection = multiSelect
      ? toggleSelection(state.selection, { type: 'connection', id: connection.id })
      : { type: 'connection', id: connection.id };
    state.mode = 'idle';
    draw();
    return;
  }

  if (element) {
    if (multiSelect) {
      state.selection = toggleSelection(state.selection, { type: 'element', id: element.id });
      state.mode = 'idle';
      draw();
      return;
    }

    const draggingSelection = selectedElements.value.length > 1 && isSelected(state.selection, 'element', element.id);
    const startSnapshot = snapshot();
    if (!draggingSelection) state.selection = { type: 'element', id: element.id };
    const draggedElements = draggingSelection ? selectedElements.value : [element];
    const box = getElementBox(element, context);
    drag.value = {
      primaryId: element.id,
      ids: draggedElements.map((item) => item.id),
      offsetX: point.x - box.x,
      offsetY: point.y - box.y,
      originals: draggedElements.map((item) => ({ id: item.id, x: item.x, y: item.y })),
      startSnapshot,
      moved: false,
    };
    state.mode = 'dragging-element';
    canvas.setPointerCapture(event.pointerId);
    updateCursor('grabbing');
    draw();
    return;
  }

  state.mode = 'panning-canvas';
  pan.value = {
    startPoint: screenPoint,
    startViewport: { ...state.viewport },
    moved: false,
    preserveSelection: multiSelect,
  };
  canvas.setPointerCapture(event.pointerId);
  clearHover();
  updateCursor('grab');
  draw();
}

function onPointerMove(event: PointerEvent) {
  const canvas = canvasRef.value;
  const context = canvas?.getContext('2d') ?? undefined;
  const screenPoint = canvasPoint(event);
  const point = screenToWorld(screenPoint);

  if (state.mode === 'panning-canvas' && pan.value) {
    state.viewport.x = pan.value.startViewport.x + screenPoint.x - pan.value.startPoint.x;
    state.viewport.y = pan.value.startViewport.y + screenPoint.y - pan.value.startPoint.y;
    pan.value.moved = Math.hypot(screenPoint.x - pan.value.startPoint.x, screenPoint.y - pan.value.startPoint.y) > 3;
    updateCursor('grabbing');
    draw();
    return;
  }

  if (state.mode === 'creating-connection' && state.previewConnection) {
    const target = hitTestElementAnchorOrEdge(point, state.elements, state.pendingConnectionSource?.elementId, context);
    state.previewConnection.pointer = target ? point : snapPreviewPoint(state.previewConnection.source, point);
    state.hoverAnchor = target ? { elementId: target.elementId, side: target.side } : null;
    state.previewConnection.target = target;
    state.hoverElementId = target?.elementId ?? null;
    updateCursor('crosshair');
    draw();
    return;
  }

  if (state.mode === 'resizing-element' && resize.value) {
    const element = state.elements.find((item) => item.id === resize.value?.id);
    if (!element) return;
    const deltaX = point.x - resize.value.startPoint.x;
    const deltaY = point.y - resize.value.startPoint.y;
    const next = resizeElementBox(resize.value.base, resize.value.handle, deltaX, deltaY);
    element.x = next.x;
    element.y = next.y;
    element.width = next.width;
    element.height = next.height;
    element.sizeMode = 'fixed';
    resize.value.moved = true;
    updateCursor(cursorForResizeHandle(resize.value.handle));
    draw();
    return;
  }

  if (state.mode === 'dragging-element' && drag.value) {
    const moving = state.elements.find((element) => element.id === drag.value?.primaryId);
    if (!moving) return;
    const originalPrimary = drag.value.originals.find((item) => item.id === drag.value?.primaryId);
    if (!originalPrimary) return;
    const proposedX = point.x - drag.value.offsetX;
    const proposedY = point.y - drag.value.offsetY;
    const movingIds = new Set(drag.value.ids);
    const snapped = snapElement(moving, state.elements.filter((element) => !movingIds.has(element.id)), proposedX, proposedY, context);
    const deltaX = snapped.x - originalPrimary.x;
    const deltaY = snapped.y - originalPrimary.y;
    for (const original of drag.value.originals) {
      const element = state.elements.find((item) => item.id === original.id);
      if (!element) continue;
      element.x = original.x + deltaX;
      element.y = original.y + deltaY;
    }
    state.guides = snapped.guides;
    drag.value.moved = true;
    updateCursor('grabbing');
    draw();
    return;
  }

  refreshHover(point);
  draw();
}

function onPointerUp(event: PointerEvent) {
  const canvas = canvasRef.value;
  const point = worldPoint(event);
  const context = canvas?.getContext('2d') ?? undefined;

  if (state.mode === 'creating-connection' && state.pendingConnectionSource && state.previewConnection) {
    completeConnectionCreation(point, context);
    finishPointerInteraction(event.pointerId);
    return;
  }

  if (state.mode === 'resizing-element' && resize.value) {
    if (resize.value.moved) pushHistory(history, resize.value.startSnapshot);
    finishPointerInteraction(event.pointerId);
    return;
  }

  if (state.mode === 'dragging-element' && drag.value) {
    if (drag.value.moved) pushHistory(history, drag.value.startSnapshot);
    finishPointerInteraction(event.pointerId);
    return;
  }

  if (state.mode === 'panning-canvas' && pan.value) {
    if (!pan.value.preserveSelection && !pan.value.moved) {
      state.selection = null;
    }
    finishPointerInteraction(event.pointerId);
    return;
  }

  finishPointerInteraction(event.pointerId);
}

function onMouseUp(event: MouseEvent) {
  const canvas = canvasRef.value;
  const context = canvas?.getContext('2d') ?? undefined;
  const rect = canvas?.getBoundingClientRect();
  if (!rect) return;
  const point = screenToWorld({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });

  if (state.mode === 'creating-connection' && state.pendingConnectionSource && state.previewConnection) {
    completeConnectionCreation(point, context);
    finishPointerInteraction();
    return;
  }

  if (state.mode === 'resizing-element' && resize.value) {
    if (resize.value.moved) pushHistory(history, resize.value.startSnapshot);
    finishPointerInteraction();
    return;
  }

  if (state.mode === 'dragging-element' && drag.value) {
    if (drag.value.moved) pushHistory(history, drag.value.startSnapshot);
    finishPointerInteraction();
    return;
  }

  if (state.mode === 'panning-canvas' && pan.value) {
    if (!pan.value.preserveSelection && !pan.value.moved) {
      state.selection = null;
    }
    finishPointerInteraction();
  }
}

function onMouseDown(event: MouseEvent) {
  if (state.mode !== 'creating-connection' || !state.pendingConnectionSource || !state.previewConnection) return;
  if (Date.now() - connectionStartedAt.value < 120) return;
  const canvas = canvasRef.value;
  const context = canvas?.getContext('2d') ?? undefined;
  const rect = canvas?.getBoundingClientRect();
  if (!rect) return;
  const point = screenToWorld({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });
  completeConnectionCreation(point, context);
  finishPointerInteraction();
}

function connectionPointerMovedEnough(point: Point): boolean {
  const source = state.previewConnection?.source;
  if (!source) return false;
  return hasSignificantPointerMovement(source, point, state.viewport.zoom, CONNECTION_CREATION_MOVE_THRESHOLD);
}

function getPreviewCreationPoint(point: Point): Point {
  const source = state.previewConnection?.source;
  if (!source) return point;
  return snapPreviewPoint(source, point);
}

function completeConnectionCreation(point: Point, context?: CanvasRenderingContext2D) {
  if (!state.pendingConnectionSource || !connectionPointerMovedEnough(point)) return;
  const source = state.pendingConnectionSource;
  const target = hitTestElementAnchorOrEdge(point, state.elements, source.elementId, context);
  recordHistory();
  if (target) {
    const connection = createConnection(source.elementId, target.elementId, source.side, target.side);
    state.connections.push(connection);
    state.selection = { type: 'connection', id: connection.id };
    return;
  }

  const targetSide = inferTargetSide(source.side);
  const creationPoint = getPreviewCreationPoint(point);
  const next = createElement(creationPoint.x, creationPoint.y);
  next.text = 'New Node';
  const box = getElementBox(next, context);
  const anchor = findAnchor([next], { elementId: next.id, side: targetSide }, context);
  next.x += creationPoint.x - (anchor?.x ?? box.x);
  next.y += creationPoint.y - (anchor?.y ?? box.y);
  state.elements.push(next);
  state.connections.push(createConnection(source.elementId, next.id, source.side, targetSide));
  state.selection = { type: 'element', id: next.id };
  nextTick(focusElementText);
}

function onWheel(event: WheelEvent) {
  event.preventDefault();
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const mouse = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  const before = screenToWorld(mouse);
  const direction = event.deltaY > 0 ? -1 : 1;
  const factor = direction > 0 ? 1.08 : 0.92;
  const nextZoom = Math.min(2.5, Math.max(0.35, state.viewport.zoom * factor));
  state.viewport.zoom = nextZoom;
  state.viewport.x = mouse.x - before.x * nextZoom;
  state.viewport.y = mouse.y - before.y * nextZoom;
  draw();
}

function resetView() {
  state.viewport.x = 0;
  state.viewport.y = 0;
  state.viewport.zoom = 1;
  draw();
}

function createExportCanvas() {
  const sourceCanvas = canvasRef.value;
  const sourceContext = sourceCanvas?.getContext('2d') ?? undefined;
  const content = getExportContent(state.elements, state.connections, state.selection);
  sourceContext?.save();
  if (sourceContext) sourceContext.font = EXPORT_FONT;
  const bounds = getFlowBounds(content.elements, content.connections, sourceContext);
  sourceContext?.restore();
  if (!bounds) return null;

  const padding = 36;
  const width = Math.max(1, Math.ceil(bounds.maxX - bounds.minX + padding * 2));
  const height = Math.max(1, Math.ceil(bounds.maxY - bounds.minY + padding * 2));
  const pixelRatio = window.devicePixelRatio || 1;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = Math.ceil(width * pixelRatio);
  exportCanvas.height = Math.ceil(height * pixelRatio);
  exportCanvas.style.width = `${width}px`;
  exportCanvas.style.height = `${height}px`;

  const context = exportCanvas.getContext('2d');
  if (!context) return null;

  renderFlow(
    context,
    exportCanvas,
    content.elements,
    content.connections,
    null,
    [],
    {
      x: padding - bounds.minX,
      y: padding - bounds.minY,
      zoom: 1,
    },
    {
      hoverElementId: null,
      hoverConnectionId: null,
      hoverAnchor: null,
      hoverResizeHandle: null,
      previewConnection: null,
      showGrid: false,
    },
  );

  return exportCanvas;
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not export the canvas image.'));
    }, 'image/png');
  });
}

async function downloadImage() {
  exportStatus.value = 'Preparing image...';
  const exportCanvas = createExportCanvas();
  if (!exportCanvas) {
    exportStatus.value = 'Nothing to export';
    return;
  }
  const blob = await canvasToPngBlob(exportCanvas);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = selectedCount.value > 0 ? 'flowcanvas-selection.png' : 'flowcanvas-board.png';
  link.click();
  URL.revokeObjectURL(url);
  exportStatus.value = 'Image downloaded';
}

async function copyImage() {
  exportStatus.value = 'Preparing image...';
  const exportCanvas = createExportCanvas();
  if (!exportCanvas) {
    exportStatus.value = 'Nothing to copy';
    return;
  }
  try {
    const blob = await canvasToPngBlob(exportCanvas);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    exportStatus.value = 'Image copied';
  } catch {
    exportStatus.value = 'Copy is unavailable in this browser';
  }
}

function finishPointerInteraction(pointerId?: number) {
  if (pointerId !== undefined) {
    try {
      canvasRef.value?.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already be released if the pointer leaves the window.
    }
  }
  drag.value = null;
  resize.value = null;
  pan.value = null;
  state.mode = 'idle';
  state.pendingConnectionSource = null;
  state.previewConnection = null;
  connectionStartedAt.value = 0;
  state.guides = [];
  clearHover();
  updateCursor('default');
  draw();
}

function deleteSelection() {
  if (!state.selection) return;
  recordHistory();
  const next = deleteSelectionFromFlow(state.elements, state.connections, state.selection);
  state.elements = next.elements;
  state.connections = next.connections;
  state.selection = next.selection;
  draw();
}

function updateElement<K extends keyof FlowElement>(element: FlowElement, key: K, value: FlowElement[K]) {
  if (Object.is(element[key], value)) return;
  recordHistory();
  element[key] = value;
  draw();
}

function updateElementSizeMode(element: FlowElement, sizeMode: FlowElement['sizeMode']) {
  if (element.sizeMode === sizeMode) return;
  const context = canvasRef.value?.getContext('2d') ?? undefined;
  const box = getElementBox(element, context);
  recordHistory();
  applyElementSizeMode(element, sizeMode, box);
  draw();
}

function updateConnection<K extends keyof Connection>(connection: Connection, key: K, value: Connection[K]) {
  if (Object.is(connection[key], value)) return;
  recordHistory();
  connection[key] = value;
  draw();
}

function updateElementNumber<K extends keyof FlowElement>(element: FlowElement, key: K, input: HTMLInputElement) {
  if (input.value === '') return;
  const value = input.valueAsNumber;
  if (!Number.isFinite(value)) return;
  updateElement(element, key, normalizeElementNumber(key, value) as FlowElement[K]);
}

function updateConnectionNumber<K extends keyof Connection>(connection: Connection, key: K, input: HTMLInputElement) {
  if (input.value === '') return;
  const value = input.valueAsNumber;
  if (!Number.isFinite(value)) return;
  updateConnection(connection, key, normalizeConnectionNumber(key, value) as Connection[K]);
}

function batchElementValue<K extends keyof FlowElement>(key: K): FlowElement[K] | '' {
  return getSharedValue(selectedElements.value as unknown as Array<Record<string, unknown>>, key as string) as FlowElement[K] | '';
}

function batchConnectionValue<K extends keyof Connection>(key: K): Connection[K] | '' {
  return getSharedValue(selectedConnections.value as unknown as Array<Record<string, unknown>>, key as string) as Connection[K] | '';
}

function updateSelectedElements<K extends keyof FlowElement>(key: K, value: FlowElement[K]) {
  if (selectedElements.value.length === 0) return;
  if (selectedElements.value.every((element) => Object.is(element[key], value))) return;
  recordHistory();
  for (const element of selectedElements.value) {
    element[key] = value;
  }
  draw();
}

function updateSelectedConnections<K extends keyof Connection>(key: K, value: Connection[K]) {
  if (selectedConnections.value.length === 0) return;
  if (selectedConnections.value.every((connection) => Object.is(connection[key], value))) return;
  recordHistory();
  for (const connection of selectedConnections.value) {
    connection[key] = value;
  }
  draw();
}

function updateSelectedElementColor(key: 'backgroundColor' | 'borderColor', value: string) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) return;
  updateSelectedElements(key, value);
}

function updateSelectedElementNumber<K extends keyof FlowElement>(key: K, input: HTMLInputElement) {
  if (input.value === '') return;
  const value = input.valueAsNumber;
  if (!Number.isFinite(value)) return;
  updateSelectedElements(key, normalizeElementNumber(key, value) as FlowElement[K]);
}

function updateSelectedConnectionNumber<K extends keyof Connection>(key: K, input: HTMLInputElement) {
  if (input.value === '') return;
  const value = input.valueAsNumber;
  if (!Number.isFinite(value)) return;
  updateSelectedConnections(key, normalizeConnectionNumber(key, value) as Connection[K]);
}

function updateSelectedElementChoice<K extends keyof FlowElement>(key: K, input: HTMLSelectElement) {
  if (!input.value) return;
  updateSelectedElements(key, input.value as FlowElement[K]);
}

function updateSelectedElementSizeMode(input: HTMLSelectElement) {
  if (!input.value) return;
  const sizeMode = input.value as FlowElement['sizeMode'];
  if (selectedElements.value.length === 0) return;
  if (selectedElements.value.every((element) => element.sizeMode === sizeMode)) return;
  const context = canvasRef.value?.getContext('2d') ?? undefined;
  const measuredBoxes = new Map(selectedElements.value.map((element) => [element.id, getElementBox(element, context)]));
  recordHistory();
  for (const element of selectedElements.value) {
    applyElementSizeMode(element, sizeMode, measuredBoxes.get(element.id));
  }
  draw();
}

function updateSelectedConnectionChoice<K extends keyof Connection>(key: K, input: HTMLSelectElement) {
  if (!input.value) return;
  updateSelectedConnections(key, input.value as Connection[K]);
}

function undoAction() {
  const previous = undo(history, snapshot());
  if (previous) applySnapshot(previous);
}

function redoAction() {
  const next = redo(history, snapshot());
  if (next) applySnapshot(next);
}

function onKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const isEditingField = target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.tagName === 'TEXTAREA';
  const commandKey = event.metaKey || event.ctrlKey;

  if (event.key === 'Escape') {
    event.preventDefault();
    if (state.mode === 'resizing-element' && resize.value) {
      const element = state.elements.find((item) => item.id === resize.value?.id);
      if (element) Object.assign(element, cloneElement(resize.value.original));
    }
    if (state.mode === 'dragging-element' && drag.value) {
      restoreElementPositions(state.elements, drag.value.originals);
    }
    if (state.mode === 'idle') {
      state.selection = null;
    }
    finishPointerInteraction();
    return;
  }

  if (event.code === 'Space' && !isEditingField) {
    event.preventDefault();
    isSpacePressed.value = true;
    if (state.mode === 'idle') updateCursor('grab');
    return;
  }

  if (commandKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redoAction();
    else undoAction();
    return;
  }

  if (commandKey && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redoAction();
    return;
  }

  if (!isEditingField && (event.key === 'Delete' || event.key === 'Backspace')) {
    event.preventDefault();
    deleteSelection();
  }
}

function onKeyUp(event: KeyboardEvent) {
  if (event.code === 'Space') {
    isSpacePressed.value = false;
    if (state.mode === 'idle') updateCursor('default');
  }
}

function onCanvasDoubleClick() {
  if (selectedElement.value) focusElementText();
}

function refreshHover(point: Point) {
  const canvas = canvasRef.value;
  const context = canvas?.getContext('2d') ?? undefined;
  const elementControlsHidden = selectedElements.value.length > 1;
  const anchor = elementControlsHidden ? null : hitTestAnchorHandle(point, state.elements, context);
  const element = hitTestElement(point, state.elements, context);
  const resizeHit = elementControlsHidden ? null : hitTestResizeHandleOnElements(point, state.elements, context);
  const resizeHandle = resizeHit?.handle ?? null;
  const connection = hitTestConnection(point, state.connections, state.elements, context);

  state.hoverAnchor = anchor ? { elementId: anchor.elementId, side: anchor.side } : null;
  state.hoverResizeHandle = !anchor ? resizeHandle : null;
  state.hoverConnectionId = !anchor && !resizeHandle ? connection?.id ?? null : null;
  state.hoverElementId = resizeHit?.element.id ?? (!anchor && !connection ? element?.id ?? null : anchor?.elementId ?? null);

  if (isSpacePressed.value) updateCursor('grab');
  else if (anchor) updateCursor('crosshair');
  else if (resizeHandle) updateCursor(cursorForResizeHandle(resizeHandle));
  else if (connection) updateCursor('pointer');
  else if (element) updateCursor('grab');
  else updateCursor('default');
}

function clearHover() {
  clearHoverState(state);
}

function updateCursor(cursor: string) {
  canvasCursor.value = cursor;
}

function cursorForResizeHandle(handle: ResizeHandle) {
  if (handle === 'left' || handle === 'right') return 'ew-resize';
  if (handle === 'top' || handle === 'bottom') return 'ns-resize';
  if (handle === 'top-left' || handle === 'bottom-right') return 'nwse-resize';
  return 'nesw-resize';
}

function focusElementText() {
  nextTick(() => elementTextInputRef.value?.focus());
}

function cloneElement(element: FlowElement): FlowElement {
  return { ...element };
}

watch(
  () => [state.elements, state.connections, state.selection, state.guides, state.previewConnection],
  () => nextTick(draw),
  { deep: true },
);

onMounted(() => {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCanvas);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('mousedown', onMouseDown);
  window.removeEventListener('mouseup', onMouseUp);
});
</script>

<template>
  <main class="app-shell">
    <aside class="toolbar" aria-label="Flow tools">
      <div class="brand">
        <span class="brand-mark">FC</span>
        <div>
          <h1>FlowCanvas</h1>
          <p>v2 editor</p>
        </div>
      </div>

      <button class="primary-action" type="button" @click="addElement">
        <span aria-hidden="true">+</span>
        Add element
      </button>
      <button class="tool-action" type="button" :disabled="history.past.length === 0" @click="undoAction">
        <span aria-hidden="true">↶</span>
        Undo
      </button>
      <button class="tool-action" type="button" :disabled="history.future.length === 0" @click="redoAction">
        <span aria-hidden="true">↷</span>
        Redo
      </button>
      <button class="tool-action danger" type="button" :disabled="selectedCount === 0" @click="deleteSelection">
        <span aria-hidden="true">×</span>
        Delete selected
      </button>
      <div class="export-actions" aria-label="Image export">
        <button class="tool-action" type="button" @click="copyImage">
          Copy image
        </button>
        <button class="tool-action" type="button" @click="downloadImage">
          Download image
        </button>
        <span v-if="exportStatus" class="export-status">{{ exportStatus }}</span>
      </div>
      <button class="tool-action" type="button" @click="resetView">
        <span aria-hidden="true">⌖</span>
        Reset view
      </button>

      <div class="mode-card">
        <span class="mode-label">Mode</span>
        <strong>{{ state.mode === 'idle' ? 'Select, drag, connect' : state.mode }}</strong>
        <span class="mode-label">{{ selectionSummary }}</span>
        <span class="mode-label">{{ Math.round(state.viewport.zoom * 100) }}%</span>
      </div>
    </aside>

    <section ref="stageRef" class="stage">
      <canvas
        ref="canvasRef"
        :style="{ cursor: canvasCursor }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel="onWheel"
        @dblclick="onCanvasDoubleClick"
      />
    </section>

    <aside class="inspector" aria-label="Properties">
      <h2 v-if="!hasMixedSelection">Inspector</h2>

      <form v-if="selectedElement" class="panel-form" @submit.prevent>
        <fieldset>
          <legend>Element</legend>
          <label>
            Text
            <input
              ref="elementTextInputRef"
              :value="selectedElement.text"
              @input="updateElement(selectedElement, 'text', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label>
            Shape
            <select
              :value="selectedElement.shape"
              @change="updateElement(selectedElement, 'shape', ($event.target as HTMLSelectElement).value as FlowElement['shape'])"
            >
              <option value="rect">Rect</option>
              <option value="rounded-rect">Rounded rect</option>
              <option value="ellipse">Ellipse</option>
              <option value="circle">Circle</option>
            </select>
          </label>
          <label>
            Size mode
            <select
              :value="selectedElement.sizeMode"
              @change="updateElementSizeMode(selectedElement, ($event.target as HTMLSelectElement).value as FlowElement['sizeMode'])"
            >
              <option value="fixed">Fixed</option>
              <option value="fit-content">Fit content</option>
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Layout</legend>
          <div class="field-row">
            <label>
              Width
              <input
                type="number"
                min="48"
                :disabled="selectedElement.sizeMode === 'fit-content'"
                :value="Math.round(getElementBox(selectedElement).width)"
                @input="updateElementNumber(selectedElement, 'width', $event.target as HTMLInputElement)"
              />
            </label>
            <label>
              Height
              <input
                type="number"
                min="32"
                :disabled="selectedElement.sizeMode === 'fit-content'"
                :value="Math.round(getElementBox(selectedElement).height)"
                @input="updateElementNumber(selectedElement, 'height', $event.target as HTMLInputElement)"
              />
            </label>
          </div>
          <div class="field-row">
            <label>
              Padding
              <input
                type="number"
                min="0"
                :value="selectedElement.padding"
                @input="updateElementNumber(selectedElement, 'padding', $event.target as HTMLInputElement)"
              />
            </label>
            <label>
              Radius
              <input
                type="number"
                min="0"
                :value="selectedElement.borderRadius"
                @input="updateElementNumber(selectedElement, 'borderRadius', $event.target as HTMLInputElement)"
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Style</legend>
          <label>
            Text align
            <select
              :value="selectedElement.textAlign"
              @change="updateElement(selectedElement, 'textAlign', ($event.target as HTMLSelectElement).value as FlowElement['textAlign'])"
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
          <div class="field-row">
            <label>
              Fill
              <input
                type="color"
                :value="selectedElement.backgroundColor"
                @input="updateElement(selectedElement, 'backgroundColor', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              Border
              <input
                type="color"
                :value="selectedElement.borderColor"
                @input="updateElement(selectedElement, 'borderColor', ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
          <label>
            Border width
            <input
              type="number"
              min="0"
              max="12"
              :value="selectedElement.borderWidth"
              @input="updateElementNumber(selectedElement, 'borderWidth', $event.target as HTMLInputElement)"
            />
          </label>
        </fieldset>
      </form>

      <form v-else-if="selectedConnection" class="panel-form" @submit.prevent>
        <fieldset>
          <legend>Connection</legend>
          <label>
            Text
            <input
              :value="selectedConnection.text"
              @input="updateConnection(selectedConnection, 'text', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label>
            Line type
            <select
              :value="selectedConnection.lineType"
              @change="updateConnection(selectedConnection, 'lineType', ($event.target as HTMLSelectElement).value as Connection['lineType'])"
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
            </select>
          </label>
          <label>
            Line width
            <input
              type="number"
              min="1"
              max="12"
              :value="selectedConnection.lineWidth"
              @input="updateConnectionNumber(selectedConnection, 'lineWidth', $event.target as HTMLInputElement)"
            />
          </label>
          <div class="field-row">
            <label>
              Dash
              <input
                type="number"
                min="1"
                :disabled="selectedConnection.lineType === 'solid'"
                :value="selectedConnection.dashLength"
                @input="updateConnectionNumber(selectedConnection, 'dashLength', $event.target as HTMLInputElement)"
              />
            </label>
            <label>
              Gap
              <input
                type="number"
                min="1"
                :disabled="selectedConnection.lineType === 'solid'"
                :value="selectedConnection.dashGap"
                @input="updateConnectionNumber(selectedConnection, 'dashGap', $event.target as HTMLInputElement)"
              />
            </label>
          </div>
          <label>
            Arrow
            <select
              :value="selectedConnection.arrow"
              @change="updateConnection(selectedConnection, 'arrow', ($event.target as HTMLSelectElement).value as Connection['arrow'])"
            >
              <option value="none">None</option>
              <option value="start">Start</option>
              <option value="end">End</option>
              <option value="both">Both</option>
            </select>
          </label>
          <label>
            Text position
            <select
              :value="selectedConnection.textPosition"
              @change="updateConnection(selectedConnection, 'textPosition', ($event.target as HTMLSelectElement).value as Connection['textPosition'])"
            >
              <option value="above">Above</option>
              <option value="middle">Middle</option>
              <option value="below">Below</option>
            </select>
          </label>
        </fieldset>
      </form>

      <form v-else-if="showBatchElementForm" class="panel-form" @submit.prevent>
        <fieldset>
          <legend>Elements</legend>
          <label>
            Shape
            <select
              :value="batchElementValue('shape')"
              @change="updateSelectedElementChoice('shape', $event.target as HTMLSelectElement)"
            >
              <option value="" disabled></option>
              <option value="rect">Rect</option>
              <option value="rounded-rect">Rounded rect</option>
              <option value="ellipse">Ellipse</option>
              <option value="circle">Circle</option>
            </select>
          </label>
          <label>
            Size mode
            <select
              :value="batchElementValue('sizeMode')"
              @change="updateSelectedElementSizeMode($event.target as HTMLSelectElement)"
            >
              <option value="" disabled></option>
              <option value="fixed">Fixed</option>
              <option value="fit-content">Fit content</option>
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Layout</legend>
          <div class="field-row">
            <label>
              Width
              <input
                type="number"
                min="48"
                :disabled="batchElementValue('sizeMode') === 'fit-content'"
                :value="batchElementValue('width')"
                @input="updateSelectedElementNumber('width', $event.target as HTMLInputElement)"
              />
            </label>
            <label>
              Height
              <input
                type="number"
                min="32"
                :disabled="batchElementValue('sizeMode') === 'fit-content'"
                :value="batchElementValue('height')"
                @input="updateSelectedElementNumber('height', $event.target as HTMLInputElement)"
              />
            </label>
          </div>
          <div class="field-row">
            <label>
              Padding
              <input
                type="number"
                min="0"
                :value="batchElementValue('padding')"
                @input="updateSelectedElementNumber('padding', $event.target as HTMLInputElement)"
              />
            </label>
            <label>
              Radius
              <input
                type="number"
                min="0"
                :value="batchElementValue('borderRadius')"
                @input="updateSelectedElementNumber('borderRadius', $event.target as HTMLInputElement)"
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Style</legend>
          <label>
            Text align
            <select
              :value="batchElementValue('textAlign')"
              @change="updateSelectedElementChoice('textAlign', $event.target as HTMLSelectElement)"
            >
              <option value="" disabled></option>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
          <div class="field-row">
            <label>
              Fill
              <input
                type="text"
                placeholder="#ffffff"
                :value="batchElementValue('backgroundColor')"
                @change="updateSelectedElementColor('backgroundColor', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              Border
              <input
                type="text"
                placeholder="#111111"
                :value="batchElementValue('borderColor')"
                @change="updateSelectedElementColor('borderColor', ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
          <label>
            Border width
            <input
              type="number"
              min="0"
              max="12"
              :value="batchElementValue('borderWidth')"
              @input="updateSelectedElementNumber('borderWidth', $event.target as HTMLInputElement)"
            />
          </label>
        </fieldset>
      </form>

      <form v-else-if="showBatchConnectionForm" class="panel-form" @submit.prevent>
        <fieldset>
          <legend>Connections</legend>
          <label>
            Line type
            <select
              :value="batchConnectionValue('lineType')"
              @change="updateSelectedConnectionChoice('lineType', $event.target as HTMLSelectElement)"
            >
              <option value="" disabled></option>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
            </select>
          </label>
          <label>
            Line width
            <input
              type="number"
              min="1"
              max="12"
              :value="batchConnectionValue('lineWidth')"
              @input="updateSelectedConnectionNumber('lineWidth', $event.target as HTMLInputElement)"
            />
          </label>
          <div class="field-row">
            <label>
              Dash
              <input
                type="number"
                min="1"
                :disabled="batchConnectionValue('lineType') === 'solid'"
                :value="batchConnectionValue('dashLength')"
                @input="updateSelectedConnectionNumber('dashLength', $event.target as HTMLInputElement)"
              />
            </label>
            <label>
              Gap
              <input
                type="number"
                min="1"
                :disabled="batchConnectionValue('lineType') === 'solid'"
                :value="batchConnectionValue('dashGap')"
                @input="updateSelectedConnectionNumber('dashGap', $event.target as HTMLInputElement)"
              />
            </label>
          </div>
          <label>
            Arrow
            <select
              :value="batchConnectionValue('arrow')"
              @change="updateSelectedConnectionChoice('arrow', $event.target as HTMLSelectElement)"
            >
              <option value="" disabled></option>
              <option value="none">None</option>
              <option value="start">Start</option>
              <option value="end">End</option>
              <option value="both">Both</option>
            </select>
          </label>
          <label>
            Text position
            <select
              :value="batchConnectionValue('textPosition')"
              @change="updateSelectedConnectionChoice('textPosition', $event.target as HTMLSelectElement)"
            >
              <option value="" disabled></option>
              <option value="above">Above</option>
              <option value="middle">Middle</option>
              <option value="below">Below</option>
            </select>
          </label>
        </fieldset>
      </form>

      <template v-else-if="hasMixedSelection"></template>

      <div v-else-if="selectedCount > 1" class="empty-state">
        {{ selectedCount }} items selected.
      </div>

      <div v-else class="empty-state">
        Select an element or connection.
      </div>
    </aside>
  </main>
</template>
