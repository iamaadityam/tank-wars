import { useEffect, useRef } from "react";
import type { MatchState, ShotPoint, ShotResult } from "../../shared/types";
import { WORLD } from "../../shared/types";
import { terrainHeightAt, unitPatternIndex } from "../../shared/game/world";
import type { PreviewResult } from "../types";

const WIDTH = 1280;
const HEIGHT = 640;
const MAX_ANIMATION_MS = 3_100;
const MIN_ANIMATION_MS = 950;
const INK = "#000000";
const PAPER = "#ffffff";
const PIXEL_FONT = '"Silkscreen", "Geneva", Arial, sans-serif';

interface GameCanvasProps {
  match: MatchState;
  viewerId: string;
  preview: PreviewResult | null;
}

interface AnimState {
  shot: ShotResult;
  progress: number;
  elapsed: number;
  duration: number;
  finished: boolean;
}

interface PatternSet {
  units: CanvasPattern[];
  terrain: CanvasPattern;
}

const patternCache = new WeakMap<CanvasRenderingContext2D, PatternSet>();

const sx = (x: number) => ((x - WORLD.minX) / (WORLD.maxX - WORLD.minX)) * WIDTH;
const sy = (y: number) => HEIGHT - ((y - WORLD.minY) / (WORLD.maxY - WORLD.minY)) * HEIGHT;

function tilePattern(
  ctx: CanvasRenderingContext2D,
  size: number,
  paint: (tile: CanvasRenderingContext2D, size: number) => void,
): CanvasPattern {
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const t = tile.getContext("2d");
  if (!t) return ctx.createPattern(tile, "repeat")!;
  t.fillStyle = PAPER;
  t.fillRect(0, 0, size, size);
  t.fillStyle = INK;
  paint(t, size);
  return ctx.createPattern(tile, "repeat")!;
}

function getPatterns(ctx: CanvasRenderingContext2D): PatternSet {
  const cached = patternCache.get(ctx);
  if (cached) return cached;

  const units = [0, 1, 2, 3].map((index) =>
    tilePattern(ctx, 8, (tile) => {
      if (index === 0) {
        tile.fillRect(0, 0, 8, 8);
      } else if (index === 1) {
        for (let y = 0; y < 8; y += 4) {
          for (let x = 0; x < 8; x += 4) {
            if ((x + y) % 8 === 0) tile.fillRect(x, y, 4, 4);
          }
        }
      } else if (index === 2) {
        for (let y = 0; y < 8; y += 2) tile.fillRect(0, y, 8, 1);
      } else {
        tile.strokeStyle = INK;
        tile.lineWidth = 1;
        for (let offset = -8; offset <= 8; offset += 4) {
          tile.beginPath();
          tile.moveTo(offset, 8);
          tile.lineTo(offset + 8, 0);
          tile.stroke();
        }
      }
    }),
  );

  const terrain = tilePattern(ctx, 4, (tile) => {
    for (let i = 0; i < 4; i++) tile.fillRect(i, i, 1, 1);
  });

  const patterns = { units, terrain };
  patternCache.set(ctx, patterns);
  return patterns;
}

function pathFromPoints(ctx: CanvasRenderingContext2D, points: ShotPoint[], fraction = 1): void {
  if (points.length === 0) return;
  const count = Math.max(1, Math.min(points.length, Math.ceil(points.length * fraction)));
  ctx.moveTo(sx(points[0].x), sy(points[0].y));
  for (let i = 1; i < count; i++) {
    ctx.lineTo(sx(points[i].x), sy(points[i].y));
  }
}

function trailTo(
  ctx: CanvasRenderingContext2D,
  points: ShotPoint[],
  progress: number,
): ShotPoint | null {
  if (points.length === 0) return null;
  if (progress >= 1) return points[points.length - 1];
  const index = Math.max(0, Math.min(points.length - 1, progress * (points.length - 1)));
  const whole = Math.floor(index);
  const frac = index - whole;
  ctx.moveTo(sx(points[0].x), sy(points[0].y));
  for (let i = 1; i <= whole; i++) ctx.lineTo(sx(points[i].x), sy(points[i].y));
  if (whole < points.length - 1) {
    const next = points[whole + 1];
    const current = points[whole];
    const pos = {
      x: current.x + (next.x - current.x) * frac,
      y: current.y + (next.y - current.y) * frac,
    };
    ctx.lineTo(sx(pos.x), sy(pos.y));
    return pos;
  }
  return points[points.length - 1];
}

function drawGrid(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.lineWidth = 1;
  ctx.lineCap = "butt";

  // Graph paper drawn with black pixels only: dotted minor rules and
  // longer-dashed major rules keep the surface light without introducing grey.
  for (let x = Math.ceil(WORLD.minX / 5) * 5; x <= WORLD.maxX; x += 5) {
    const major = x % 10 === 0;
    ctx.beginPath();
    ctx.strokeStyle = INK;
    ctx.setLineDash(major ? [3, 4] : [1, 5]);
    ctx.moveTo(Math.round(sx(x)) + 0.5, 0);
    ctx.lineTo(Math.round(sx(x)) + 0.5, HEIGHT);
    ctx.stroke();
  }
  for (let y = Math.ceil(WORLD.minY / 5) * 5; y <= WORLD.maxY; y += 5) {
    const major = y % 10 === 0;
    ctx.beginPath();
    ctx.strokeStyle = INK;
    ctx.setLineDash(major ? [3, 4] : [1, 5]);
    ctx.moveTo(0, Math.round(sy(y)) + 0.5);
    ctx.lineTo(WIDTH, Math.round(sy(y)) + 0.5);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawTerrain(ctx: CanvasRenderingContext2D): void {
  const patterns = getPatterns(ctx);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, HEIGHT);
  for (let x = WORLD.minX; x <= WORLD.maxX; x += 0.5) {
    ctx.lineTo(sx(x), sy(terrainHeightAt(x)));
  }
  ctx.lineTo(WIDTH, HEIGHT);
  ctx.closePath();
  ctx.fillStyle = patterns.terrain;
  ctx.fill();

  ctx.beginPath();
  for (let x = WORLD.minX; x <= WORLD.maxX; x += 0.35) {
    const px = sx(x);
    const py = sy(terrainHeightAt(x));
    if (x === WORLD.minX) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // MacPaint-style contour hatching under the surface.
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  for (let offset = 3; offset <= 12; offset += 3.5) {
    ctx.beginPath();
    for (let x = WORLD.minX; x <= WORLD.maxX; x += 1) {
      const py = sy(terrainHeightAt(x) - offset);
      if (x === WORLD.minX) ctx.moveTo(sx(x), py);
      else ctx.lineTo(sx(x), py);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawAxes(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.font = `10px ${PIXEL_FONT}`;
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let x = -60; x <= 60; x += 20) {
    const px = Math.round(sx(x)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, HEIGHT - 27);
    ctx.lineTo(px, HEIGHT - 20);
    ctx.stroke();
    if (x !== 0) ctx.fillText(String(x), px, HEIGHT - 16);
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let y = -10; y <= 50; y += 10) {
    const py = Math.round(sy(y)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(4, py);
    ctx.lineTo(12, py);
    ctx.stroke();
    if (y !== 0) ctx.fillText(String(y), 18, py);
  }

  // Axes sit above the terrain and use a heavier, uninterrupted rule.
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, Math.round(sy(0)) + 0.5);
  ctx.lineTo(WIDTH, Math.round(sy(0)) + 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(Math.round(sx(0)) + 0.5, 0);
  ctx.lineTo(Math.round(sx(0)) + 0.5, HEIGHT);
  ctx.stroke();

  ctx.font = `bold 12px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("x", WIDTH - 16, sy(0) - 12);
  ctx.textAlign = "left";
  ctx.fillText("y", sx(0) + 12, 16);
  ctx.restore();
}

function drawLegend(ctx: CanvasRenderingContext2D, expression: string | null, animating: boolean): void {
  ctx.save();
  ctx.font = `10px ${PIXEL_FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.fillRect(20.5, 16.5, 248, 58);
  ctx.strokeRect(20.5, 16.5, 248, 58);

  ctx.strokeStyle = INK;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(34, 36);
  ctx.lineTo(68, 36);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = INK;
  ctx.fillText("PREDICTED", 80, 37);

  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(34, 58);
  ctx.lineTo(68, 58);
  ctx.stroke();
  ctx.fillText(animating ? "FIRING..." : "LAST SHOT", 80, 59);

  if (expression) {
    const label = `f(x) = ${expression}`;
    const width = Math.min(500, Math.ceil(ctx.measureText(label).width) + 20);
    const x = WIDTH - width - 20;
    ctx.fillStyle = PAPER;
    ctx.strokeStyle = INK;
    ctx.fillRect(x + 0.5, 16.5, width, 30);
    ctx.strokeRect(x + 0.5, 16.5, width, 30);
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    ctx.fillText(label, x + 10, 32, width - 18);
  }
  ctx.restore();
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  match: MatchState,
  playerId: string,
  viewerId: string,
  now: number,
): void {
  const player = match.players.find((p) => p.id === playerId);
  if (!player) return;
  const px = sx(player.x);
  const py = sy(player.y);
  const patterns = getPatterns(ctx);
  const active = match.currentPlayerId === player.id && match.status === "active";
  const radius = WORLD.unitRadius * 10;

  ctx.save();
  if (active) {
    ctx.beginPath();
    ctx.arc(px, py, radius + 7, 0, Math.PI * 2);
    ctx.setLineDash([3, 3]);
    ctx.lineDashOffset = -now / 100;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.globalAlpha = player.eliminated ? 0.34 : 1;
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fillStyle = patterns.units[unitPatternIndex(player.colorIndex)];
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(px, py, radius - 6, 0, Math.PI * 2);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold 18px ${PIXEL_FONT}`;
  ctx.fillText(player.name.slice(0, 1).toUpperCase(), px, py + 1);

  if (player.eliminated) {
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(px - 10, py - 10);
    ctx.lineTo(px + 10, py + 10);
    ctx.moveTo(px + 10, py - 10);
    ctx.lineTo(px - 10, py + 10);
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(px - 10, py - 10);
    ctx.lineTo(px + 10, py + 10);
    ctx.moveTo(px + 10, py - 10);
    ctx.lineTo(px - 10, py + 10);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  const barWidth = 66;
  const barX = Math.round(px - barWidth / 2);
  const barY = Math.round(py + radius + 9);
  ctx.fillStyle = PAPER;
  ctx.fillRect(barX, barY, barWidth, 8);
  const health = Math.max(0, player.health / player.maxHealth);
  if (health > 0) {
    ctx.fillStyle = INK;
    ctx.fillRect(barX + 1, barY + 1, Math.max(0, (barWidth - 2) * health), 6);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(barX + 0.5, barY + 0.5, barWidth, 8);

  const tag = `${player.name.toUpperCase()}${player.id === viewerId ? " *" : ""}${
    player.connected ? "" : " OFFLINE"
  }`;
  ctx.font = `10px ${PIXEL_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelWidth = Math.min(190, Math.ceil(ctx.measureText(tag).width) + 10);
  const labelY = barY + 12;
  ctx.fillStyle = PAPER;
  ctx.fillRect(Math.round(px - labelWidth / 2) + 0.5, labelY + 0.5, labelWidth, 15);
  ctx.strokeStyle = INK;
  ctx.strokeRect(Math.round(px - labelWidth / 2) + 0.5, labelY + 0.5, labelWidth, 15);
  ctx.fillStyle = INK;
  ctx.fillText(tag, px, labelY + 8, labelWidth - 6);
  ctx.restore();
}

function drawPredicted(ctx: CanvasRenderingContext2D, preview: PreviewResult | null): void {
  if (!preview || !preview.ok || preview.points.length < 2) return;
  ctx.save();
  ctx.beginPath();
  pathFromPoints(ctx, preview.points);
  ctx.setLineDash([9, 7]);
  ctx.lineDashOffset = -performance.now() / 95;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  const end = preview.points[preview.points.length - 1];
  const start = preview.points[0];
  const ex = Math.round(sx(end.x));
  const ey = Math.round(sy(end.y));
  const startX = Math.round(sx(start.x));
  const startY = Math.round(sy(start.y));

  ctx.fillStyle = PAPER;
  ctx.fillRect(startX - 5, startY - 5, 10, 10);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(startX - 4.5, startY - 4.5, 9, 9);
  ctx.fillStyle = INK;
  ctx.fillRect(startX - 2, startY - 2, 4, 4);

  if (preview.hitPlayerId) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(ex - 12.5, ey - 12.5, 25, 25);
    ctx.beginPath();
    ctx.moveTo(ex - 18, ey);
    ctx.lineTo(ex + 18, ey);
    ctx.moveTo(ex, ey - 18);
    ctx.lineTo(ex, ey + 18);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillRect(ex - 3, ey - 3, 6, 6);
  } else {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ex - 7, ey - 7);
    ctx.lineTo(ex + 7, ey + 7);
    ctx.moveTo(ex + 7, ey - 7);
    ctx.lineTo(ex - 7, ey + 7);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAnimation(ctx: CanvasRenderingContext2D, anim: AnimState | null): void {
  if (!anim) return;
  const { shot, progress, elapsed, duration } = anim;
  const points = shot.points;
  if (points.length < 2) return;

  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 7]);
  ctx.beginPath();
  pathFromPoints(ctx, points);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  const head = trailTo(ctx, points, progress);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.stroke();

  if (head) {
    const hx = Math.round(sx(head.x));
    const hy = Math.round(sy(head.y));
    if (progress < 1) {
      ctx.fillStyle = PAPER;
      ctx.fillRect(hx - 6, hy - 6, 12, 12);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.strokeRect(hx - 5.5, hy - 5.5, 11, 11);
      ctx.fillStyle = INK;
      ctx.fillRect(hx - 2, hy - 2, 4, 4);
    }
  }

  if (progress >= 1) {
    const impactElapsed = elapsed - duration;
    const impactT = Math.min(1, Math.max(0, impactElapsed / 650));
    const end = points[points.length - 1];
    const ex = Math.round(sx(end.x));
    const ey = Math.round(sy(end.y));
    const radius = 9 + impactT * 42;
    ctx.globalAlpha = 1 - impactT;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ex, ey, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Eight chunky segments read as a one-bit impact burst.
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const inner = radius + 3;
      const outer = radius + (shot.outcome === "hit" ? 14 : 9);
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(angle) * inner, ey + Math.sin(angle) * inner);
      ctx.lineTo(ex + Math.cos(angle) * outer, ey + Math.sin(angle) * outer);
      ctx.stroke();
    }

    if (shot.outcome === "hit") {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ex - 10, ey - 10);
      ctx.lineTo(ex + 10, ey + 10);
      ctx.moveTo(ex + 10, ey - 10);
      ctx.lineTo(ex - 10, ey + 10);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  match: MatchState,
  viewerId: string,
  preview: PreviewResult | null,
  anim: AnimState | null,
  now: number,
): void {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  drawGrid(ctx);
  drawTerrain(ctx);
  drawAxes(ctx);
  if (!anim) drawPredicted(ctx, preview);
  drawAnimation(ctx, anim);
  for (const player of match.players) {
    drawUnit(ctx, match, player.id, viewerId, now);
  }
  const expression = anim ? anim.shot.expression : preview?.source ?? match.lastShot?.expression ?? null;
  drawLegend(ctx, expression, Boolean(anim && anim.progress < 1));
}

export function GameCanvas({ match, viewerId, preview }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<{ id: string; startedAt: number } | null>(null);
  const propsRef = useRef({ match, viewerId, preview });
  propsRef.current = { match, viewerId, preview };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    let raf = 0;
    let stopped = false;

    const frame = (now: number) => {
      if (stopped) return;
      const { match: currentMatch, viewerId: currentViewer, preview: currentPreview } = propsRef.current;
      const shot = currentMatch.lastShot;
      if (shot && (!animationRef.current || animationRef.current.id !== shot.id)) {
        animationRef.current = { id: shot.id, startedAt: now };
      }
      let anim: AnimState | null = null;
      if (shot && animationRef.current?.id === shot.id) {
        const duration = Math.min(
          MAX_ANIMATION_MS,
          Math.max(MIN_ANIMATION_MS, shot.points.length * 3.1),
        );
        const elapsed = now - animationRef.current.startedAt;
        anim = {
          shot,
          progress: Math.min(1, Math.max(0, elapsed / duration)),
          elapsed,
          duration,
          finished: elapsed > duration + 700,
        };
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawScene(ctx, currentMatch, currentViewer, currentPreview, anim, now);
      if (anim && !anim.finished) {
        raf = requestAnimationFrame(frame);
      }
    };

    frame(performance.now());
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [match, preview, viewerId]);

  return (
    <canvas
      ref={canvasRef}
      className="game-canvas"
      aria-label="Cartesian battlefield with terrain, units, predicted trajectory and projectile animation. Tap to skip the shot animation."
      onPointerDown={() => {
        if (animationRef.current) {
          animationRef.current = {
            id: animationRef.current.id,
            startedAt: performance.now() - 100_000,
          };
        }
      }}
    />
  );
}
