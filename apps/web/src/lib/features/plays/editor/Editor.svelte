<!--
  Play / drill diagram editor (docs/diagrams.md §Editor — mobile and desktop). Immersive and
  full-screen. All edits go through History (a drag is one command); the canvas repaints on demand
  and requestAnimationFrame runs continuously only while previewing.
-->
<script lang="ts">
  import { shownTemplate } from '#lib/features/plays/templates';
  import { onMount, tick, untrack } from 'svelte';
  import type { Member, Play, Vec2 } from '@phaseplay/shared';
  import { History } from '@phaseplay/diagram/history';
  import {
    frameTimes,
    resolvedBall,
    resolvedPositions,
    totalDuration,
    type Scene,
  } from '@phaseplay/diagram/sample';
  import { tokenRadiusPx } from '@phaseplay/diagram/draw';
  import { bestOrientation } from '@phaseplay/diagram/viewport';
  import { strokeToCtrl } from '@phaseplay/diagram/geometry';
  import { PRESETS, addFrame, duplicateFrame, type PresetId } from '@phaseplay/diagram/presets';
  import { DRILL_TEMPLATES, type DrillTemplateId } from '@phaseplay/diagram/drill-templates';
  import { app } from '#lib/data/app.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Button from '#lib/components/Button.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import {
    IconX,
    IconUndo,
    IconRedo,
    IconPlay,
    IconPause,
    IconPlus,
    IconSettings,
    IconCopy,
    IconTrash,
    IconEdit,
    IconUsers,
  } from '#lib/icons';
  import IconMagnet from '@lucide/svelte/icons/magnet';
  import IconKeyboard from '@lucide/svelte/icons/keyboard';
  import IconTemplate from '@lucide/svelte/icons/layout-template';
  import IconScan from '@lucide/svelte/icons/scan';
  import { Stage } from '../stage';
  import { entityLabel, placeLabel, describeFrame, type Names } from '../describe';
  import {
    addEntity,
    addPlayersOp,
    applyPreset,
    clampToBounds,
    duplicateEntity,
    giveBall,
    inRect,
    isPerson,
    kickTo,
    passTo,
    pick,
    removeEntities,
    clearMove,
    hasMove,
    setPositions,
    setRun,
    snapPoint,
    updateEntity,
  } from '../ops';
  import {
    DRILL_TOOLS,
    EQUIPMENT_KINDS,
    PLAY_TOOLS,
    SHORTCUTS,
    sameTool,
    type Tool,
    type ToolButton,
  } from './tools';
  import TokenPanel from './TokenPanel.svelte';
  import FramePanel from './FramePanel.svelte';

  type Props = {
    initial: Play;
    title: string;
    status: string;
    members: Member[];
    onchange: (p: Play) => void;
    ondetails: () => void;
    onclose: () => void;
  };
  let { initial, title, status, members, onchange, ondetails, onclose }: Props = $props();

  // ---------------------------------------------------------------------------------- state
  // The editor owns the play from here on; later prop changes go through replace().
  const start = untrack(() => initial);
  let play = $state.raw<Play>(start);
  let rev = $state(0);
  const history = new History(start, {
    onChange: (p) => {
      play = p;
      rev++;
      if (fi > p.frames.length - 1) fi = p.frames.length - 1;
      selected = selected.filter((id) => p.entities.some((e) => e.id === id));
      onchange(p);
      repaint();
    },
  });
  const drill = $derived(play.mode === 'drill');
  let fi = $state(0);
  let tool = $state<Tool>({ id: 'select' });
  let group = $state<'A' | 'B' | 'C' | 'D'>('A');
  let selected = $state.raw<string[]>([]);
  let snap = $state(true);
  let previewing = $state(false);
  let scrubT = $state<number | null>(null);
  let zoomed = $state(false);
  let desktop = $state(false);
  /** Bumped when the pitch ↔ screen transform changes (resize, zoom). */
  let viewRev = $state(0);

  let tokenSheet = $state(false);
  let frameSheet = $state(false);
  let presetSheet = $state(false);
  let kitSheet = $state(false);
  let playersSheet = $state(false);
  let keysSheet = $state(false);
  let textSheet = $state<{ at: Vec2; id?: string; value: string } | null>(null);
  let textOpen = $state(false);
  let menu = $state<{ x: number; y: number; id: string } | null>(null);
  let addN = $state(6);
  let addLayout = $state<'line' | 'grid'>('line');
  let addKind = $state<'player' | 'attack' | 'defence'>('player');

  let canvas: HTMLCanvasElement | undefined = $state();
  let wrap: HTMLDivElement | undefined = $state();
  let stage: Stage | null = null;
  let scene: Scene | null = null;

  const times = $derived(frameTimes(play));
  const total = $derived(totalDuration(play));
  const canUndo = $derived(rev >= 0 && history.canUndo);
  const canRedo = $derived(rev >= 0 && history.canRedo);
  const tools: ToolButton[] = $derived(drill ? DRILL_TOOLS : PLAY_TOOLS);
  const names = $derived(Object.fromEntries(members.map((m) => [m.id, m.displayName])) as Names);
  const one = $derived(selected.length === 1 ? selected[0] : undefined);
  const oneEntity = $derived(one ? play.entities.find((e) => e.id === one) : undefined);
  const players = $derived(members.filter((m) => m.role === 'player' || m.positions.length > 0));

  // ---------------------------------------------------------------------------------- history
  export function apply(fn: (p: Play) => Play, label: string) {
    history.apply(fn, label);
  }
  /** Replace without an undo entry ("Take theirs"). */
  export function replace(p: Play) {
    history.reset(p);
  }
  export function current(): Play {
    return history.present;
  }
  function undo() {
    history.undo();
  }
  function redo() {
    history.redo();
  }

  // ---------------------------------------------------------------------------------- render
  let pending = 0;
  let previewRaf = 0;
  let previewStart = 0;
  let previewFrom = 0;

  function repaint() {
    if (pending || previewing) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      paint();
    });
  }

  function showTime(): number {
    if (scrubT !== null) return scrubT;
    return times[fi] ?? 0;
  }

  function paint(t = showTime()) {
    if (!stage) return;
    scene = stage.paint(play, t, { direct: gesture?.kind === 'pinch' });
    if (!previewing && scrubT === null) overlay();
  }

  const SEL = '#ffd23f';
  function overlay() {
    if (!stage || !scene) return;
    const ctx = stage.ctx;
    const tr = stage.transform(play);
    const r = tokenRadiusPx(tr);
    const dpr = stage.dpr;
    const at = (id: string): Vec2 | null => {
      if (scene!.ball?.id === id) return scene!.ball.pos;
      return scene!.entities.find((e) => e.id === id)?.pos ?? null;
    };
    ctx.save();
    // Ball holder hint while passing/kicking.
    if (tool.id === 'pass' || tool.id === 'kick') {
      const h = resolvedBall(play, Math.max(0, fi - (fi > 0 ? 1 : 0)))?.holder;
      const p = h ? at(h) : null;
      if (p) {
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.arc(tr.sx(p.x, p.y), tr.sy(p.x, p.y), r + 7 * dpr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    for (const id of selected) {
      const p = at(id);
      if (!p) continue;
      const e = play.entities.find((x) => x.id === id);
      const x = tr.sx(p.x, p.y);
      const y = tr.sy(p.x, p.y);
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      if (
        e?.size &&
        (e.kind === 'zone' ||
          e.kind === 'ladder' ||
          e.kind === 'scrum_machine' ||
          e.kind === 'gate')
      ) {
        const w = e.size.w * tr.scale;
        const h = e.size.h * tr.scale;
        const landscape = tr.orientation === 'landscape';
        ctx.translate(x, y);
        ctx.rotate(((e.size.rot ?? 0) * Math.PI) / 180);
        ctx.strokeRect(
          -(landscape ? h : w) / 2 - 4 * dpr,
          -(landscape ? w : h) / 2 - 4 * dpr,
          (landscape ? h : w) + 8 * dpr,
          (landscape ? w : h) + 8 * dpr,
        );
        ctx.strokeStyle = SEL;
        ctx.lineWidth = 2 * dpr;
        ctx.strokeRect(
          -(landscape ? h : w) / 2 - 4 * dpr,
          -(landscape ? w : h) / 2 - 4 * dpr,
          (landscape ? h : w) + 8 * dpr,
          (landscape ? w : h) + 8 * dpr,
        );
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        continue;
      }
      ctx.beginPath();
      ctx.arc(x, y, r + 5 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = SEL;
      ctx.lineWidth = 2.5 * dpr;
      ctx.beginPath();
      ctx.arc(x, y, r + 5 * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }
    const g = gesture;
    if (g?.kind === 'stroke' && g.points.length > 1) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 * dpr;
      ctx.setLineDash([6 * dpr, 5 * dpr]);
      ctx.beginPath();
      g.points.forEach((p, i) =>
        i
          ? ctx.lineTo(tr.sx(p.x, p.y), tr.sy(p.x, p.y))
          : ctx.moveTo(tr.sx(p.x, p.y), tr.sy(p.x, p.y)),
      );
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (g?.kind === 'marquee') {
      const ax = tr.sx(g.a.x, g.a.y);
      const ay = tr.sy(g.a.x, g.a.y);
      const bx = tr.sx(g.b.x, g.b.y);
      const by = tr.sy(g.b.x, g.b.y);
      ctx.fillStyle = 'rgba(255, 210, 63, 0.15)';
      ctx.strokeStyle = SEL;
      ctx.lineWidth = 1.5 * dpr;
      ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    }
    if (g?.kind === 'drag' && g.moved) {
      // Measure: distance from where the drag started.
      const p = at(g.primary);
      const o = g.orig[g.primary];
      if (p && o) {
        const d = Math.hypot(p.x - o.x, p.y - o.y);
        const x = tr.sx(p.x, p.y);
        const y = tr.sy(p.x, p.y) - r - 14 * dpr;
        const label = `${d.toFixed(1)} m`;
        ctx.font = `700 ${12 * dpr}px system-ui, sans-serif`;
        const w = ctx.measureText(label).width + 12 * dpr;
        ctx.fillStyle = 'rgba(12,16,13,0.8)';
        ctx.fillRect(x - w / 2, y - 10 * dpr, w, 20 * dpr);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y);
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------------- preview
  function startPreview() {
    if (total <= 0) {
      toasts.show('Add a frame and move someone to see it play');
      return;
    }
    cancelGesture();
    menu = null;
    previewing = true;
    scrubT = null;
    previewFrom = fi > 0 && fi < play.frames.length - 1 ? (times[fi - 1] ?? 0) : 0;
    previewStart = 0;
    const loopIt = !!play.loop;
    const step = (now: number) => {
      if (!previewStart) previewStart = now;
      const t = previewFrom + (now - previewStart);
      if (t >= total && !loopIt) {
        stopPreview();
        return;
      }
      paint(loopIt ? t % (total + 600) : t);
      previewRaf = requestAnimationFrame(step);
    };
    previewRaf = requestAnimationFrame(step);
  }
  function stopPreview() {
    cancelAnimationFrame(previewRaf);
    previewRaf = 0;
    previewing = false;
    repaint();
  }
  function togglePreview() {
    if (previewing) stopPreview();
    else startPreview();
  }

  // ---------------------------------------------------------------------------------- frames
  function selectFrame(i: number) {
    if (previewing) stopPreview();
    scrubT = null;
    fi = Math.max(0, Math.min(play.frames.length - 1, i));
    repaint();
  }
  function newFrame() {
    apply((p) => addFrame(p, fi), 'New frame');
    selectFrame(fi + 1);
    announce(`Frame ${fi + 1} added. Move what changes.`);
  }
  function dupFrame() {
    apply((p) => duplicateFrame(p, fi), 'Duplicate frame');
    selectFrame(fi + 1);
  }
  /** Moves need a frame to happen in: on the starting formation, add one first. */
  function ensureMoveFrame(): number {
    if (fi > 0) return fi;
    if (play.frames.length > 1) {
      selectFrame(1);
      return 1;
    }
    history.apply((p) => addFrame(p, 0), 'New frame');
    fi = 1;
    return 1;
  }

  // ---------------------------------------------------------------------------------- live region
  let live = $state('');
  function announce(s: string) {
    live = '';
    void tick().then(() => (live = s));
  }

  // ---------------------------------------------------------------------------------- zoom
  let zoom = 1;
  let center: Vec2 | null = null;
  function applyView() {
    if (!stage) return;
    const base = stage.baseViewport(play);
    if (zoom <= 1.01 || !center) {
      zoom = 1;
      center = null;
      stage.viewport = null;
      zoomed = false;
      viewRev++;
      return;
    }
    const w = base.w / zoom;
    const h = base.h / zoom;
    const cx = Math.min(base.x + base.w - w / 2, Math.max(base.x + w / 2, center.x));
    const cy = Math.min(base.y + base.h - h / 2, Math.max(base.y + h / 2, center.y));
    center = { x: cx, y: cy };
    stage.viewport = { x: cx - w / 2, y: cy - h / 2, w, h };
    zoomed = true;
    viewRev++;
  }
  /** Zoom so pitch point P stays under client point m. */
  function zoomAround(P: Vec2, m: { x: number; y: number }, z: number) {
    if (!stage) return;
    zoom = Math.max(1, Math.min(6, z));
    center = { ...P };
    applyView();
    if (!stage.viewport) return;
    const rect = canvas!.getBoundingClientRect();
    const s = stage.toCss(play, P);
    const a = stage.toPitch(play, m.x, m.y);
    const b = stage.toPitch(play, s.x + rect.left, s.y + rect.top);
    center = { x: P.x - (a.x - b.x), y: P.y - (a.y - b.y) };
    applyView();
  }
  function resetZoom() {
    zoom = 1;
    center = null;
    applyView();
    repaint();
  }

  // ---------------------------------------------------------------------------------- gestures
  type Gesture =
    | {
        kind: 'drag';
        primary: string;
        ids: string[];
        start: Vec2;
        orig: Record<string, Vec2>;
        moved: boolean;
        client: { x: number; y: number };
        adding: boolean;
      }
    | { kind: 'stroke'; id: string; points: Vec2[] }
    | { kind: 'marquee'; a: Vec2; b: Vec2; base: string[] }
    | { kind: 'pinch'; P: Vec2; d0: number; z0: number }
    | { kind: 'pan'; last: { x: number; y: number } }
    | { kind: 'tap'; at: Vec2; hit: string | null; client: { x: number; y: number } };
  let gesture: Gesture | null = null;
  // Plain Map on purpose: pointer bookkeeping is not rendered, so it must not be reactive.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const pointers = new Map<number, { x: number; y: number }>();
  let longPress: ReturnType<typeof setTimeout> | null = null;

  function cancelLongPress() {
    if (longPress) clearTimeout(longPress);
    longPress = null;
  }
  function cancelGesture() {
    cancelLongPress();
    if (gesture?.kind === 'drag' || gesture?.kind === 'stroke') history.cancel();
    gesture = null;
  }

  function posOf(id: string): Vec2 | null {
    if (!scene) return null;
    if (scene.ball?.id === id) return { ...scene.ball.pos };
    const e = scene.entities.find((x) => x.id === id);
    return e ? { ...e.pos } : null;
  }
  const tolFor = (e: PointerEvent) =>
    (e.pointerType === 'touch' ? 22 : 12) * (stage?.metresPerPx(play) ?? 0.1);
  const mid = () => {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  const snapIf = (p: Vec2) => clampToBounds(play, snap ? snapPoint(play, p) : p);

  function onDown(e: PointerEvent) {
    if (!stage || !canvas) return;
    if (e.button === 2) return;
    menu = null;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (previewing || scrubT !== null) {
      if (previewing) stopPreview();
      scrubT = null;
      repaint();
      return;
    }
    if (pointers.size === 2) {
      cancelGesture();
      const m = mid();
      gesture = {
        kind: 'pinch',
        P: stage.toPitch(play, m.x, m.y),
        d0: Math.max(10, m.d),
        z0: zoom,
      };
      return;
    }
    if (pointers.size > 2) return;
    if (!scene) paint();
    const p = stage.toPitch(play, e.clientX, e.clientY);
    const hit = scene ? pick(scene, p, tolFor(e)) : null;
    const client = { x: e.clientX, y: e.clientY };

    if (tool.id === 'select') {
      if (hit) {
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          selected = selected.includes(hit)
            ? selected.filter((x) => x !== hit)
            : [...selected, hit];
          repaint();
          return;
        }
        if (!selected.includes(hit)) selected = [hit];
        const ids = selected.slice();
        const orig: Record<string, Vec2> = {};
        for (const id of ids) {
          const q = posOf(id);
          if (q) orig[id] = q;
        }
        gesture = {
          kind: 'drag',
          primary: hit,
          ids,
          start: p,
          orig,
          moved: false,
          client,
          adding: false,
        };
        if (e.pointerType !== 'mouse') {
          longPress = setTimeout(() => {
            if (gesture?.kind === 'drag' && !gesture.moved) {
              gesture = null;
              selected = [hit];
              tokenSheet = true;
              navigator.vibrate?.(10);
            }
          }, 500);
        }
        repaint();
      } else if (e.pointerType === 'mouse') {
        gesture = { kind: 'marquee', a: p, b: p, base: e.shiftKey ? selected.slice() : [] };
        if (!e.shiftKey) selected = [];
        repaint();
      } else {
        gesture = zoomed
          ? { kind: 'pan', last: client }
          : { kind: 'tap', at: p, hit: null, client };
      }
      return;
    }
    if (tool.id === 'add' && tool.kind) {
      const kind = tool.kind;
      if (
        kind === 'ball' &&
        hit &&
        isPerson(play.entities.find((x) => x.id === hit)?.kind ?? 'cone')
      ) {
        apply((q) => giveBall(q, fi, hit), 'Give ball');
        announce(`${label(hit)} has the ball`);
        return;
      }
      const at = snapIf(p);
      const ball = kind === 'ball' ? play.entities.find((x) => x.kind === 'ball') : undefined;
      if (ball) {
        apply((q) => kickTo(q, fi, at, 'pass'), 'Move ball');
        selected = [ball.id];
        return;
      }
      history.begin(`Add ${kind}`);
      let newId = '';
      history.apply((q) => {
        const r = addEntity(q, kind, at, kind === 'player' ? { group } : {});
        newId = r.id;
        return r.play;
      });
      selected = [newId];
      gesture = {
        kind: 'drag',
        primary: newId,
        ids: [newId],
        start: p,
        orig: { [newId]: at },
        moved: false,
        client,
        adding: true,
      };
      repaint();
      return;
    }
    if (tool.id === 'run') {
      if (!hit || play.entities.find((x) => x.id === hit)?.kind === 'ball') {
        gesture = { kind: 'tap', at: p, hit: null, client };
        return;
      }
      history.begin('Run');
      ensureMoveFrame();
      const start = posOf(hit) ?? p;
      selected = [hit];
      gesture = { kind: 'stroke', id: hit, points: [start] };
      repaint();
      return;
    }
    gesture = { kind: 'tap', at: p, hit, client };
  }

  function onMove(e: PointerEvent) {
    if (!stage || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture;
    if (!g) return;
    if (g.kind === 'pinch' && pointers.size >= 2) {
      const m = mid();
      zoomAround(g.P, m, (g.z0 * m.d) / g.d0);
      repaint();
      return;
    }
    if (g.kind === 'pan') {
      const r = stage.toPitch(play, g.last.x, g.last.y);
      const q = stage.toPitch(play, e.clientX, e.clientY);
      if (center) center = { x: center.x - (q.x - r.x), y: center.y - (q.y - r.y) };
      applyView();
      g.last = { x: e.clientX, y: e.clientY };
      repaint();
      return;
    }
    const p = stage.toPitch(play, e.clientX, e.clientY);
    if (g.kind === 'drag') {
      if (!g.moved) {
        if (Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) < 5) return;
        g.moved = true;
        cancelLongPress();
        if (!g.adding) history.begin(g.ids.length > 1 ? 'Move tokens' : 'Move');
      }
      const o = g.orig[g.primary];
      if (!o) return;
      const target = snapIf({ x: o.x + p.x - g.start.x, y: o.y + p.y - g.start.y });
      const dx = target.x - o.x;
      const dy = target.y - o.y;
      const targets: Record<string, Vec2> = {};
      for (const id of g.ids) {
        const q = g.orig[id];
        if (q) targets[id] = clampToBounds(play, { x: q.x + dx, y: q.y + dy });
      }
      history.apply((q) => setPositions(q, fi, targets));
      return;
    }
    if (g.kind === 'stroke') {
      const last = g.points[g.points.length - 1]!;
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.25) {
        g.points.push(clampToBounds(play, p));
        repaint();
      }
      return;
    }
    if (g.kind === 'marquee') {
      g.b = p;
      if (scene) selected = [...new Set([...g.base, ...inRect(scene, g.a, g.b)])];
      repaint();
    }
  }

  function onUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    cancelLongPress();
    const g = gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (pointers.size < 2) gesture = null;
      repaint();
      return;
    }
    gesture = null;
    if (g.kind === 'drag') {
      if (g.moved || g.adding) {
        // A dragged ball dropped on a player is given to them.
        const ball = play.entities.find((x) => x.kind === 'ball');
        if (ball && g.ids.length === 1 && g.primary === ball.id && scene && stage) {
          const p = stage.toPitch(play, e.clientX, e.clientY);
          const near = scene.entities.find(
            (x) => isPerson(x.kind) && Math.hypot(x.pos.x - p.x, x.pos.y - p.y) < 1.4,
          );
          if (near) history.apply((q) => giveBall(q, fi, near.id));
          else history.apply((q) => kickTo(q, fi, posOf(ball.id) ?? p, fi > 0 ? 'pass' : 'kick'));
        }
        history.commit();
        if (g.adding) announce(`${label(g.primary)} added`);
        else announce(`Moved ${g.ids.length > 1 ? `${g.ids.length} tokens` : label(g.primary)}`);
      }
      repaint();
      return;
    }
    if (g.kind === 'stroke') {
      const pts = g.points;
      const first = pts[0]!;
      const last = pts[pts.length - 1]!;
      if (pts.length < 2 || Math.hypot(last.x - first.x, last.y - first.y) < 0.6) {
        history.commit();
        repaint();
        return;
      }
      const end = snapIf(last);
      const ctrl = strokeToCtrl([...pts.slice(0, -1), end]);
      history.apply((q) => setRun(q, fi, g.id, end, ctrl));
      history.commit();
      announce(`${label(g.id)} runs to ${placeLabel(play, end)}`);
      repaint();
      return;
    }
    if (g.kind === 'marquee') {
      repaint();
      return;
    }
    if (g.kind === 'tap') {
      if (Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) > 8) return;
      tapAt(g.at, g.hit);
    }
  }

  function tapAt(at: Vec2, hit: string | null) {
    const target = hit ? play.entities.find((x) => x.id === hit) : undefined;
    if (tool.id === 'select') {
      selected = [];
      repaint();
      return;
    }
    if (tool.id === 'run') {
      toasts.show('Drag from a player to draw their run');
      return;
    }
    if (tool.id === 'pass' || tool.id === 'kick') {
      const kind = tool.id;
      const prev = resolvedBall(play, fi > 0 ? fi - 1 : 0);
      if (!prev?.holder && !prev?.at) {
        toasts.show('Give someone the ball first: pick Ball, then tap a player');
        return;
      }
      if (target && target.kind === 'ball') return;
      if (target && isPerson(target.kind)) {
        if (
          fi > 0 &&
          resolvedBall(play, fi - 1)?.holder === target.id &&
          resolvedBall(play, fi)?.holder === target.id
        )
          return;
        history.begin(kind === 'pass' ? 'Pass' : 'Kick');
        const f = ensureMoveFrame();
        history.apply((q) => passTo(q, f, target.id, kind));
        history.commit();
        announce(
          `${prev.holder ? label(prev.holder) : 'Ball'} ${kind === 'pass' ? 'passes' : 'kicks'} to ${label(target.id)}`,
        );
      } else {
        history.begin(kind === 'pass' ? 'Pass' : 'Kick');
        const f = ensureMoveFrame();
        const p = snapIf(at);
        history.apply((q) => kickTo(q, f, p, kind));
        history.commit();
        announce(`Ball ${kind === 'pass' ? 'passed' : 'kicked'} to ${placeLabel(play, p)}`);
      }
      repaint();
      return;
    }
    if (tool.id === 'text') {
      if (target?.kind === 'label') textSheet = { at, id: target.id, value: target.text ?? '' };
      else textSheet = { at: snapIf(at), value: '' };
      textOpen = true;
    }
  }

  function saveText(e: SubmitEvent) {
    e.preventDefault();
    const t = textSheet;
    if (!t) return;
    const value = t.value.trim().slice(0, 80);
    if (t.id)
      apply(
        (p) => (value ? updateEntity(p, t.id!, { text: value }) : removeEntities(p, [t.id!])),
        'Text',
      );
    else if (value) {
      let id = '';
      apply((p) => {
        const r = addEntity(p, 'label', t.at, { text: value });
        id = r.id;
        return r.play;
      }, 'Add text');
      selected = [id];
    }
    textOpen = false;
    textSheet = null;
  }

  function onWheel(e: WheelEvent) {
    if (!stage) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const P = stage.toPitch(play, e.clientX, e.clientY);
      zoomAround(P, { x: e.clientX, y: e.clientY }, zoom * Math.exp(-e.deltaY * 0.01));
      repaint();
    } else if (zoomed) {
      e.preventDefault();
      const k = stage.metresPerPx(play);
      if (center) {
        const land = stage.orientationFor(play) === 'landscape';
        center = land
          ? { x: center.x + e.deltaY * k, y: center.y - e.deltaX * k }
          : { x: center.x + e.deltaX * k, y: center.y + e.deltaY * k };
      }
      applyView();
      repaint();
    }
  }

  function onContext(e: MouseEvent) {
    e.preventDefault();
    if (!stage || !scene) return;
    const p = stage.toPitch(play, e.clientX, e.clientY);
    const hit = pick(scene, p, 12 * stage.metresPerPx(play));
    if (!hit) return;
    if (!selected.includes(hit)) selected = [hit];
    const r = wrap!.getBoundingClientRect();
    menu = { x: e.clientX - r.left, y: e.clientY - r.top, id: hit };
    repaint();
    void tick().then(() => wrap?.querySelector<HTMLElement>('.menu [role=menuitem]')?.focus());
  }

  // ---------------------------------------------------------------------------------- selection ops
  const label = (id: string) => {
    const e = play.entities.find((x) => x.id === id);
    return e ? entityLabel(e, names) : 'Token';
  };
  function deleteSelected() {
    if (!selected.length) return;
    const n = selected.length;
    const what = n === 1 ? label(selected[0]!) : `${n} tokens`;
    const ids = selected.slice();
    apply((p) => removeEntities(p, ids), n === 1 ? 'Delete' : 'Delete tokens');
    selected = [];
    tokenSheet = false;
    menu = null;
    toasts.undo(`Deleted ${what}`, () => undo());
  }
  /** Undo the selected tokens' movement in this frame (they stay where they were). */
  function clearSelectedMoves() {
    const ids = selected.filter((id) => hasMove(play, fi, id));
    menu = null;
    if (!ids.length) {
      announce('Nothing moves in this frame');
      return;
    }
    apply((p) => ids.reduce((q, id) => clearMove(q, fi, id), p), 'Remove move');
    toasts.undo(
      ids.length === 1 ? `Removed ${label(ids[0]!)}'s move` : `Removed ${ids.length} moves`,
      () => undo(),
    );
  }
  function duplicateSelected() {
    const ids = selected.slice();
    const out: string[] = [];
    apply((p) => {
      let q = p;
      for (const id of ids) {
        const r = duplicateEntity(q, id);
        q = r.play;
        if (r.id !== id) out.push(r.id);
      }
      return q;
    }, 'Duplicate');
    if (out.length) selected = out;
    menu = null;
  }
  function nudge(dx: number, dy: number) {
    if (!selected.length || !scene) return;
    const land = stage?.orientationFor(play) === 'landscape';
    // Arrow keys move on screen; convert to pitch axes for the current orientation.
    const d = land ? { x: dy, y: -dx } : { x: dx, y: dy };
    const targets: Record<string, Vec2> = {};
    for (const id of selected) {
      const p = positions[id] ?? posOf(id);
      if (p) targets[id] = clampToBounds(play, { x: p.x + d.x, y: p.y + d.y });
    }
    apply((p) => setPositions(p, fi, targets), 'Nudge');
  }

  function pickTool(b: ToolButton) {
    if (!b.tool) {
      kitSheet = true;
      return;
    }
    if (b.tool.id === 'add' && b.tool.kind === 'player' && sameTool(b.tool, tool)) {
      group = ({ A: 'B', B: 'C', C: 'D', D: 'A' } as const)[group];
      announce(`Player bib ${group}`);
      return;
    }
    tool = b.tool;
    if (b.tool.id !== 'select') selected = selected.slice(0, 1);
    announce(b.label);
    repaint();
  }

  // ---------------------------------------------------------------------------------- keyboard
  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (document.querySelector('dialog[open]')) return;
    const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    if (typing) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    if (menu && k === 'Escape') {
      menu = null;
      return;
    }
    if (mod && k.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && k.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && k.toLowerCase() === 'd') {
      e.preventDefault();
      dupFrame();
      return;
    }
    if (mod || e.altKey) return;
    const onToken = !!t.dataset?.token;
    if (k === ' ' && (t.tagName !== 'BUTTON' || onToken)) {
      e.preventDefault();
      togglePreview();
      return;
    }
    if (k === '?') {
      keysSheet = true;
      return;
    }
    if (k === 'Escape') {
      if (selected.length) selected = [];
      else tool = { id: 'select' };
      repaint();
      return;
    }
    if (k.startsWith('Arrow')) {
      const step = e.shiftKey ? 1 : 0.25;
      if (
        selected.length &&
        (onToken || t === canvas || t === document.body || t.closest('.canvas-wrap'))
      ) {
        e.preventDefault();
        if (k === 'ArrowLeft') nudge(-step, 0);
        if (k === 'ArrowRight') nudge(step, 0);
        if (k === 'ArrowUp') nudge(0, -step);
        if (k === 'ArrowDown') nudge(0, step);
        return;
      }
      if (
        !selected.length &&
        (k === 'ArrowLeft' || k === 'ArrowRight') &&
        t.getAttribute('role') !== 'radio'
      ) {
        if (t.tagName === 'INPUT') return;
        e.preventDefault();
        selectFrame(fi + (k === 'ArrowLeft' ? -1 : 1));
        announce(`Frame ${fi + 1} of ${play.frames.length}`);
      }
      return;
    }
    if ((k === 'Delete' || k === 'Backspace') && selected.length) {
      e.preventDefault();
      // Shift+Delete removes just this frame's move; Delete removes the token.
      if (e.shiftKey) clearSelectedMoves();
      else deleteSelected();
      return;
    }
    if (k === 'Enter' && onToken && one) {
      e.preventDefault();
      openProps();
      return;
    }
    const map: Record<string, string> = {
      v: 'select',
      a: 'attack',
      d: 'defence',
      b: 'ball',
      r: 'run',
      p: 'pass',
      k: 'kick',
      t: 'text',
    };
    const key = map[k.toLowerCase()];
    if (key) {
      const b =
        (drill ? DRILL_TOOLS : PLAY_TOOLS).find((x) => x.key === key) ??
        PLAY_TOOLS.find((x) => x.key === key);
      if (b) {
        e.preventDefault();
        pickTool(b);
      }
      return;
    }
    if (k.toLowerCase() === 'n') {
      e.preventDefault();
      newFrame();
    }
  }

  async function openProps() {
    if (desktop) {
      await tick();
      document.querySelector<HTMLElement>('.panel input, .panel select, .panel textarea')?.focus();
    } else tokenSheet = true;
  }

  // ---------------------------------------------------------------------------------- presets / drills
  function usePreset(id: PresetId) {
    apply((p) => applyPreset(p, PRESETS[id].build()), 'Preset');
    selectFrame(0);
    resetZoom();
    presetSheet = false;
    toasts.undo(`${PRESETS[id].label} set`, () => undo());
  }
  function useTemplate(id: DrillTemplateId) {
    apply((p) => ({ ...DRILL_TEMPLATES[id].build(p.id), id: p.id, title: p.title }), 'Template');
    selectFrame(0);
    resetZoom();
    presetSheet = false;
    toasts.undo(`${DRILL_TEMPLATES[id].label} set`, () => undo());
  }
  function addPlayersNow(e: SubmitEvent) {
    e.preventDefault();
    const vp = stage?.baseViewport(play) ?? { x: 0, y: 0, w: 20, h: 20 };
    const at = layoutStart(vp);
    apply(
      (p) =>
        addPlayersOp(p, addN, addLayout, at, addKind === 'player' ? group : undefined, addKind),
      `Add ${addN} players`,
    );
    playersSheet = false;
    announce(`${addN} players added`);
  }
  function layoutStart(vp: { x: number; y: number; w: number; h: number }): Vec2 {
    const c = { x: vp.x + vp.w / 2, y: vp.y + vp.h / 2 };
    if (addLayout === 'grid') return c;
    return { x: c.x - ((addN - 1) * 1.5) / 2, y: c.y };
  }
  function toggleLoop() {
    apply((p) => ({ ...p, loop: !p.loop }), 'Loop');
  }

  // ---------------------------------------------------------------------------------- lifecycle
  onMount(() => {
    if (!canvas || !wrap) return;
    stage = new Stage(canvas, { accent: app.team?.colors.primary, padding: 12 });
    const mq = matchMedia('(min-width: 900px)');
    desktop = mq.matches;
    const onMq = () => (desktop = mq.matches);
    mq.addEventListener('change', onMq);
    const ro = new ResizeObserver(([en]) => {
      if (!en || !stage) return;
      stage.resize(en.contentRect.width, en.contentRect.height);
      viewRev++;
      stage.orientation = bestOrientation(
        stage.baseViewport(play),
        stage.canvas.width,
        stage.canvas.height,
      );
      applyView();
      paint();
    });
    ro.observe(wrap);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', onMq);
      canvas?.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(previewRaf);
      cancelAnimationFrame(pending);
    };
  });

  // The view (e.g. a preset changes it) resets zoom and orientation.
  let viewKey = '';
  $effect(() => {
    const k = `${play.view}|${play.background?.kind}|${play.background?.w}|${play.background?.h}|${play.viewport?.w}`;
    if (k !== viewKey) {
      viewKey = k;
      if (stage) {
        stage.orientation = bestOrientation(
          stage.baseViewport(play),
          stage.canvas.width,
          stage.canvas.height,
        );
        zoom = 1;
        center = null;
        applyView();
        repaint();
      }
    }
  });

  $effect(() => {
    void [selected, tool, fi, snap];
    repaint();
  });

  const frameDesc = $derived(describeFrame(play, fi, names));
  const canvasLabel = $derived(
    `${title || 'Diagram'} pitch, frame ${fi + 1} of ${play.frames.length}. ${tools.find((b) => sameTool(b.tool ?? { id: 'select' }, tool))?.label ?? 'Select'} tool. Use the token list to edit with the keyboard.`,
  );
  /** CSS px of a pitch point relative to the canvas (exposed on the token list for tools/tests). */
  function screenOf(p: Vec2 | undefined) {
    void viewRev;
    if (!p || !stage || !stage.cssW) return undefined;
    const s = stage.toCss(play, p);
    return { x: Math.round(s.x), y: Math.round(s.y) };
  }
  const holderNow = $derived(resolvedBall(play, fi)?.holder);
  const positions = $derived(resolvedPositions(play, fi));
</script>

<svelte:window onkeydown={onKey} />

<div class="editor" class:desktop>
  <header class="bar">
    <button class="ib" onclick={onclose} aria-label="Done editing"><IconX /></button>
    <button class="titlebtn" onclick={ondetails}>
      <span class="t truncate">{title || 'Untitled'}</span>
      <span class="s" aria-live="polite">{status}</span>
    </button>
    <div class="baracts">
      <button
        class="ib"
        aria-pressed={snap}
        onclick={() => (snap = !snap)}
        aria-label="Snap to {drill ? 'metres' : 'pitch lines'}"
        title="Snap"><IconMagnet /></button
      >
      <button
        class="ib"
        onclick={() => (presetSheet = true)}
        aria-label={drill ? 'Templates' : 'Presets'}
        title={drill ? 'Templates' : 'Presets'}><IconTemplate /></button
      >
      {#if drill}
        <button
          class="ib"
          onclick={() => (playersSheet = true)}
          aria-label="Add players"
          title="Add players"><IconUsers /></button
        >
      {/if}
      <button
        class="ib hide-m"
        onclick={() => (keysSheet = true)}
        aria-label="Keyboard shortcuts"
        title="Shortcuts (?)"><IconKeyboard /></button
      >
      <button class="ib" onclick={ondetails} aria-label="Details" title="Details"
        ><IconSettings /></button
      >
    </div>
  </header>

  <nav class="tools" aria-label="Tools">
    <div class="tscroll">
      {#each tools as b (b.key)}
        {@const on = b.tool
          ? sameTool(b.tool, tool)
          : tool.id === 'add' &&
            EQUIPMENT_KINDS.some((k) => k.kind === tool.kind) &&
            !tools.some((x) => x.tool && sameTool(x.tool, tool))}
        <button
          class="tool"
          aria-pressed={on}
          onclick={() => pickTool(b)}
          title="{b.label}{b.shortcut ? ` (${b.shortcut})` : ''}"
        >
          <b.icon />
          <span>{b.key === 'player' ? `Player ${group}` : b.short}</span>
        </button>
      {/each}
    </div>
    <div class="ur">
      <button class="tool" onclick={undo} disabled={!canUndo} aria-label="Undo"
        ><IconUndo /><span>Undo</span></button
      >
      <button class="tool" onclick={redo} disabled={!canRedo} aria-label="Redo"
        ><IconRedo /><span>Redo</span></button
      >
    </div>
  </nav>

  <div class="canvas-wrap" bind:this={wrap}>
    <div
      class="surface"
      role="application"
      aria-roledescription="pitch editor"
      aria-label={canvasLabel}
      aria-describedby="ed-frame-desc"
    >
      <canvas
        bind:this={canvas}
        tabindex="-1"
        onpointerdown={onDown}
        onpointermove={onMove}
        onpointerup={onUp}
        onpointercancel={() => {
          pointers.clear();
          cancelGesture();
          repaint();
        }}
        oncontextmenu={onContext}
      ></canvas>
    </div>
    <p id="ed-frame-desc" class="sr-only">{frameDesc}</p>
    <ul class="sr-only" aria-label="Tokens on the pitch">
      {#each play.entities as e (e.id)}
        {@const p = positions[e.id]}
        {@const c = screenOf(
          e.id === play.entities.find((x) => x.kind === 'ball')?.id ? undefined : p,
        )}
        <li>
          <button
            data-token={e.id}
            data-x={c?.x}
            data-y={c?.y}
            aria-pressed={selected.includes(e.id)}
            onfocus={() => {
              if (!selected.includes(e.id)) selected = [e.id];
              repaint();
            }}
            onclick={() => {
              selected = [e.id];
              repaint();
            }}
          >
            {entityLabel(e, names)}{holderNow === e.id ? ', has the ball' : ''}{p
              ? `, ${placeLabel(play, p)}`
              : ''}
          </button>
        </li>
      {/each}
    </ul>
    <div class="sr-only" aria-live="polite">{live}</div>

    {#if one && oneEntity && !desktop}
      <div class="selbar" role="toolbar" aria-label="Selected token">
        <span class="truncate">{label(one)}</span>
        <button onclick={() => (tokenSheet = true)} aria-label="Edit {label(one)}"
          ><IconEdit /></button
        >
        {#if oneEntity.kind !== 'ball'}<button
            onclick={duplicateSelected}
            aria-label="Duplicate {label(one)}"><IconCopy /></button
          >{/if}
        <button onclick={deleteSelected} aria-label="Delete {label(one)}"><IconTrash /></button>
      </div>
    {/if}
    {#if zoomed}
      <button class="zoomreset" onclick={resetZoom} aria-label="Fit pitch"><IconScan /></button>
    {/if}
    <button
      class="fab"
      onclick={togglePreview}
      aria-label={previewing ? 'Stop preview' : 'Preview play'}
    >
      {#if previewing}<IconPause />{:else}<IconPlay />{/if}
    </button>

    {#if menu}
      <div
        class="menu"
        tabindex="-1"
        role="menu"
        aria-label="Token actions"
        style:left="{menu.x}px"
        style:top="{menu.y}px"
        onkeydown={(e) => {
          const items = [
            ...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role=menuitem]'),
          ];
          const i = items.indexOf(document.activeElement as HTMLElement);
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            items[(i + 1) % items.length]?.focus();
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            items[(i - 1 + items.length) % items.length]?.focus();
          }
          if (e.key === 'Escape') {
            menu = null;
            canvas?.focus();
          }
        }}
      >
        <button
          role="menuitem"
          onclick={() => {
            menu = null;
            void openProps();
          }}>Properties</button
        >
        {#if isPerson(play.entities.find((x) => x.id === menu?.id)?.kind ?? 'cone')}
          <button
            role="menuitem"
            onclick={() => {
              const id = menu!.id;
              menu = null;
              apply((p) => giveBall(p, fi, id), 'Give ball');
            }}>Give ball</button
          >
        {/if}
        {#if menu && hasMove(play, fi, menu.id)}
          <button role="menuitem" onclick={clearSelectedMoves}
            >{play.entities.find((x) => x.id === menu?.id)?.kind === 'ball'
              ? 'Remove pass or kick'
              : 'Remove this move'}</button
          >
        {/if}
        <button role="menuitem" onclick={duplicateSelected}>Duplicate</button>
        <button role="menuitem" class="danger" onclick={deleteSelected}
          >{isPerson(play.entities.find((x) => x.id === menu?.id)?.kind ?? 'cone')
            ? 'Delete player'
            : 'Delete'}</button
        >
      </div>
    {/if}
  </div>

  <section class="frames" aria-label="Frames">
    <div class="strip-row">
      <div class="strip" role="group" aria-label="Frames">
        {#each play.frames as f, i (f.id)}
          <button
            aria-pressed={i === fi && scrubT === null}
            class="frame"
            onclick={() => {
              if (i === fi && !desktop) frameSheet = true;
              else selectFrame(i);
            }}
            aria-label="Frame {i + 1}{f.caption ? `: ${f.caption}` : ''}{i > 0
              ? `, ${(f.durationMs / 1000).toFixed(1)} seconds`
              : ', start'}"
          >
            <strong>{i + 1}</strong>
            <small>{i === 0 ? 'Start' : `${(f.durationMs / 1000).toFixed(1)}s`}</small>
          </button>
        {/each}
      </div>
      <!-- Outside the scrolling strip so it's always fully visible and never clipped. -->
      <button class="frame add" onclick={newFrame} aria-label="Add frame"
        ><IconPlus /><small>Frame</small></button
      >
    </div>
    {#if desktop}
      <div class="timeline">
        <button
          class="ib"
          onclick={togglePreview}
          aria-label={previewing ? 'Stop preview' : 'Preview play'}
          >{#if previewing}<IconPause />{:else}<IconPlay />{/if}</button
        >
        <input
          type="range"
          min="0"
          max={Math.max(1, total)}
          step="10"
          value={scrubT ?? times[fi] ?? 0}
          aria-label="Scrub the timeline"
          oninput={(e) => {
            if (previewing) stopPreview();
            scrubT = Number(e.currentTarget.value);
            paint(scrubT);
          }}
          onchange={(e) => {
            const t = Number(e.currentTarget.value);
            let best = 0;
            times.forEach((x, i) =>
              Math.abs(x - t) < Math.abs((times[best] ?? 0) - t) ? (best = i) : 0,
            );
            selectFrame(best);
          }}
        />
        <span class="tnum subtle"
          >{((scrubT ?? times[fi] ?? 0) / 1000).toFixed(1)} / {(total / 1000).toFixed(1)} s</span
        >
      </div>
    {/if}
  </section>

  {#if desktop}
    <aside class="panel" aria-label="Properties">
      {#if one}
        <TokenPanel
          {play}
          {fi}
          id={one}
          members={players}
          {apply}
          onduplicate={duplicateSelected}
          ondelete={deleteSelected}
        />
      {:else if selected.length > 1}
        <h3>{selected.length} selected</h3>
        <div class="row wrap">
          <Button size="sm" onclick={duplicateSelected}
            >{#snippet icon()}<IconCopy />{/snippet}Duplicate</Button
          >
          <Button size="sm" variant="danger" onclick={deleteSelected}
            >{#snippet icon()}<IconTrash />{/snippet}Delete</Button
          >
        </div>
        <p class="subtle">Drag any of them, or nudge with the arrow keys.</p>
      {:else}
        <FramePanel {play} {fi} {apply} select={selectFrame} />
        <hr />
        <label class="check"
          ><input type="checkbox" checked={!!play.loop} onchange={toggleLoop} /> Loop playback</label
        >
        <p class="subtle hint">
          Tip: drag on empty grass to select several tokens. Right-click a token for more.
        </p>
      {/if}
    </aside>
  {/if}
</div>

<Sheet bind:open={tokenSheet} title={one ? label(one) : 'Token'} size="sm">
  {#if one}
    <TokenPanel
      {play}
      {fi}
      id={one}
      members={players}
      {apply}
      onduplicate={() => {
        duplicateSelected();
        tokenSheet = false;
      }}
      ondelete={deleteSelected}
    />
  {/if}
</Sheet>

<Sheet bind:open={frameSheet} title="Frame {fi + 1}" size="sm">
  <FramePanel
    {play}
    {fi}
    {apply}
    select={(i) => {
      selectFrame(i);
    }}
  />
  <label class="check"
    ><input type="checkbox" checked={!!play.loop} onchange={toggleLoop} /> Loop playback</label
  >
</Sheet>

<Sheet
  bind:open={presetSheet}
  title={drill ? 'Start from a template' : 'Start from a preset'}
  description="Replaces the current diagram. You can undo."
  size="md"
>
  <div class="choices">
    {#if drill}
      {#each Object.entries(DRILL_TEMPLATES).filter( ([k]) => shownTemplate(`drill:${k}`) ) as [id, t] (id)}
        <button class="choice" onclick={() => useTemplate(id as DrillTemplateId)}>{t.label}</button>
      {/each}
    {:else}
      {#each Object.entries(PRESETS).filter(([k]) => shownTemplate(`preset:${k}`)) as [id, p] (id)}
        <button class="choice" onclick={() => usePreset(id as PresetId)}>{p.label}</button>
      {/each}
    {/if}
  </div>
</Sheet>

<Sheet
  bind:open={kitSheet}
  title="Equipment"
  description="Pick an item, then tap the grass to place it."
  size="sm"
>
  <div class="choices">
    {#each EQUIPMENT_KINDS as k (k.kind)}
      <button
        class="choice"
        aria-pressed={tool.id === 'add' && tool.kind === k.kind}
        onclick={() => {
          tool = { id: 'add', kind: k.kind };
          kitSheet = false;
          announce(`Placing ${k.label.toLowerCase()}`);
        }}>{k.label}</button
      >
    {/each}
  </div>
</Sheet>

<Sheet bind:open={playersSheet} title="Add players" size="sm">
  <form class="stack" onsubmit={addPlayersNow}>
    <label class="fld">How many <input type="number" min="1" max="40" bind:value={addN} /></label>
    <label class="fld"
      >Layout
      <select bind:value={addLayout}
        ><option value="line">Line</option><option value="grid">Grid</option></select
      >
    </label>
    <label class="fld"
      >Who
      <select bind:value={addKind}
        ><option value="player">Players (bib {group})</option><option value="attack"
          >Attackers</option
        ><option value="defence">Defenders</option></select
      >
    </label>
    <Button type="submit" variant="primary" block>Add {addN}</Button>
  </form>
</Sheet>

<Sheet bind:open={keysSheet} title="Keyboard shortcuts" size="sm">
  <dl class="keys">
    {#each SHORTCUTS as [k, v] (k)}<dt><kbd>{k}</kbd></dt>
      <dd>{v}</dd>{/each}
  </dl>
</Sheet>

<Sheet
  bind:open={textOpen}
  title={textSheet?.id ? 'Edit text' : 'Add text'}
  size="sm"
  onclose={() => (textSheet = null)}
>
  {#if textSheet}
    <form class="stack" onsubmit={saveText}>
      <label class="fld"
        >Text <input
          bind:value={textSheet.value}
          maxlength="80"
          placeholder="e.g. Gain line"
        /></label
      >
      <Button type="submit" variant="primary" block>{textSheet.id ? 'Save' : 'Add'}</Button>
    </form>
  {/if}
</Sheet>

<style>
  .editor {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto auto;
    grid-template-areas: 'bar' 'canvas' 'frames' 'tools';
    background: var(--bg);
    z-index: 1;
    padding-bottom: var(--safe-b);
  }
  .bar {
    grid-area: bar;
    display: flex;
    align-items: center;
    gap: var(--s-1);
    padding: calc(var(--safe-t) + 4px) var(--s-2) 4px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .ib {
    flex: none;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--text);
  }
  .ib:hover {
    background: var(--surface-2);
  }
  .ib[aria-pressed='true'] {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .ib :global(svg) {
    width: 20px;
    height: 20px;
  }
  .titlebtn {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    border: 0;
    background: transparent;
    padding: 2px var(--s-2);
    min-height: 44px;
    border-radius: var(--r-md);
    text-align: left;
  }
  .titlebtn .t {
    max-width: 100%;
    font-weight: 700;
  }
  .titlebtn .s {
    font-size: var(--t-12);
    color: var(--text-3);
  }
  .baracts {
    display: flex;
  }
  .canvas-wrap {
    grid-area: canvas;
    position: relative;
    overflow: hidden;
    background: #2f6b3a;
    min-height: 0;
  }
  .surface {
    position: absolute;
    inset: 0;
  }
  canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    outline: none;
    cursor: crosshair;
  }
  .fab {
    position: absolute;
    right: var(--s-4);
    bottom: var(--s-4);
    width: 56px;
    height: 56px;
    border-radius: var(--r-full);
    border: 0;
    background: var(--accent);
    color: var(--on-accent);
    box-shadow: var(--e-3);
    display: grid;
    place-items: center;
  }
  .fab :global(svg) {
    width: 24px;
    height: 24px;
  }
  .zoomreset {
    position: absolute;
    right: var(--s-4);
    top: var(--s-3);
    width: 44px;
    height: 44px;
    border-radius: var(--r-full);
    border: 0;
    background: rgb(12 16 13 / 0.7);
    color: #fff;
    display: grid;
    place-items: center;
  }
  .selbar {
    position: absolute;
    left: 50%;
    top: var(--s-3);
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    max-width: calc(100% - 120px);
    padding: 2px 2px 2px var(--s-3);
    border-radius: var(--r-full);
    background: rgb(12 16 13 / 0.82);
    color: #fff;
    font-size: var(--t-14);
    font-weight: 650;
    box-shadow: var(--e-2);
  }
  .selbar button {
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--r-full);
    background: transparent;
    color: #fff;
    display: grid;
    place-items: center;
  }
  .selbar :global(svg) {
    width: 18px;
    height: 18px;
  }
  .menu {
    position: absolute;
    z-index: 5;
    min-width: 180px;
    padding: var(--s-1);
    border-radius: var(--r-md);
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--e-3);
    display: flex;
    flex-direction: column;
  }
  .menu button {
    text-align: left;
    border: 0;
    background: transparent;
    min-height: 36px;
    padding: 0 var(--s-3);
    border-radius: var(--r-sm);
  }
  .menu button:hover,
  .menu button:focus-visible {
    background: var(--surface-2);
  }
  .menu .danger {
    color: var(--danger);
  }
  .frames {
    grid-area: frames;
    background: var(--surface);
    border-top: 1px solid var(--border);
  }
  .strip-row {
    display: flex;
    align-items: center;
  }
  .strip-row .strip {
    flex: 1;
    min-width: 0;
  }
  .strip {
    display: flex;
    gap: var(--s-2);
    overflow-x: auto;
    padding: var(--s-2) var(--s-3);
    scrollbar-width: none;
  }
  .frame {
    flex: none;
    min-width: 52px;
    height: 48px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    line-height: 1.1;
  }
  .frame small {
    font-size: 11px;
    color: var(--text-2);
  }
  .frame[aria-pressed='true'] {
    background: var(--text);
    color: var(--bg);
    border-color: var(--text);
  }
  .frame[aria-pressed='true'] small {
    color: inherit;
  }
  .frame.add {
    border-style: dashed;
    color: var(--accent-text);
    font-weight: 650;
    padding: 0 var(--s-2);
    margin: var(--s-2) var(--s-3) var(--s-2) 0;
  }
  .frame.add :global(svg) {
    width: 16px;
    height: 16px;
  }
  .tools {
    grid-area: tools;
    display: flex;
    align-items: stretch;
    background: var(--surface);
    border-top: 1px solid var(--border);
  }
  .tscroll {
    flex: 1 1 auto;
    display: flex;
    overflow-x: auto;
    mask-image: linear-gradient(90deg, #000 calc(100% - 24px), transparent);
    scrollbar-width: none;
    padding: 2px var(--s-1);
  }
  .ur {
    flex: none;
    display: flex;
    border-left: 1px solid var(--border);
    padding: 2px var(--s-1);
  }
  .tool {
    flex: none;
    width: 58px;
    min-height: 56px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--text-2);
    font-size: 11px;
    font-weight: 650;
  }
  .tool :global(svg) {
    width: 22px;
    height: 22px;
  }
  .tool[aria-pressed='true'] {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .tool:disabled {
    opacity: 0.4;
  }
  .ur .tool {
    width: 50px;
  }
  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--s-2);
  }
  .choice {
    min-height: 48px;
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface);
    font-weight: 600;
    text-align: left;
  }
  .choice:hover,
  .choice[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent-softer);
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-weight: 650;
    font-size: var(--t-14);
  }
  .fld input,
  .fld select {
    min-height: 46px;
    padding: 10px 12px;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-size: var(--t-16);
    font-weight: 400;
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 44px;
    font-weight: 600;
  }
  .check input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
  .keys {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--s-2) var(--s-4);
    margin: 0;
  }
  .keys dd {
    margin: 0;
  }
  kbd {
    font: inherit;
    font-size: var(--t-12);
    font-weight: 700;
    padding: 2px 8px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border-strong);
    background: var(--surface-2);
    white-space: nowrap;
  }
  .hint {
    margin-top: var(--s-3);
  }
  hr {
    border: 0;
    border-top: 1px solid var(--border);
    margin: var(--s-4) 0 var(--s-2);
  }
  .panel h3 {
    font-size: var(--t-16);
  }

  /* ---------- Desktop ---------- */
  .desktop {
    grid-template-columns: 76px minmax(0, 1fr) 320px;
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'bar bar bar'
      'tools canvas panel'
      'tools frames panel';
  }
  .desktop .tools {
    flex-direction: column;
    border-top: 0;
    border-right: 1px solid var(--border);
  }
  .desktop .tscroll {
    mask-image: none;
    flex-direction: column;
    overflow-y: auto;
    padding: var(--s-2) var(--s-1);
    gap: 2px;
  }
  .desktop .ur {
    flex-direction: column;
    border-left: 0;
    border-top: 1px solid var(--border);
    padding: var(--s-2) var(--s-1);
  }
  .desktop .tool,
  .desktop .ur .tool {
    width: 66px;
  }
  .desktop .fab {
    display: none;
  }
  .desktop .frames {
    display: flex;
    flex-direction: column;
  }
  .timeline {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: 0 var(--s-3) var(--s-2);
  }
  .timeline input {
    flex: 1;
    accent-color: var(--accent);
    height: 32px;
  }
  .panel {
    grid-area: panel;
    overflow-y: auto;
    padding: var(--s-4);
    background: var(--surface);
    border-left: 1px solid var(--border);
  }
  @media (max-width: 899px) {
    .hide-m {
      display: none;
    }
  }
</style>
