import type { Connection, FlowElement, Selection } from '../types/flow';

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
    connections: snapshot.connections.map((connection) => ({
      ...connection,
      source: { ...connection.source },
      target: { ...connection.target },
    })),
    selection: snapshot.selection ? { ...snapshot.selection } : null,
  };
}

export function deleteSelectionFromFlow(
  elements: FlowElement[],
  connections: Connection[],
  selection: Selection,
): Pick<FlowSnapshot, 'elements' | 'connections' | 'selection'> {
  if (!selection) return { elements, connections, selection };

  if (selection.type === 'element') {
    return {
      elements: elements.filter((element) => element.id !== selection.id),
      connections: connections.filter(
        (connection) =>
          connection.source.elementId !== selection.id &&
          connection.target.elementId !== selection.id &&
          connection.sourceElementId !== selection.id &&
          connection.targetElementId !== selection.id,
      ),
      selection: null,
    };
  }

  return {
    elements,
    connections: connections.filter((connection) => connection.id !== selection.id),
    selection: null,
  };
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
