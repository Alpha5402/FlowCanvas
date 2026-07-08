import type {
  AlignmentGuide,
  Anchor,
  Connection,
  ConnectionEndpoint,
  FlowElement,
  ResizeHandle,
  Selection,
  ViewportState,
} from '../types/flow';
import { isSelected, shouldHideElementControls } from './state';
import {
  createConnectionPath,
  createPreviewPath,
  getAnchorHandlePoint,
  getArrowAngle,
  getConnectionLabelBox,
  getConnectionPath,
  getElementAnchors,
  getElementBox,
  getResizeHandles,
  layoutElementText,
  type ConnectionPath,
  type Measurer,
} from './geometry';

const FONT = '14px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export interface RenderOptions {
  hoverElementId: string | null;
  hoverConnectionId: string | null;
  hoverAnchor: ConnectionEndpoint | null;
  hoverResizeHandle: ResizeHandle | null;
  previewConnection: { source: Anchor; pointer: { x: number; y: number }; target: Anchor | null; hiddenConnectionId?: string } | null;
  showGrid?: boolean;
  pixelRatio?: number;
}

export function renderFlow(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  elements: FlowElement[],
  connections: Connection[],
  selection: Selection,
  guides: AlignmentGuide[],
  viewport: ViewportState,
  options: RenderOptions,
) {
  const pixelRatio = getRenderPixelRatio(options);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.scale(pixelRatio, pixelRatio);
  drawBackground(context, canvas, viewport, options.showGrid ?? true, pixelRatio);
  context.translate(viewport.x, viewport.y);
  context.scale(viewport.zoom, viewport.zoom);
  const measurer: Measurer = context;
  const elementControlsHidden = shouldHideElementControls(selection);
  const labelBackgroundColor = getConnectionTextBackground(options.showGrid ?? true);

  connections.forEach((connection) => {
    if (!shouldRenderConnection(connection, options.previewConnection)) return;
    const selected = isSelected(selection, 'connection', connection.id);
    const hovered = options.hoverConnectionId === connection.id;
    drawConnection(context, connection, elements, selected, hovered, measurer, labelBackgroundColor);
  });

  if (options.previewConnection) {
    drawPreviewConnection(context, options.previewConnection.source, options.previewConnection.pointer, options.previewConnection.target);
  }

  elements.forEach((element) => {
    const selected = isSelected(selection, 'element', element.id);
    const hovered = options.hoverElementId === element.id;
    drawElement(context, element, selected, hovered, measurer);
  });

  elements.forEach((element) => {
    const selected = isSelected(selection, 'element', element.id);
    const hovered = options.hoverElementId === element.id;
    if (!elementControlsHidden && (selected || hovered) && element.sizeMode === 'fixed') {
      drawResizeHandles(context, element, options.hoverResizeHandle, measurer);
    }
    if (!elementControlsHidden && (selected || hovered)) {
      drawAnchorHandles(context, element, options.hoverAnchor, measurer);
    }
  });

  drawGuides(context, guides);
  context.restore();
}

function drawBackground(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  viewport: ViewportState,
  showGrid: boolean,
  pixelRatio: number,
) {
  const width = canvas.width / pixelRatio;
  const height = canvas.height / pixelRatio;
  context.fillStyle = showGrid ? '#f5f7fb' : '#ffffff';
  context.fillRect(0, 0, width, height);
  if (!showGrid) return;
  context.strokeStyle = '#e2e8f0';
  context.lineWidth = 1;
  const gridSize = 24 * viewport.zoom;
  const startX = ((viewport.x % gridSize) + gridSize) % gridSize;
  const startY = ((viewport.y % gridSize) + gridSize) % gridSize;

  for (let x = startX; x < width; x += gridSize) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  for (let y = startY; y < height; y += gridSize) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

export function getRenderPixelRatio(options: Pick<RenderOptions, 'pixelRatio'>): number {
  return Math.max(1, options.pixelRatio ?? window.devicePixelRatio ?? 1);
}

export function shouldRenderConnection(
  connection: Pick<Connection, 'id'>,
  previewConnection: Pick<NonNullable<RenderOptions['previewConnection']>, 'hiddenConnectionId'> | null,
): boolean {
  return previewConnection?.hiddenConnectionId !== connection.id;
}

function drawElement(context: CanvasRenderingContext2D, element: FlowElement, selected: boolean, hovered: boolean, measurer: Measurer) {
  const box = getElementBox(element, measurer);
  context.save();
  const strokeWidth = getElementStrokeWidth(element, selected, hovered);
  context.strokeStyle = selected ? '#ef4444' : hovered ? '#2563eb' : element.borderColor;
  context.lineWidth = strokeWidth;
  context.setLineDash([]);
  createElementPath(context, element, box);
  if (shouldFillElement(element.backgroundColor)) {
    context.fillStyle = element.backgroundColor;
    context.fill();
  }
  if (strokeWidth > 0) context.stroke();

  context.font = FONT;
  context.fillStyle = '#111827';
  context.textBaseline = 'middle';
  context.textAlign = element.textAlign;
  const maxTextWidth = getElementTextMaxWidth(element, box.width);
  const textLayout = layoutElementText(element.text, maxTextWidth, measurer);
  const firstLineY = box.y + box.height / 2 - textLayout.height / 2 + textLayout.lineHeight / 2;
  const textX =
    element.textAlign === 'left'
      ? box.x + element.padding
      : element.textAlign === 'right'
        ? box.x + box.width - element.padding
        : box.x + box.width / 2;
  for (const [index, line] of textLayout.lines.entries()) {
    context.fillText(line, textX, firstLineY + index * textLayout.lineHeight);
  }

  context.restore();
}

export function getElementStrokeWidth(element: Pick<FlowElement, 'borderWidth'>, selected: boolean, hovered: boolean): number {
  const emphasisWidth = selected ? 2 : hovered ? 1.5 : 0;
  if (emphasisWidth > 0) return Math.max(1, element.borderWidth + emphasisWidth);
  return Math.max(0, element.borderWidth);
}

export function shouldFillElement(backgroundColor: string): boolean {
  return backgroundColor.trim().toLowerCase() !== 'transparent';
}

export function getElementTextMaxWidth(
  element: Pick<FlowElement, 'sizeMode' | 'padding'>,
  boxWidth: number,
): number | undefined {
  if (element.sizeMode === 'fit-content') return undefined;
  return Math.max(12, boxWidth - element.padding * 2);
}

function drawConnection(
  context: CanvasRenderingContext2D,
  connection: Connection,
  elements: FlowElement[],
  selected: boolean,
  hovered: boolean,
  measurer: Measurer,
  labelBackgroundColor: string,
) {
  const path = getConnectionPath(connection, elements, measurer);
  if (!path) return;

  context.save();
  context.strokeStyle = selected ? '#ef4444' : hovered ? '#2563eb' : '#475569';
  context.fillStyle = selected ? '#ef4444' : hovered ? '#2563eb' : '#475569';
  context.lineWidth = getConnectionStrokeWidth(connection, selected, hovered);
  context.setLineDash(connection.lineType === 'dashed' ? [connection.dashLength, connection.dashGap] : []);
  drawConnectionPath(context, path);

  context.setLineDash([]);
  if (connection.arrow === 'start' || connection.arrow === 'both') {
    drawArrow(context, path.sourceAnchor.x, path.sourceAnchor.y, getArrowAngle(path, 'start'));
  }
  if (connection.arrow === 'end' || connection.arrow === 'both') {
    drawArrow(context, path.targetAnchor.x, path.targetAnchor.y, getArrowAngle(path, 'end'));
  }
  drawConnectionText(context, connection, path, labelBackgroundColor);
  context.restore();
}

export function getConnectionStrokeWidth(connection: Pick<Connection, 'lineWidth'>, selected: boolean, hovered: boolean): number {
  return Math.max(1, connection.lineWidth ?? 1) + (selected || hovered ? 1.5 : 0);
}

function drawPreviewConnection(
  context: CanvasRenderingContext2D,
  source: Anchor,
  pointer: { x: number; y: number },
  target: Anchor | null,
) {
  const path = target ? createConnectionPath(source, target) : createPreviewPath(source, pointer);
  context.save();
  context.strokeStyle = '#aab2c0';
  context.fillStyle = '#aab2c0';
  context.lineWidth = 1.5;
  context.setLineDash([8, 8]);
  drawConnectionPath(context, path);
  context.setLineDash([]);
  drawArrow(context, path.targetAnchor.x, path.targetAnchor.y, getArrowAngle(path, 'end'));
  context.restore();
}

function drawConnectionPath(context: CanvasRenderingContext2D, path: ConnectionPath) {
  context.beginPath();
  const [firstPoint, ...points] = path.samplePoints;
  context.moveTo(firstPoint.x, firstPoint.y);
  for (const point of points) {
    context.lineTo(point.x, point.y);
  }
  context.stroke();
}

export function getConnectionTextBackground(showGrid: boolean): string {
  return showGrid ? '#f5f7fb' : '#ffffff';
}

export function shouldDrawConnectionTextGap(position: Connection['textPosition']): boolean {
  return position === 'middle';
}

function drawConnectionText(context: CanvasRenderingContext2D, connection: Connection, path: ConnectionPath, backgroundColor: string) {
  if (!connection.text) return;
  context.font = FONT;
  const labelBox = getConnectionLabelBox(connection, path, context);
  if (!labelBox) return;
  const textX = labelBox.x + labelBox.width / 2;
  const textY = labelBox.y + labelBox.height / 2;

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  if (shouldDrawConnectionTextGap(connection.textPosition)) {
    context.fillStyle = backgroundColor;
    context.fillRect(labelBox.x, labelBox.y, labelBox.width, labelBox.height);
  }
  context.fillStyle = '#1f2937';
  context.fillText(connection.text, textX, textY);
}

function drawAnchorHandles(
  context: CanvasRenderingContext2D,
  element: FlowElement,
  hoverAnchor: ConnectionEndpoint | null,
  measurer: Measurer,
) {
  for (const anchor of getElementAnchors(element, measurer)) {
    const point = getAnchorHandlePoint(anchor);
    const hovered = hoverAnchor?.elementId === anchor.elementId && hoverAnchor.side === anchor.side;
    context.save();
    context.fillStyle = hovered ? '#2563eb' : '#ffffff';
    context.strokeStyle = hovered ? '#1d4ed8' : '#94a3b8';
    context.lineWidth = hovered ? 2 : 1.5;
    context.beginPath();
    context.arc(point.x, point.y, hovered ? 9 : 7, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.strokeStyle = hovered ? '#ffffff' : '#2563eb';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(point.x - 3.5, point.y);
    context.lineTo(point.x + 3.5, point.y);
    context.moveTo(point.x, point.y - 3.5);
    context.lineTo(point.x, point.y + 3.5);
    context.stroke();
    context.restore();
  }
}

function drawResizeHandles(
  context: CanvasRenderingContext2D,
  element: FlowElement,
  hoverResizeHandle: ResizeHandle | null,
  measurer: Measurer,
) {
  for (const { handle, point } of getResizeHandles(element, measurer)) {
    const hovered = hoverResizeHandle === handle;
    context.save();
    context.fillStyle = hovered ? '#0f172a' : '#ffffff';
    context.strokeStyle = '#0f172a';
    context.lineWidth = 1.3;
    context.beginPath();
    context.rect(point.x - 5, point.y - 5, 10, 10);
    context.fill();
    context.stroke();
    context.restore();
  }
}

function createElementPath(context: CanvasRenderingContext2D, element: FlowElement, box: ReturnType<typeof getElementBox>) {
  context.beginPath();
  if (element.shape === 'ellipse' || element.shape === 'circle') {
    const radiusX = element.shape === 'circle' ? Math.min(box.width, box.height) / 2 : box.width / 2;
    const radiusY = element.shape === 'circle' ? radiusX : box.height / 2;
    context.ellipse(box.x + box.width / 2, box.y + box.height / 2, radiusX, radiusY, 0, 0, Math.PI * 2);
    return;
  }

  const radius = element.shape === 'rounded-rect' ? Math.min(element.borderRadius, box.width / 2, box.height / 2) : 0;
  context.roundRect(box.x, box.y, box.width, box.height, radius);
}

function drawArrow(context: CanvasRenderingContext2D, x: number, y: number, angle: number) {
  const size = 11;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6));
  context.lineTo(x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fill();
}

function drawGuides(context: CanvasRenderingContext2D, guides: AlignmentGuide[]) {
  context.save();
  context.strokeStyle = '#f97316';
  context.lineWidth = 1;
  context.setLineDash([5, 4]);
  for (const guide of guides) {
    context.beginPath();
    if (guide.orientation === 'vertical') {
      context.moveTo(guide.position, guide.from);
      context.lineTo(guide.position, guide.to);
    } else {
      context.moveTo(guide.from, guide.position);
      context.lineTo(guide.to, guide.position);
    }
    context.stroke();
  }
  context.restore();
}
