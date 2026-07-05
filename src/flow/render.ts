import type { AlignmentGuide, Connection, FlowElement, Selection } from '../types/flow';
import {
  getArrowAngle,
  getConnectionPath,
  getElementBox,
  getTextOffset,
  type Measurer,
} from './geometry';

const FONT = '14px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export function renderFlow(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  elements: FlowElement[],
  connections: Connection[],
  selection: Selection,
  guides: AlignmentGuide[],
) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  drawBackground(context, canvas);
  const measurer: Measurer = context;

  connections.forEach((connection) => {
    drawConnection(context, connection, elements, selection?.type === 'connection' && selection.id === connection.id, measurer);
  });
  elements.forEach((element) => {
    drawElement(context, element, selection?.type === 'element' && selection.id === element.id, measurer);
  });
  drawGuides(context, guides);
  context.restore();
}

function drawBackground(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  const width = canvas.width / (window.devicePixelRatio || 1);
  const height = canvas.height / (window.devicePixelRatio || 1);
  context.fillStyle = '#f5f7fb';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#e2e8f0';
  context.lineWidth = 1;

  for (let x = 0; x < width; x += 24) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  for (let y = 0; y < height; y += 24) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

function drawElement(context: CanvasRenderingContext2D, element: FlowElement, selected: boolean, measurer: Measurer) {
  const box = getElementBox(element, measurer);
  context.save();
  context.fillStyle = element.backgroundColor;
  context.strokeStyle = element.borderColor;
  context.lineWidth = element.borderWidth;
  context.setLineDash([]);
  createElementPath(context, element, box);
  context.fill();
  context.stroke();

  context.font = FONT;
  context.fillStyle = '#111827';
  context.textBaseline = 'middle';
  context.textAlign = element.textAlign;
  const textX =
    element.textAlign === 'left'
      ? box.x + element.padding
      : element.textAlign === 'right'
        ? box.x + box.width - element.padding
        : box.x + box.width / 2;
  context.fillText(element.text, textX, box.y + box.height / 2, Math.max(12, box.width - element.padding * 2));

  if (selected) {
    context.strokeStyle = '#0f172a';
    context.lineWidth = 1.5;
    context.setLineDash([6, 4]);
    context.strokeRect(box.x - 7, box.y - 7, box.width + 14, box.height + 14);
    context.setLineDash([]);
    drawHandle(context, box.x - 7, box.y - 7);
    drawHandle(context, box.x + box.width + 7, box.y - 7);
    drawHandle(context, box.x - 7, box.y + box.height + 7);
    drawHandle(context, box.x + box.width + 7, box.y + box.height + 7);
  }

  context.restore();
}

function drawConnection(
  context: CanvasRenderingContext2D,
  connection: Connection,
  elements: FlowElement[],
  selected: boolean,
  measurer: Measurer,
) {
  const path = getConnectionPath(connection, elements, measurer);
  if (!path) return;

  context.save();
  context.strokeStyle = selected ? '#ef4444' : '#475569';
  context.fillStyle = selected ? '#ef4444' : '#475569';
  context.lineWidth = selected ? 3 : 2;
  context.setLineDash(connection.lineType === 'dashed' ? [connection.dashLength, connection.dashGap] : []);

  if (connection.text && connection.textPosition === 'middle') {
    drawBrokenPath(context, path, connection.text);
  } else {
    context.beginPath();
    context.moveTo(path.start.x, path.start.y);
    if (path.control) context.quadraticCurveTo(path.control.x, path.control.y, path.end.x, path.end.y);
    else context.lineTo(path.end.x, path.end.y);
    context.stroke();
  }

  context.setLineDash([]);
  if (connection.arrow === 'start' || connection.arrow === 'both') {
    drawArrow(context, path.start.x, path.start.y, getArrowAngle(path, 'start'));
  }
  if (connection.arrow === 'end' || connection.arrow === 'both') {
    drawArrow(context, path.end.x, path.end.y, getArrowAngle(path, 'end'));
  }
  drawConnectionText(context, connection, path);
  context.restore();
}

function drawBrokenPath(context: CanvasRenderingContext2D, path: NonNullable<ReturnType<typeof getConnectionPath>>, text: string) {
  const textWidth = context.measureText(text).width + 28;
  const length = Math.hypot(path.end.x - path.start.x, path.end.y - path.start.y);
  const gapRatio = Math.min(0.22, textWidth / Math.max(length, 1) / 2);
  drawPartialPath(context, path, 0, 0.5 - gapRatio);
  drawPartialPath(context, path, 0.5 + gapRatio, 1);
}

function drawPartialPath(
  context: CanvasRenderingContext2D,
  path: NonNullable<ReturnType<typeof getConnectionPath>>,
  startT: number,
  endT: number,
) {
  const steps = path.control ? 24 : 1;
  context.beginPath();
  for (let index = 0; index <= steps; index += 1) {
    const t = startT + (endT - startT) * (index / steps);
    const point = path.control
      ? {
          x:
            (1 - t) * (1 - t) * path.start.x +
            2 * (1 - t) * t * path.control.x +
            t * t * path.end.x,
          y:
            (1 - t) * (1 - t) * path.start.y +
            2 * (1 - t) * t * path.control.y +
            t * t * path.end.y,
        }
      : {
          x: path.start.x + (path.end.x - path.start.x) * t,
          y: path.start.y + (path.end.y - path.start.y) * t,
        };
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.stroke();
}

function drawConnectionText(
  context: CanvasRenderingContext2D,
  connection: Connection,
  path: NonNullable<ReturnType<typeof getConnectionPath>>,
) {
  if (!connection.text) return;
  const offset = getTextOffset(connection.textPosition, path.textAngle);
  const textX = path.textPoint.x + offset.x;
  const textY = path.textPoint.y + offset.y;
  const metrics = context.measureText(connection.text);

  context.font = FONT;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#f5f7fb';
  context.fillRect(textX - metrics.width / 2 - 8, textY - 10, metrics.width + 16, 20);
  context.fillStyle = '#1f2937';
  context.fillText(connection.text, textX, textY);
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

function drawHandle(context: CanvasRenderingContext2D, x: number, y: number) {
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#0f172a';
  context.lineWidth = 1.5;
  context.beginPath();
  context.rect(x - 4, y - 4, 8, 8);
  context.fill();
  context.stroke();
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
