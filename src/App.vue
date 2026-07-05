<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { createConnection, createElement } from './flow/defaults';
import {
  findAnchor,
  getElementBox,
  inferTargetSide,
  resizeElementBox,
  snapElement,
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
import { deleteSelectionFromFlow, pushHistory, redo, undo, type FlowSnapshot, type HistoryState } from './flow/state';
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

const selectedElement = computed(() =>
  state.selection?.type === 'element' ? state.elements.find((element) => element.id === state.selection?.id) ?? null : null,
);
const selectedConnection = computed(() =>
  state.selection?.type === 'connection'
    ? state.connections.find((connection) => connection.id === state.selection?.id) ?? null
    : null,
);

const drag = ref<{
  id: string;
  offsetX: number;
  offsetY: number;
  startSnapshot: FlowSnapshot;
  moved: boolean;
} | null>(null);

const resize = ref<{
  id: string;
  handle: ResizeHandle;
  startPoint: Point;
  original: FlowElement;
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

function snapshot(): FlowSnapshot {
  return {
    elements: state.elements.map(cloneElement),
    connections: state.connections.map(cloneConnection),
    selection: cloneSelection(state.selection),
  };
}

function applySnapshot(next: FlowSnapshot) {
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
  pushHistory(history, snapshot());
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
  const next = createElement(Math.max(80, (rect?.width ?? 900) / 2 - 75), Math.max(70, (rect?.height ?? 600) / 2 - 36));
  state.elements.push(next);
  state.selection = { type: 'element', id: next.id };
  state.mode = 'idle';
  nextTick(() => {
    draw();
    focusElementText();
  });
}

function onPointerDown(event: PointerEvent) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const screenPoint = canvasPoint(event);
  const point = screenToWorld(screenPoint);
  const context = canvas.getContext('2d') ?? undefined;

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

  const anchor = hitTestAnchorHandle(point, state.elements, context);
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
  const resizeHit = hitTestResizeHandleOnElements(point, state.elements, context);
  const resizeTarget = resizeHit?.element ?? element ?? selected;
  const resizeHandle = resizeHit?.handle ?? hitTestResizeHandle(point, resizeTarget, context);
  if (resizeTarget && resizeHandle) {
    state.selection = { type: 'element', id: resizeTarget.id };
    if (resizeTarget.sizeMode === 'fit-content') resizeTarget.sizeMode = 'fixed';
    resize.value = {
      id: resizeTarget.id,
      handle: resizeHandle,
      startPoint: point,
      original: cloneElement(resizeTarget),
      startSnapshot: snapshot(),
      moved: false,
    };
    state.mode = 'resizing-element';
    canvas.setPointerCapture(event.pointerId);
    updateCursor(cursorForResizeHandle(resizeHandle));
    return;
  }

  const connection = hitTestConnection(point, state.connections, state.elements, context);
  if (connection) {
    state.selection = { type: 'connection', id: connection.id };
    state.mode = 'idle';
    draw();
    return;
  }

  if (element) {
    const box = getElementBox(element, context);
    state.selection = { type: 'element', id: element.id };
    drag.value = {
      id: element.id,
      offsetX: point.x - box.x,
      offsetY: point.y - box.y,
      startSnapshot: snapshot(),
      moved: false,
    };
    state.mode = 'dragging-element';
    canvas.setPointerCapture(event.pointerId);
    updateCursor('grabbing');
    draw();
    return;
  }

  state.selection = null;
  state.mode = 'panning-canvas';
  pan.value = {
    startPoint: screenPoint,
    startViewport: { ...state.viewport },
    moved: false,
    preserveSelection: false,
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
    state.previewConnection.pointer = point;
    const target = hitTestElementAnchorOrEdge(point, state.elements, state.pendingConnectionSource?.elementId, context);
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
    const next = resizeElementBox(resize.value.original, resize.value.handle, deltaX, deltaY);
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
    const moving = state.elements.find((element) => element.id === drag.value?.id);
    if (!moving) return;
    const snapped = snapElement(moving, state.elements, point.x - drag.value.offsetX, point.y - drag.value.offsetY, context);
    moving.x = snapped.x;
    moving.y = snapped.y;
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

function completeConnectionCreation(point: Point, context?: CanvasRenderingContext2D) {
  if (!state.pendingConnectionSource) return;
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
      const next = createElement(point.x, point.y);
      next.text = 'New Node';
  const box = getElementBox(next, context);
  const anchor = findAnchor([next], { elementId: next.id, side: targetSide }, context);
  next.x += point.x - (anchor?.x ?? box.x);
  next.y += point.y - (anchor?.y ?? box.y);
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
  state.hoverAnchor = null;
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
  recordHistory();
  element[key] = value;
  draw();
}

function updateConnection<K extends keyof Connection>(connection: Connection, key: K, value: Connection[K]) {
  recordHistory();
  connection[key] = value;
  draw();
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
  const anchor = hitTestAnchorHandle(point, state.elements, context);
  const element = hitTestElement(point, state.elements, context);
  const resizeHit = hitTestResizeHandleOnElements(point, state.elements, context);
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
  state.hoverElementId = null;
  state.hoverConnectionId = null;
  state.hoverAnchor = null;
  state.hoverResizeHandle = null;
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

function cloneConnection(connection: Connection): Connection {
  return {
    ...connection,
    source: { ...connection.source },
    target: { ...connection.target },
  };
}

function cloneSelection(selection: FlowSnapshot['selection']) {
  return selection ? { ...selection } : null;
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
      <button class="tool-action danger" type="button" :disabled="!state.selection" @click="deleteSelection">
        <span aria-hidden="true">×</span>
        Delete selected
      </button>
      <button class="tool-action" type="button" @click="resetView">
        <span aria-hidden="true">⌖</span>
        Reset view
      </button>

      <div class="mode-card">
        <span class="mode-label">Mode</span>
        <strong>{{ state.mode === 'idle' ? 'Select, drag, connect' : state.mode }}</strong>
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
      <h2>Inspector</h2>

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
              @change="updateElement(selectedElement, 'sizeMode', ($event.target as HTMLSelectElement).value as FlowElement['sizeMode'])"
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
                @input="updateElement(selectedElement, 'width', Number(($event.target as HTMLInputElement).value))"
              />
            </label>
            <label>
              Height
              <input
                type="number"
                min="32"
                :disabled="selectedElement.sizeMode === 'fit-content'"
                :value="Math.round(getElementBox(selectedElement).height)"
                @input="updateElement(selectedElement, 'height', Number(($event.target as HTMLInputElement).value))"
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
                @input="updateElement(selectedElement, 'padding', Number(($event.target as HTMLInputElement).value))"
              />
            </label>
            <label>
              Radius
              <input
                type="number"
                min="0"
                :value="selectedElement.borderRadius"
                @input="updateElement(selectedElement, 'borderRadius', Number(($event.target as HTMLInputElement).value))"
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
              @input="updateElement(selectedElement, 'borderWidth', Number(($event.target as HTMLInputElement).value))"
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
              @input="updateConnection(selectedConnection, 'lineWidth', Number(($event.target as HTMLInputElement).value))"
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
                @input="updateConnection(selectedConnection, 'dashLength', Number(($event.target as HTMLInputElement).value))"
              />
            </label>
            <label>
              Gap
              <input
                type="number"
                min="1"
                :disabled="selectedConnection.lineType === 'solid'"
                :value="selectedConnection.dashGap"
                @input="updateConnection(selectedConnection, 'dashGap', Number(($event.target as HTMLInputElement).value))"
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

      <div v-else class="empty-state">
        Select an element or connection.
      </div>
    </aside>
  </main>
</template>
