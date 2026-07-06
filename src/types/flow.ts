export type ElementShape = 'rect' | 'rounded-rect' | 'ellipse' | 'circle';
export type SizeMode = 'fixed' | 'fit-content';
export type TextAlign = 'left' | 'center' | 'right';
export type LineType = 'solid' | 'dashed';
export type ArrowType = 'none' | 'start' | 'end' | 'both';
export type ConnectionTextPosition = 'above' | 'below' | 'middle';
export type AnchorSide = 'top' | 'right' | 'bottom' | 'left';
export type ConnectionEnd = 'source' | 'target';
export type ResizeHandle =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';
export type EditorMode =
  | 'idle'
  | 'dragging-element'
  | 'resizing-element'
  | 'creating-connection'
  | 'dragging-connection-endpoint'
  | 'panning-canvas'
  | 'editing-text';

export interface FlowElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sizeMode: SizeMode;
  shape: ElementShape;
  text: string;
  padding: number;
  textAlign: TextAlign;
  borderRadius: number;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
}

export interface ConnectionEndpoint {
  elementId: string;
  side: AnchorSide;
}

export interface Anchor {
  elementId: string;
  side: AnchorSide;
  x: number;
  y: number;
  normalVector: Point;
}

export interface Connection {
  id: string;
  source: ConnectionEndpoint;
  target: ConnectionEndpoint;
  sourceElementId?: string;
  targetElementId?: string;
  lineType: LineType;
  lineWidth: number;
  dashLength: number;
  dashGap: number;
  arrow: ArrowType;
  text: string;
  textPosition: ConnectionTextPosition;
}

export type Selection =
  | { type: 'element'; id: string }
  | { type: 'connection'; id: string }
  | { type: 'multi'; items: Array<{ type: 'element' | 'connection'; id: string }> }
  | null;

export interface AlignmentGuide {
  orientation: 'vertical' | 'horizontal';
  position: number;
  from: number;
  to: number;
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export interface EditorState {
  elements: FlowElement[];
  connections: Connection[];
  selection: Selection;
  viewport: ViewportState;
  mode: EditorMode;
  pendingConnectionSource: ConnectionEndpoint | null;
  previewConnection: {
    source: Anchor;
    pointer: Point;
    target: Anchor | null;
    hiddenConnectionId?: string;
  } | null;
  hoverElementId: string | null;
  hoverConnectionId: string | null;
  hoverAnchor: ConnectionEndpoint | null;
  hoverResizeHandle: ResizeHandle | null;
  guides: AlignmentGuide[];
}

export interface Point {
  x: number;
  y: number;
}
