<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { createConnection, createElement } from './flow/defaults';
import { getElementBox, snapElement } from './flow/geometry';
import { hitTestConnection, hitTestElement } from './flow/hitTesting';
import { renderFlow } from './flow/render';
import type { Connection, EditorState, FlowElement, Point } from './types/flow';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const stageRef = ref<HTMLElement | null>(null);

const state = reactive<EditorState>({
  elements: [
    {
      ...createElement(190, 170),
      text: 'Start',
      backgroundColor: '#ecfdf5',
      borderColor: '#10b981',
    },
    {
      ...createElement(490, 280),
      text: 'Review',
      shape: 'rect',
      backgroundColor: '#fff7ed',
      borderColor: '#f97316',
    },
  ],
  connections: [],
  selection: null,
  mode: 'select',
  pendingConnectionSourceId: null,
  guides: [],
});

state.connections.push(createConnection(state.elements[0].id, state.elements[1].id));

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
} | null>(null);
const canvasCursor = ref('default');

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  renderFlow(context, canvas, state.elements, state.connections, state.selection, state.guides);
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

function addElement() {
  const stage = stageRef.value;
  const rect = stage?.getBoundingClientRect();
  const next = createElement(Math.max(80, (rect?.width ?? 900) / 2 - 75), Math.max(70, (rect?.height ?? 600) / 2 - 36));
  state.elements.push(next);
  state.selection = { type: 'element', id: next.id };
  state.mode = 'select';
  state.pendingConnectionSourceId = null;
  nextTick(draw);
}

function startConnectionMode() {
  if (state.selection?.type !== 'element') return;
  state.mode = 'connect';
  state.pendingConnectionSourceId = state.selection.id;
  draw();
}

function onPointerDown(event: PointerEvent) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const point = canvasPoint(event);
  const context = canvas.getContext('2d') ?? undefined;
  const element = hitTestElement(point, state.elements, context);

  if (state.mode === 'connect') {
    handleConnectionClick(element);
    return;
  }

  if (element) {
    const box = getElementBox(element, context);
    state.selection = { type: 'element', id: element.id };
    drag.value = {
      id: element.id,
      offsetX: point.x - box.x,
      offsetY: point.y - box.y,
    };
    canvas.setPointerCapture(event.pointerId);
    draw();
    return;
  }

  const connection = hitTestConnection(point, state.connections, state.elements, context);
  state.selection = connection ? { type: 'connection', id: connection.id } : null;
  draw();
}

function onPointerMove(event: PointerEvent) {
  const canvas = canvasRef.value;
  const context = canvas?.getContext('2d') ?? undefined;
  const point = canvasPoint(event);

  if (!drag.value) {
    const hoveredElement = hitTestElement(point, state.elements, context);
    canvasCursor.value = hoveredElement ? 'pointer' : 'default';
    return;
  }

  const moving = state.elements.find((element) => element.id === drag.value?.id);
  if (!moving) return;
  canvasCursor.value = 'grabbing';
  const snapped = snapElement(moving, state.elements, point.x - drag.value.offsetX, point.y - drag.value.offsetY, context);
  moving.x = snapped.x;
  moving.y = snapped.y;
  state.guides = snapped.guides;
  draw();
}

function onPointerUp(event: PointerEvent) {
  if (drag.value) {
    canvasRef.value?.releasePointerCapture(event.pointerId);
  }
  drag.value = null;
  state.guides = [];
  canvasCursor.value = 'default';
  draw();
}

function handleConnectionClick(element: FlowElement | null) {
  if (!element || !state.pendingConnectionSourceId || element.id === state.pendingConnectionSourceId) {
    state.mode = 'select';
    state.pendingConnectionSourceId = null;
    draw();
    return;
  }

  const connection = createConnection(state.pendingConnectionSourceId, element.id);
  state.connections.push(connection);
  state.selection = { type: 'connection', id: connection.id };
  state.mode = 'select';
  state.pendingConnectionSourceId = null;
  draw();
}

function deleteSelection() {
  if (!state.selection) return;
  if (state.selection.type === 'element') {
    const id = state.selection.id;
    state.elements = state.elements.filter((element) => element.id !== id);
    state.connections = state.connections.filter(
      (connection) => connection.sourceElementId !== id && connection.targetElementId !== id,
    );
  } else {
    state.connections = state.connections.filter((connection) => connection.id !== state.selection?.id);
  }
  state.selection = null;
  draw();
}

function updateElement<K extends keyof FlowElement>(element: FlowElement, key: K, value: FlowElement[K]) {
  element[key] = value;
  draw();
}

function updateConnection<K extends keyof Connection>(connection: Connection, key: K, value: Connection[K]) {
  connection[key] = value;
  draw();
}

watch(
  () => [state.elements, state.connections, state.selection, state.guides],
  () => nextTick(draw),
  { deep: true },
);

onMounted(() => {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCanvas);
});
</script>

<template>
  <main class="app-shell">
    <aside class="toolbar" aria-label="Flow tools">
      <div class="brand">
        <span class="brand-mark">FC</span>
        <div>
          <h1>FlowCanvas</h1>
          <p>MVP editor</p>
        </div>
      </div>

      <button class="primary-action" type="button" @click="addElement">
        <span aria-hidden="true">+</span>
        Add element
      </button>
      <button
        class="tool-action"
        type="button"
        :disabled="state.selection?.type !== 'element'"
        :class="{ active: state.mode === 'connect' }"
        @click="startConnectionMode"
      >
        <span aria-hidden="true">↗</span>
        Create connection
      </button>
      <button class="tool-action danger" type="button" :disabled="!state.selection" @click="deleteSelection">
        <span aria-hidden="true">×</span>
        Delete selected
      </button>

      <div class="mode-card">
        <span class="mode-label">Mode</span>
        <strong>{{ state.mode === 'connect' ? 'Pick target element' : 'Select and drag' }}</strong>
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
      />
    </section>

    <aside class="inspector" aria-label="Properties">
      <h2>Inspector</h2>

      <form v-if="selectedElement" class="panel-form" @submit.prevent>
        <label>
          Text
          <input
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
        <div class="field-row">
          <label>
            Width
            <input
              type="number"
              min="40"
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
      </form>

      <form v-else-if="selectedConnection" class="panel-form" @submit.prevent>
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
      </form>

      <div v-else class="empty-state">
        Select an element or connection.
      </div>
    </aside>
  </main>
</template>
