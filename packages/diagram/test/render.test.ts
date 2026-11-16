import { ENTITY_KINDS, type Play } from '@phaseplay/shared';
import { describe, expect, it } from 'vitest';
import { DRILL_TEMPLATES } from '../src/drill-templates';
import { draw } from '../src/draw';
import { renderMatchReport, type MatchReportInput } from '../src/export/match-report';
import { PAPER_PX, renderDrillCard, renderPlayImage } from '../src/export/png';
import { renderTeamSheet, type TeamSheetInput } from '../src/export/sheet';
import { exportVideo } from '../src/export/video';
import { handleVideoRequest } from '../src/videoWorker';
import { clearPitchLayers, drawPitch, getPitchLayer } from '../src/pitch';
import { newPlay } from '../src/presets';
import { sample } from '../src/sample';
import { THEMES } from '../src/themes';
import { makeTransform, playViewport } from '../src/viewport';
import { mockContext, mockFactory } from './mock-canvas';

/** A play containing one entity of every kind, moving between two frames. */
function everyKind(): Play {
  const entities = ENTITY_KINDS.map((kind, i) => ({
    id: `e${i}`,
    kind,
    number: i % 3 === 0 ? i : undefined,
    group: (['A', 'B', 'C', 'D'] as const)[i % 4],
    text: kind === 'label' || kind === 'zone' || i % 5 === 0 ? `T${i}` : undefined,
    size:
      kind === 'zone' || kind === 'ladder' || kind === 'gate' || kind === 'scrum_machine'
        ? { w: 4, h: 2, rot: 30 }
        : undefined,
    memberId: i === 0 ? '00000000-0000-4000-8000-000000000000' : undefined,
  }));
  const pos = Object.fromEntries(
    entities.map((e, i) => [e.id, { x: 5 + (i % 6) * 10, y: 10 + Math.floor(i / 6) * 20 }]),
  );
  const pos2 = Object.fromEntries(
    entities.map((e, i) => [e.id, { x: 8 + (i % 6) * 10, y: 5 + Math.floor(i / 6) * 20 }]),
  );
  return {
    v: 1,
    id: 'kinds',
    mode: 'play',
    title: 'All kinds',
    format: '15s',
    view: 'full',
    entities: entities.map((e) =>
      Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)),
    ) as Play['entities'],
    frames: [
      { id: 'f0', durationMs: 0, pos, moves: {}, ball: { holder: 'e0' }, caption: 'Start here' },
      {
        id: 'f1',
        durationMs: 1000,
        pos: pos2,
        moves: {
          e0: { kind: 'run', ctrl: [{ x: 20, y: 0 }] },
          e1: { kind: 'pass' },
          e2: { kind: 'kick' },
        },
        ball: { holder: 'e1' },
        arrows: [
          { from: { x: 1, y: 1 }, to: { x: 10, y: 10 }, style: 'run' },
          { from: { x: 1, y: 1 }, to: { x: 10, y: 10 }, ctrl: [{ x: 5, y: 0 }], style: 'pass' },
          {
            from: { x: 1, y: 1 },
            to: { x: 10, y: 10 },
            ctrl: [
              { x: 5, y: 0 },
              { x: 8, y: 2 },
            ],
            style: 'kick',
          },
        ],
        caption: 'Go',
      },
    ],
  };
}

describe('draw', () => {
  const play = everyKind();
  for (const theme of Object.values(THEMES)) {
    for (const orientation of ['portrait', 'landscape'] as const) {
      it(`draws every entity kind (${theme.name}, ${orientation})`, () => {
        const t = makeTransform({
          viewport: playViewport(play),
          width: 600,
          height: 900,
          orientation,
        });
        for (const time of [0, 400, 1000]) {
          const { ctx, calls } = mockContext();
          draw(ctx, sample(play, time), {
            theme,
            transform: t,
            accent: '#c8102e',
            highlightMemberId: '00000000-0000-4000-8000-000000000000',
            showTrails: true,
          });
          expect(calls.length).toBeGreaterThan(100);
          const names = new Set(calls.map((c) => c.name));
          for (const m of ['arc', 'fillText', 'stroke', 'fill', 'ellipse', 'setLineDash'])
            expect(names.has(m)).toBe(true);
          // No save/restore storms: only drawPitch's single clip pair.
          expect(calls.filter((c) => c.name === 'save').length).toBeLessThanOrEqual(1);
        }
      });
    }
  }

  it('uses a cached pitch layer when given and skips the background otherwise', () => {
    clearPitchLayers();
    const { factory, created } = mockFactory();
    const t = makeTransform({
      viewport: playViewport(play),
      width: 300,
      height: 500,
      orientation: 'portrait',
    });
    const layer = getPitchLayer(t, THEMES.grass, undefined, factory);
    expect(getPitchLayer(t, THEMES.grass, undefined, factory)).toBe(layer);
    expect(created).toHaveLength(1);
    getPitchLayer(t, THEMES.print, undefined, factory);
    expect(created).toHaveLength(2);
    const { ctx, calls } = mockContext();
    draw(ctx, sample(play, 0), {
      theme: THEMES.grass,
      transform: t,
      accent: '#123456',
      pitchLayer: layer,
    });
    expect(calls[0]!.name).toBe('drawImage');
    const none = mockContext();
    draw(none.ctx, sample(play, 0), {
      theme: THEMES.grass,
      transform: t,
      accent: '#123456',
      pitchLayer: null,
    });
    expect(none.calls.some((c) => c.name === 'drawImage' || c.name === 'clip')).toBe(false);
  });

  it('draws drill backgrounds with dimension labels and a grid', () => {
    const drill = DRILL_TEMPLATES.gates.build();
    const t = makeTransform({
      viewport: playViewport(drill),
      width: 500,
      height: 500,
      orientation: 'portrait',
    });
    const { ctx, calls } = mockContext();
    drawPitch(ctx, t, THEMES.chalkboard, drill.background);
    const texts = calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
    expect(texts).toContain('20 m');
  });
});

describe('PNG exports', () => {
  const play = newPlay({
    id: 'x',
    title: 'Strike',
    mode: 'play',
    format: '15s',
    preset: 'lineout5',
  });
  const sizes = [
    ['1080x1080', 1080, 1080],
    ['1920x1080', 1920, 1080],
    ['1080x1920', 1080, 1920],
  ] as const;
  for (const [size, w, h] of sizes) {
    it(`renders a frame at ${size} × scale`, async () => {
      const { factory, created } = mockFactory();
      const blob = await renderPlayImage({
        play,
        frameIndex: 0,
        size,
        accent: '#c8102e',
        title: 'Lineout 5',
        monogram: { text: 'PRFC', bg: '#c8102e', fg: '#fff' },
        factory,
      });
      expect(created[0]!.width).toBe(w * 2);
      expect(created[0]!.height).toBe(h * 2);
      expect(blob.type).toBe('image/png');
      const texts = created[0]!.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
      expect(texts).toContain('phaseplay.app');
    });
  }

  it('renders a storyboard of every frame with captions', async () => {
    const drill = DRILL_TEMPLATES.overload3v2.build();
    const { factory, created } = mockFactory();
    await renderPlayImage({
      play: drill,
      frameIndex: 'storyboard',
      size: '1920x1080',
      scale: 1,
      theme: 'print',
      accent: '#0057b8',
      factory,
    });
    expect(created[0]!.width).toBe(1920);
    const texts = created[0]!.calls
      .filter((c) => c.name === 'fillText')
      .map((c) => String(c.args[0]));
    for (let i = 1; i <= drill.frames.length; i++) expect(texts).toContain(String(i));
    expect(texts.some((t) => t.startsWith('A1 fixes'))).toBe(true);
  });

  for (const paper of ['a4', 'letter'] as const) {
    it(`renders a drill card on ${paper}`, async () => {
      const { factory, created } = mockFactory();
      const drill = DRILL_TEMPLATES.squareGrid.build();
      const blob = await renderDrillCard({
        play: drill,
        title: 'Square passing',
        setup: 'Four cones, 10 m apart. Groups of three at each.',
        coachingPoints: ['Hands up early', 'Pass in front', 'Talk'],
        equipment: { cones: 4, balls: 1, bibs: 12 },
        meta: ['10 min', 'No contact', '8–16 players'],
        paper,
        factory,
      });
      expect(blob.type).toBe('image/png');
      expect(created[0]!.width).toBe(PAPER_PX[paper].w * 2);
      expect(created[0]!.height).toBe(PAPER_PX[paper].h * 2);
      const texts = created[0]!.calls
        .filter((c) => c.name === 'fillText')
        .map((c) => String(c.args[0]));
      expect(texts).toContain('COACHING POINTS');
      expect(texts.some((t) => t.startsWith('Cones × 4'))).toBe(true);
    });
  }
});

const team = {
  name: 'Phaseplay RFC',
  shortName: 'Phaseplay',
  primary: '#0b6e4f',
  secondary: '#f2c14e',
};

describe('team sheet', () => {
  const starters15 = Array.from({ length: 15 }, (_, i) => ({
    n: i + 1,
    name: `Player Number${i + 1} Surname`,
    captain: i === 3,
    vice: i === 5,
  }));
  const bench = Array.from({ length: 8 }, (_, i) => ({ n: 16 + i, name: `Bench Player ${i}` }));
  for (const [template, w, h] of [
    ['story', 1080, 1920],
    ['square', 1080, 1080],
    ['landscape', 1920, 1080],
  ] as const) {
    for (const format of ['15s', '7s'] as const) {
      it(`${template} ${format}`, async () => {
        const { factory, created } = mockFactory();
        const input: TeamSheetInput = {
          template,
          team,
          opponent: 'Riverside',
          kickoff: 'Sat 14 Mar · 15:00',
          venue: 'Home Park',
          format,
          starters: format === '15s' ? starters15 : starters15.slice(0, 7),
          bench: format === '15s' ? bench : bench.slice(0, 5),
        };
        const blob = await renderTeamSheet(input, { factory });
        expect(blob.type).toBe('image/png');
        expect([created[0]!.width, created[0]!.height]).toEqual([w, h]);
        const texts = created[0]!.calls
          .filter((c) => c.name === 'fillText')
          .map((c) => String(c.args[0]));
        expect(texts.join('|')).toContain('Team to play Riverside');
        expect(texts).toContain('C');
        expect(texts).toContain('VC');
        expect(texts).toContain(format === '15s' ? '15' : '7');
        expect(texts).toContain('REPLACEMENTS');
      });
    }
  }

  it('scales and copes with odd colours', async () => {
    const { factory, created } = mockFactory();
    await renderTeamSheet(
      {
        template: 'story',
        team: { ...team, primary: '#ffffff', secondary: '#ffffff' },
        kickoff: 'Sun',
        format: '7s',
        starters: [{ n: 9, name: 'Solo' }],
        bench: [],
      },
      { factory, scale: 0.5 },
    );
    expect([created[0]!.width, created[0]!.height]).toEqual([540, 960]);
  });
});

describe('match report', () => {
  const input: MatchReportInput = {
    template: 'square',
    team,
    opponent: 'Riverside RFC',
    score: { us: 24, them: 17 },
    result: 'Win',
    scorers: [
      { minute: 5, name: 'Jane Smith', type: 'try', team: 'us' },
      { minute: 6, name: 'Ana Lopez', type: 'con', team: 'us' },
      { minute: 22, name: 'Kim Riv', type: 'pen', team: 'them' },
      { minute: 61, name: 'Jo Bloggs', type: 'try', team: 'us' },
    ],
    cards: [
      { minute: 33, name: 'Sam Jones', colour: 'yellow', team: 'them' },
      { minute: 70, name: 'Lee Park', colour: 'red', team: 'us' },
    ],
    progression: [
      { minute: 5, us: 5, them: 0 },
      { minute: 6, us: 7, them: 0 },
      { minute: 22, us: 7, them: 3 },
      { minute: 61, us: 12, them: 3 },
      { minute: 79, us: 24, them: 17 },
    ],
    penalties: { for: 8, against: 11 },
    date: 'Sat 14 March 2026',
  };
  for (const [template, h] of [
    ['square', 1080],
    ['story', 1920],
  ] as const) {
    it(`${template}`, async () => {
      const { factory, created } = mockFactory();
      const blob = await renderMatchReport({ ...input, template }, { factory, scale: 2 });
      expect(blob.type).toBe('image/png');
      expect([created[0]!.width, created[0]!.height]).toEqual([2160, h * 2]);
      const texts = created[0]!.calls
        .filter((c) => c.name === 'fillText')
        .map((c) => String(c.args[0]));
      expect(texts).toContain('24–17');
      expect(texts).toContain('WIN');
      expect(texts.some((t) => t.includes('J. Smith'))).toBe(true);
      expect(texts.some((t) => t.includes('8 for'))).toBe(true);
      expect(texts).toContain('SCORE PROGRESSION');
    });
  }
});

describe('video', () => {
  const play = DRILL_TEMPLATES.overload2v1.build();
  it('falls back to GIF without WebCodecs or MediaRecorder and reports progress', async () => {
    const { factory, created } = mockFactory();
    const progress: number[] = [];
    const res = await exportVideo(play, {
      size: '1080x1920',
      accent: '#c8102e',
      factory,
      maxGifSide: 64,
      onProgress: (p) => progress.push(p),
    });
    expect(res.ext).toBe('gif');
    expect(res.mime).toBe('image/gif');
    expect(res.blob.size).toBeGreaterThan(0);
    const main = created.find((c) => c.width === 36 && c.height === 64);
    expect(main).toBeDefined();
    expect(progress.at(-1)).toBe(1);
    for (let i = 1; i < progress.length; i++)
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]!);
    const header = new Uint8Array(await res.blob.arrayBuffer()).slice(0, 6);
    expect(new TextDecoder().decode(header)).toBe('GIF89a');
  });

  it('cancels via AbortSignal', async () => {
    const { factory } = mockFactory();
    const ctrl = new AbortController();
    const p = exportVideo(play, {
      accent: '#c8102e',
      factory,
      maxGifSide: 64,
      signal: ctrl.signal,
      onProgress: (x) => x > 0.2 && ctrl.abort(),
    });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('worker handler replies with progress then an error/done message', async () => {
    const replies: { type: string }[] = [];
    // No canvas in node: the handler must report an error rather than throw.
    await handleVideoRequest(
      { type: 'export', play, options: { accent: '#c8102e', maxGifSide: 32 } },
      (m) => replies.push(m),
    );
    expect(replies.at(-1)!.type).toBe('error');
  });
});

describe('video via WebCodecs (faked encoder)', () => {
  it('encodes every frame and muxes an MP4', async () => {
    const g = globalThis as Record<string, unknown>;
    const saved = {
      VideoEncoder: g.VideoEncoder,
      VideoFrame: g.VideoFrame,
      OffscreenCanvas: g.OffscreenCanvas,
      EncodedVideoChunk: g.EncodedVideoChunk,
    };
    const frames: { timestamp: number; key: boolean }[] = [];
    class FakeChunk {
      byteLength = 4;
      duration = 100000;
      constructor(
        public type: string,
        public timestamp: number,
      ) {}
      copyTo(b: Uint8Array) {
        b.set([0, 0, 0, 1]);
      }
    }
    class FakeFrame {
      constructor(
        _src: unknown,
        public init: { timestamp: number },
      ) {}
      close() {}
    }
    class FakeEncoder {
      state = 'unconfigured';
      encodeQueueSize = 0;
      constructor(private o: { output: (c: unknown, m?: unknown) => void }) {}
      static async isConfigSupported(c: { codec: string }) {
        return { supported: c.codec === 'avc1.4d0028' };
      }
      configure() {
        this.state = 'configured';
      }
      encode(f: FakeFrame, opts: { keyFrame: boolean }) {
        frames.push({ timestamp: f.init.timestamp, key: opts.keyFrame });
        const chunk = new FakeChunk(opts.keyFrame ? 'key' : 'delta', f.init.timestamp);
        this.o.output(
          chunk,
          frames.length === 1
            ? {
                decoderConfig: {
                  codec: 'avc1.4d0028',
                  description: new Uint8Array([1, 77, 0, 40, 255]),
                },
              }
            : undefined,
        );
      }
      async flush() {}
      close() {
        this.state = 'closed';
      }
    }
    Object.assign(g, {
      VideoEncoder: FakeEncoder,
      VideoFrame: FakeFrame,
      OffscreenCanvas: class {},
      EncodedVideoChunk: FakeChunk,
    });
    try {
      const { factory } = mockFactory();
      const play = DRILL_TEMPLATES.overload2v1.build();
      const res = await exportVideo(play, {
        size: '1080x1080',
        fps: 10,
        accent: '#c8102e',
        factory,
        holdMs: 0,
      });
      expect(res.ext).toBe('mp4');
      expect(res.mime).toBe('video/mp4');
      expect(frames.length).toBe(Math.ceil((4000 / 1000) * 10));
      expect(frames[0]!.key).toBe(true);
      expect(frames[1]!.timestamp).toBe(100000);
      const head = new Uint8Array(await res.blob.arrayBuffer()).slice(4, 8);
      expect(new TextDecoder().decode(head)).toBe('ftyp');
    } finally {
      Object.assign(g, saved);
    }
  });
});
