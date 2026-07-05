export type ElementShape = 'rect' | 'rounded-rect' | 'ellipse' | 'circle';
export type SizeMode = 'fixed' | 'fit-content';
export type TextAlign = 'left' | 'center' | 'right';
export type LineType = 'solid' | 'dashed';
export type ArrowType = 'none' | 'start' | 'end' | 'both';
export type ConnectionTextPosition = 'above' | 'below' | 'middle';

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

export interface Connection {
  id: string;
  sourceElementId: string;
  targetElementId: string;
  lineType: LineType;
  dashLength: number;
  dashGap: number;
  arrow: ArrowType;
  text: string;
  textPosition: ConnectionTextPosition;
}

export type Selection =
  | { type: 'element'; id: string }
  | { type: 'connection'; id: string }
  | null;

export interface AlignmentGuide {
  orientation: 'vertical' | 'horizontal';
  position: number;
  from: number;
  to: number;
}

export interface EditorState {
  elements: FlowElement[];
  connections: Connection[];
  selection: Selection;
  mode: 'select' | 'connect';
  pendingConnectionSourceId: string | null;
  guides: AlignmentGuide[];
}

export interface Point {
  x: number;
  y: number;
}
