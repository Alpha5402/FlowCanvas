import type { Anchor, Connection, ConnectionEndpoint, EditorState, FlowElement, Point, Selection, ViewportState } from '../types/flow';

export interface FlowSnapshot {
  elements: FlowElement[];
  connections: Connection[];
  selection: Selection;
}

export interface HistoryState {
  past: FlowSnapshot[];
  future: FlowSnapshot[];
}

export interface FlowDocument {
  version: 1;
  elements: FlowElement[];
  connections: Connection[];
  selection: Selection;
  viewport: ViewportState;
}

const PAN_MOVE_THRESHOLD = 3;

export function isInteractiveControlTag(tagName: string | null | undefined): boolean {
  const normalized = tagName?.toUpperCase();
  return normalized === 'INPUT' || normalized === 'SELECT' || normalized === 'TEXTAREA' || normalized === 'BUTTON';
}

export function cloneSnapshot(snapshot: FlowSnapshot): FlowSnapshot {
  return {
    elements: snapshot.elements.map((element) => ({ ...element })),
    connections: snapshot.connections.map(cloneConnection),
    selection: cloneSelection(snapshot.selection),
  };
}

export function createFlowDocument(snapshot: FlowSnapshot, viewport: ViewportState): FlowDocument {
  return {
    version: 1,
    ...cloneSnapshot(snapshot),
    viewport: { ...viewport },
  };
}

export function parseFlowDocument(value: unknown): FlowDocument | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (!Array.isArray(value.elements) || !Array.isArray(value.connections) || !isViewportState(value.viewport)) return null;
  const elements = value.elements.filter(isFlowElement).map((element) => ({ ...element }));
  const elementIds = new Set(elements.map((element) => element.id));
  const connections = value.connections
    .filter(isConnection)
    .map(cloneConnection)
    .filter((connection) => elementIds.has(connection.source.elementId) && elementIds.has(connection.target.elementId));
  if (elements.length !== value.elements.length || connections.length !== value.connections.length) return null;
  const connectionIds = new Set(connections.map((connection) => connection.id));

  return {
    version: 1,
    elements,
    connections,
    selection: normalizeDocumentSelection(value.selection, elementIds, connectionIds),
    viewport: { ...value.viewport },
  };
}

export function deleteSelectionFromFlow(
  elements: FlowElement[],
  connections: Connection[],
  selection: Selection,
): Pick<FlowSnapshot, 'elements' | 'connections' | 'selection'> {
  if (!selection) return { elements, connections, selection };
  const items = getSelectionItems(selection);
  const elementIds = new Set(items.filter((item) => item.type === 'element').map((item) => item.id));
  const connectionIds = new Set(items.filter((item) => item.type === 'connection').map((item) => item.id));

  return {
    elements: elements.filter((element) => !elementIds.has(element.id)),
    connections: connections.filter(
      (connection) => {
        const source = getConnectionEndpoint(connection, 'source');
        const target = getConnectionEndpoint(connection, 'target');
        return !connectionIds.has(connection.id) && !elementIds.has(source.elementId) && !elementIds.has(target.elementId);
      },
    ),
    selection: null,
  };
}

export function hasFlowContentChanged(
  previous: Pick<FlowSnapshot, 'elements' | 'connections'>,
  next: Pick<FlowSnapshot, 'elements' | 'connections'>,
): boolean {
  if (previous.elements.length !== next.elements.length || previous.connections.length !== next.connections.length) return true;
  return (
    previous.elements.some((element, index) => element.id !== next.elements[index]?.id) ||
    previous.connections.some((connection, index) => connection.id !== next.connections[index]?.id)
  );
}

export function getExportContent(
  elements: FlowElement[],
  connections: Connection[],
  selection: Selection,
): Pick<FlowSnapshot, 'elements' | 'connections'> {
  const selectionItems = getSelectionItems(selection);
  const requestedElementIds = new Set(selectionItems.filter((item) => item.type === 'element').map((item) => item.id));
  const requestedConnectionIds = new Set(selectionItems.filter((item) => item.type === 'connection').map((item) => item.id));
  const selectedElementIds = new Set(elements.filter((element) => requestedElementIds.has(element.id)).map((element) => element.id));
  const selectedConnectionIds = new Set(connections.filter((connection) => requestedConnectionIds.has(connection.id)).map((connection) => connection.id));
  const hasSelection = selectedElementIds.size > 0 || selectedConnectionIds.size > 0;

  const exportConnections = hasSelection
    ? connections.filter(
        (connection) => {
          const source = getConnectionEndpoint(connection, 'source');
          const target = getConnectionEndpoint(connection, 'target');
          return selectedConnectionIds.has(connection.id) || (selectedElementIds.has(source.elementId) && selectedElementIds.has(target.elementId));
        },
      )
    : connections;

  const requiredElementIds = new Set(selectedElementIds);
  for (const connection of exportConnections) {
    requiredElementIds.add(getConnectionEndpoint(connection, 'source').elementId);
    requiredElementIds.add(getConnectionEndpoint(connection, 'target').elementId);
  }

  const exportElements = hasSelection ? elements.filter((element) => requiredElementIds.has(element.id)) : elements;

  return { elements: exportElements, connections: exportConnections };
}

export function getConnectionEndpoint(connection: Connection, end: 'source' | 'target'): ConnectionEndpoint {
  const endpoint = connection[end] as ConnectionEndpoint | undefined;
  if (endpoint) return endpoint;
  return {
    elementId: end === 'source' ? connection.sourceElementId ?? '' : connection.targetElementId ?? '',
    side: end === 'source' ? 'right' : 'left',
  };
}

export function getSelectionItems(selection: Selection): Array<{ type: 'element' | 'connection'; id: string }> {
  if (!selection) return [];
  if (selection.type === 'multi') return selection.items;
  return [selection];
}

export function cloneConnection(connection: Connection): Connection {
  return {
    ...connection,
    pathType: normalizeConnectionPathType(connection.pathType),
    source: { ...getConnectionEndpoint(connection, 'source') },
    target: { ...getConnectionEndpoint(connection, 'target') },
  };
}

export function normalizeConnectionPathType(value: unknown): Connection['pathType'] {
  return value === 'orthogonal' ? 'orthogonal' : 'curve';
}

export function cloneSelection(selection: Selection): Selection {
  if (!selection) return null;
  if (selection.type === 'multi') {
    return { type: 'multi', items: selection.items.map((item) => ({ ...item })) };
  }
  return { ...selection };
}

export function isSelected(selection: Selection, type: 'element' | 'connection', id: string): boolean {
  return getSelectionItems(selection).some((item) => item.type === type && item.id === id);
}

export function shouldHideElementControls(selection: Selection): boolean {
  return getSelectionItems(selection).length > 1;
}

export function resolvePreviewTarget(currentTarget: Anchor | null, previewTarget: Anchor | null): Anchor | null {
  return currentTarget ?? previewTarget;
}

export function getSharedValue<T extends Record<string, unknown>, K extends keyof T>(items: T[], key: K): T[K] | '' {
  if (items.length === 0) return '';
  const first = items[0][key];
  return items.every((item) => Object.is(item[key], first)) ? first : '';
}

export function canEditElementDimensions(elements: FlowElement[]): boolean {
  return elements.length > 0 && elements.every((element) => element.sizeMode === 'fixed');
}

export function canEditConnectionDashPattern(connections: Connection[]): boolean {
  return connections.length > 0 && connections.every((connection) => connection.lineType === 'dashed');
}

export function normalizeElementNumber(key: keyof FlowElement, value: number): number {
  if (key === 'width') return Math.max(48, value);
  if (key === 'height') return Math.max(32, value);
  if (key === 'padding' || key === 'borderRadius') return Math.max(0, value);
  if (key === 'borderWidth') return clamp(value, 0, 12);
  return value;
}

export function normalizeConnectionNumber(key: keyof Connection, value: number): number {
  if (key === 'lineWidth') return clamp(value, 1, 12);
  if (key === 'dashLength' || key === 'dashGap') return Math.max(1, value);
  return value;
}

export function normalizeHexColorInput(value: string): string | null {
  const trimmed = value.trim();
  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex.split('').map((character) => `${character}${character}`).join('')}`;
  }
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : null;
}

export function normalizeFillColorInput(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'transparent' || trimmed === 'none') return 'transparent';
  return normalizeHexColorInput(value);
}

export function toggleSelection(
  selection: Selection,
  item: { type: 'element' | 'connection'; id: string },
): Selection {
  const items = getSelectionItems(selection);
  const exists = items.some((entry) => entry.type === item.type && entry.id === item.id);
  const next = exists
    ? items.filter((entry) => !(entry.type === item.type && entry.id === item.id))
    : [...items, item];
  if (next.length === 0) return null;
  if (next.length === 1) return { ...next[0] };
  return { type: 'multi', items: next };
}

export function selectAllItems(elements: FlowElement[], connections: Connection[]): Selection {
  const items = [
    ...elements.map((element) => ({ type: 'element' as const, id: element.id })),
    ...connections.map((connection) => ({ type: 'connection' as const, id: connection.id })),
  ];
  if (items.length === 0) return null;
  if (items.length === 1) return { ...items[0] };
  return { type: 'multi', items };
}

export function applyElementSizeMode(
  element: FlowElement,
  sizeMode: FlowElement['sizeMode'],
  measuredSize?: Pick<FlowElement, 'width' | 'height'>,
): boolean {
  if (element.sizeMode === sizeMode) return false;
  if (sizeMode === 'fixed' && measuredSize) {
    element.width = measuredSize.width;
    element.height = measuredSize.height;
  }
  element.sizeMode = sizeMode;
  return true;
}

export function createFixedResizeBase(
  element: FlowElement,
  measuredSize?: Pick<FlowElement, 'width' | 'height'>,
): FlowElement {
  const base = { ...element };
  applyElementSizeMode(base, 'fixed', measuredSize);
  return base;
}

export function restoreElementPositions(
  elements: FlowElement[],
  originals: Array<Pick<FlowElement, 'id' | 'x' | 'y'>>,
) {
  for (const original of originals) {
    const element = elements.find((item) => item.id === original.id);
    if (!element) continue;
    element.x = original.x;
    element.y = original.y;
  }
}

export function hasElementPositionChanges(
  elements: FlowElement[],
  originals: Array<Pick<FlowElement, 'id' | 'x' | 'y'>>,
): boolean {
  return originals.some((original) => {
    const element = elements.find((item) => item.id === original.id);
    return Boolean(element && (element.x !== original.x || element.y !== original.y));
  });
}

export function hasElementGeometryChanged(element: FlowElement, original: FlowElement): boolean {
  return (
    element.x !== original.x ||
    element.y !== original.y ||
    element.width !== original.width ||
    element.height !== original.height ||
    element.sizeMode !== original.sizeMode
  );
}

export function hasSignificantPanMovement(start: Point, end: Point): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) > PAN_MOVE_THRESHOLD;
}

export function clearHoverState(
  state: Pick<EditorState, 'hoverElementId' | 'hoverConnectionId' | 'hoverAnchor' | 'hoverResizeHandle'>,
) {
  state.hoverElementId = null;
  state.hoverConnectionId = null;
  state.hoverAnchor = null;
  state.hoverResizeHandle = null;
}

export function pushHistory(history: HistoryState, snapshot: FlowSnapshot) {
  history.past.push(cloneSnapshot(snapshot));
  history.future = [];
}

export function undo(history: HistoryState, current: FlowSnapshot): FlowSnapshot | null {
  const previous = history.past.pop();
  if (!previous) return null;
  history.future.push(cloneSnapshot(current));
  return cloneSnapshot(previous);
}

export function redo(history: HistoryState, current: FlowSnapshot): FlowSnapshot | null {
  const next = history.future.pop();
  if (!next) return null;
  history.past.push(cloneSnapshot(current));
  return cloneSnapshot(next);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isViewportState(value: unknown): value is ViewportState {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.zoom)
  );
}

function isConnectionEndpoint(value: unknown): value is ConnectionEndpoint {
  return (
    isRecord(value) &&
    typeof value.elementId === 'string' &&
    (value.side === 'top' || value.side === 'right' || value.side === 'bottom' || value.side === 'left')
  );
}

function isFlowElement(value: unknown): value is FlowElement {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    (value.sizeMode === 'fixed' || value.sizeMode === 'fit-content') &&
    (value.shape === 'rect' || value.shape === 'rounded-rect' || value.shape === 'ellipse' || value.shape === 'circle') &&
    typeof value.text === 'string' &&
    isFiniteNumber(value.padding) &&
    (value.textAlign === 'left' || value.textAlign === 'center' || value.textAlign === 'right') &&
    isFiniteNumber(value.borderRadius) &&
    typeof value.backgroundColor === 'string' &&
    typeof value.borderColor === 'string' &&
    isFiniteNumber(value.borderWidth)
  );
}

function isConnection(value: unknown): value is Connection {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isConnectionEndpoint(value.source) &&
    isConnectionEndpoint(value.target) &&
    (value.pathType === undefined || value.pathType === 'curve' || value.pathType === 'orthogonal') &&
    (value.lineType === 'solid' || value.lineType === 'dashed') &&
    isFiniteNumber(value.lineWidth) &&
    isFiniteNumber(value.dashLength) &&
    isFiniteNumber(value.dashGap) &&
    (value.arrow === 'none' || value.arrow === 'start' || value.arrow === 'end' || value.arrow === 'both') &&
    typeof value.text === 'string' &&
    (value.textPosition === 'above' || value.textPosition === 'below' || value.textPosition === 'middle')
  );
}

function normalizeDocumentSelection(
  selection: unknown,
  elementIds: Set<string>,
  connectionIds: Set<string>,
): Selection {
  if (!isRecord(selection)) return null;
  if (selection.type === 'element' && typeof selection.id === 'string' && elementIds.has(selection.id)) {
    return { type: 'element', id: selection.id };
  }
  if (selection.type === 'connection' && typeof selection.id === 'string' && connectionIds.has(selection.id)) {
    return { type: 'connection', id: selection.id };
  }
  if (selection.type !== 'multi' || !Array.isArray(selection.items)) return null;
  const items = selection.items.filter((item): item is { type: 'element' | 'connection'; id: string } => {
    if (!isRecord(item) || typeof item.id !== 'string') return false;
    if (item.type === 'element') return elementIds.has(item.id);
    if (item.type === 'connection') return connectionIds.has(item.id);
    return false;
  });
  if (items.length === 0) return null;
  if (items.length === 1) return { ...items[0] };
  return { type: 'multi', items: items.map((item) => ({ ...item })) };
}
