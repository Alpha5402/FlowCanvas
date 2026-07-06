import type { Connection, ConnectionEndpoint, EditorState, FlowElement, Selection } from '../types/flow';

export interface FlowSnapshot {
  elements: FlowElement[];
  connections: Connection[];
  selection: Selection;
}

export interface HistoryState {
  past: FlowSnapshot[];
  future: FlowSnapshot[];
}

export function cloneSnapshot(snapshot: FlowSnapshot): FlowSnapshot {
  return {
    elements: snapshot.elements.map((element) => ({ ...element })),
    connections: snapshot.connections.map(cloneConnection),
    selection: cloneSelection(snapshot.selection),
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

export function getExportContent(
  elements: FlowElement[],
  connections: Connection[],
  selection: Selection,
): Pick<FlowSnapshot, 'elements' | 'connections'> {
  const selectionItems = getSelectionItems(selection);
  const selectedElementIds = new Set(selectionItems.filter((item) => item.type === 'element').map((item) => item.id));
  const selectedConnectionIds = new Set(selectionItems.filter((item) => item.type === 'connection').map((item) => item.id));
  const hasSelection = selectionItems.length > 0;

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
    source: { ...getConnectionEndpoint(connection, 'source') },
    target: { ...getConnectionEndpoint(connection, 'target') },
  };
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

export function getSharedValue<T extends Record<string, unknown>, K extends keyof T>(items: T[], key: K): T[K] | '' {
  if (items.length === 0) return '';
  const first = items[0][key];
  return items.every((item) => Object.is(item[key], first)) ? first : '';
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
