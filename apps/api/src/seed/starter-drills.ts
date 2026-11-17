/**
 * The starter pack (16 generic drills) every new team gets (PLAN.md M5). Diagrams are generated
 * from the shared drill templates so they stay in sync with the renderer.
 */
import {
  uuidv7,
  type DrillCategory,
  type ContactLevel,
  type EquipmentList,
  type Play,
} from '@phaseplay/shared';
import { starterDiagram } from './starter-diagrams';

export type StarterDrill = {
  key: string;
  title: string;
  category: DrillCategory;
  contactLevel: ContactLevel;
  intensity: number;
  players: [number, number];
  area: [number, number];
  equipment: EquipmentList;
  minutes: number;
  description: string;
  setup: string;
  coachingPoints: string[];
  variations: string[];
};

export const STARTER_DRILLS: StarterDrill[] = [
  {
    key: 'dynamic-warmup',
    title: 'Dynamic warm-up (RAMP)',
    category: 'warmup',
    contactLevel: 'none',
    intensity: 2,
    players: [6, 40],
    area: [20, 20],
    equipment: { cones: 15, balls: 4 },
    minutes: 12,
    description:
      'RAMP warm-up: raise (jog, shuffles), activate and mobilise (lunges, leg swings, Activate balance and strength exercises), potentiate (build-ups to 90–100% and change of direction), then ball and contact readiness.',
    setup: 'Four 5 m lanes, 20 m long, cones at 0, 10 and 20 m. Waves of four.',
    coachingPoints: [
      'Raise → Activate/Mobilise → Potentiate',
      'Tall posture, quick feet',
      'Build intensity every rep — finish at 90–100%',
      'Use World Rugby Activate at least twice a week',
      'Add neck activation and falling technique before contact sessions',
    ],
    variations: [
      'Pass along the wave on every run',
      'Reaction starts on the whistle',
      'Pair push-pulls for contact readiness',
    ],
  },
  {
    key: 'triangle-passing',
    title: 'Triangle passing',
    category: 'handling',
    contactLevel: 'none',
    intensity: 2,
    players: [3, 12],
    area: [12, 12],
    equipment: { cones: 3, balls: 1 },
    minutes: 8,
    description: 'Three cones, continuous passing and following the pass.',
    setup: 'Triangle of cones 8–10 m apart (5–6 m for U12), two or more at each cone.',
    coachingPoints: [
      'Hands up early, show a target',
      'Pass across the body',
      'Step onto the ball and catch early, hands up',
    ],
    variations: ['Switch direction on the call', 'Add a second ball'],
  },
  {
    key: 'square-grid',
    title: 'Four-corner square',
    category: 'handling',
    contactLevel: 'none',
    intensity: 3,
    players: [8, 16],
    area: [10, 10],
    equipment: { cones: 4, balls: 2 },
    minutes: 10,
    description:
      'Pairs run up opposite sides of a 10 m square passing across, hand on at the far corner, and join that queue.',
    setup:
      '10 m square (8 m for U12), a queue of three at each corner, one ball (two once it flows).',
    coachingPoints: [
      'Receiver stays a metre deeper — pass sideways or back',
      'Hands up early, show a target',
      'Pass in front of the receiver',
    ],
    variations: [
      'Second ball starting at the opposite corner',
      'Offloads in contact with a shield holder at the corner',
    ],
  },
  {
    key: 'channel-passing',
    title: 'Channel passing lines',
    category: 'handling',
    contactLevel: 'none',
    intensity: 3,
    players: [3, 15],
    area: [15, 28],
    equipment: { cones: 8, balls: 2 },
    minutes: 10,
    description: 'Lines of three run the length of three 5 m channels, passing along the line.',
    setup: 'Three 5 m channels, 15 m wide × 28 m long. Waves start on the far line.',
    coachingPoints: [
      'Width and depth: receiver 1.5 m deeper than the passer',
      'Hips square, hands follow through to the target',
      'Run straight in your channel',
    ],
    variations: ['Miss passes', 'Introduce a defender halfway down'],
  },
  {
    key: 'tackle-tubes',
    title: 'Tackle technique on tubes',
    category: 'contact',
    contactLevel: 'shields',
    intensity: 3,
    players: [4, 20],
    area: [10, 10],
    equipment: { tackle_tubes: 4 },
    minutes: 10,
    description:
      'Low, safe tackle technique on tubes: approach, shoulder contact below the sternum, cheek to cheek, ring of steel, land on top, roll away.',
    setup: 'Four tubes in a line, 2.5 m apart. A tackler 4 m behind each tube, the rest queued.',
    coachingPoints: [
      'Target below the sternum — hip/thigh (check your union’s tackle-height law)',
      'Eyes open, head to the side (cheek to cheek)',
      'Short steps, then leg drive',
      'Arms wrap tight (ring of steel), land on top, roll away',
    ],
    variations: [
      'Stage 1: kneeling-to-kneeling on a tube',
      'Stage 2: crouch start',
      'Stage 3: walking tackle',
      'Stage 4: jog tackle onto the tube',
      'Stage 5: side-on approach',
    ],
  },
  {
    key: 'tackle-box',
    title: '1v1 tackle box',
    category: 'contact',
    contactLevel: 'full',
    intensity: 4,
    players: [4, 16],
    area: [10, 10],
    equipment: { cones: 4, balls: 2 },
    minutes: 8,
    description:
      'Ball carrier and tackler in a 5 × 5 m box at walk, then jog, then match pace, through the Tackle Ready stages: track, prepare, connect, accelerate, finish.',
    setup:
      '5 × 5 m box of cones; carriers with balls at one end, tacklers at the other, coach on the side. Start at walking pace; full pace only after technique is consistent.',
    coachingPoints: [
      'Target below the sternum (check your union’s tackle-height law)',
      'Eyes open, head to the side',
      'Close the space fast, then short steps',
      'Dominant shoulder, arms wrap, leg drive',
      'Carrier: low body height, protect the ball, place it back',
    ],
    variations: ['Two tacklers, one carrier', 'Carrier must place the ball after contact'],
  },
  {
    key: 'ruck-lanes',
    title: 'Ruck-clearing lanes',
    category: 'breakdown',
    contactLevel: 'shields',
    intensity: 4,
    players: [6, 18],
    area: [15, 14],
    equipment: { tackle_shields: 3, tackle_bags: 3, balls: 3, cones: 8 },
    minutes: 10,
    description:
      'A tackle bag is the tackled player with the ball placed back; the support player clears a shield holder off the ball.',
    setup: 'Three 5 m lanes, a bag, ball and shield holder at each ruck point. Clearers 5 m back.',
    coachingPoints: [
      'Enter through the gate, from behind the ball',
      'Shorten your steps before contact',
      'Shoulders above hips (law)',
      'Bind — don’t flop or dive',
      'Drive through, not down',
    ],
    variations: ['Defender contests the ball', 'Two rucks in a row', 'Arrive in pairs'],
  },
  {
    key: 'jackal',
    title: 'Jackal vs clear-out',
    category: 'breakdown',
    contactLevel: 'shields',
    intensity: 4,
    players: [6, 18],
    area: [15, 12],
    equipment: { balls: 3, tackle_shields: 3, tackle_bags: 3, cones: 8 },
    minutes: 10,
    description:
      'Defender (jackal) tries to win the ball at a tackle; attacking support arrives to clear them. Progress from shield to live.',
    setup:
      'Three 5 m lanes. Bag lying across each lane as the tackled player, ball placed back. Jackal 3 m away on the defending side, clearer 6 m away on the attacking side. Shields for stages 1–2; live (full contact) only at stage 3+.',
    coachingPoints: [
      'Jackal: arrive first, through your own gate, feet behind the ball, hands straight on the ball, lift immediately',
      'Jackal: on your feet, support your own weight, hands on before the ruck forms',
      'Hips low, shoulders above hips for everyone (law)',
      'Clearer: target the jackal’s chest/ribs below the neck, bind, drive up and through',
      'No neck rolls, no crocodile roll, no contact to the head',
      'Referee call “ruck — hands off”: release unless your hands were on first',
    ],
    variations: [
      'Stage 1: walk-through, clearer drives a shield held on the jackal’s chest',
      'Stage 2: ½ pace with the shield',
      'Stage 3: live 1v1 at ¾ pace',
      '2 clearers v 1 jackal',
      '2 v 2 with counter-ruck',
    ],
  },
  {
    key: '2v1',
    title: '2 v 1 overload',
    category: 'attack',
    contactLevel: 'touch',
    intensity: 3,
    players: [3, 15],
    area: [10, 22],
    equipment: { cones: 4, balls: 2 },
    minutes: 8,
    description: 'Two attackers fix and beat one defender in a narrow channel.',
    setup:
      'Channel 10 m wide, 22 m long. Attackers start at one end; the defender starts on the try-zone line, about 15 m away.',
    coachingPoints: [
      'Fix the defender, run at the inside shoulder',
      'Pass late, but not too late',
      'Pass must go sideways or back — support stays deeper',
      'Support runner holds width',
    ],
    variations: ['Defender can start from the side', 'Two-hand touch only'],
  },
  {
    key: '3v2',
    title: '3 v 2 overload',
    category: 'attack',
    contactLevel: 'touch',
    intensity: 4,
    players: [5, 20],
    area: [15, 22],
    equipment: { cones: 4, balls: 2 },
    minutes: 10,
    description: 'Three attackers against two defenders: find and use the extra player.',
    setup:
      'Channel 15 m wide, 22 m long. Defenders start on the try-zone line and pass to the attack. Groups of five rotate roles.',
    coachingPoints: [
      'Talk: who has the space?',
      'Draw and pass',
      'Square up before passing',
      'Receivers stay deeper than the passer',
    ],
    variations: ['4 v 3', 'Defenders start at different depths'],
  },
  {
    key: 'line-speed',
    title: 'Defensive line speed',
    category: 'defence',
    contactLevel: 'touch',
    intensity: 3,
    players: [10, 14],
    area: [30, 22],
    equipment: { cones: 8, balls: 1, bibs: 6 },
    minutes: 10,
    description:
      'A defensive line moves up together on the 9’s pass, holding connection and arriving balanced.',
    setup:
      'Ruck cone 4 m in from the left edge. Defense of five on the offside line beside it; attack of six (a 9 and five runners) set 4–8 m deeper than the ruck.',
    coachingPoints: [
      'Go on the ball, not before (offside)',
      'Inside defender leads the line speed; inside shoulder, stay connected',
      'Talk: “Up! Up!”, “I’ve got 10”, “In”',
      'Short steps last 3 m — arrive balanced, tackle below the sternum',
      'Fold round the ruck and get back onside fast',
    ],
    variations: [
      'Drift: outside defender pushes out and passes their attacker on',
      'Blitz: 12 and 13 shoot on the second receiver',
      'Attack may kick: wing drops',
      'Score: gain line held after three passes',
    ],
  },
  {
    key: 'lineout-throwing',
    title: 'Lineout throwing accuracy',
    category: 'set_piece',
    contactLevel: 'none',
    intensity: 2,
    players: [2, 8],
    area: [16, 10],
    equipment: { balls: 6, poles: 3, cones: 2 },
    minutes: 10,
    description: 'Hookers throw to targets at the front, middle and back of the lineout.',
    setup:
      'Poles (or a held tackle shield) at 7, 10 and 13 m from touch, at about 3.5 m height, the height of a lifted jumper’s hands. Cone the 5 m and 15 m lines.',
    coachingPoints: [
      'Same routine every throw',
      'Spiral, follow through to the target',
      'Throw straight down the line of touch — not straight = opposition throw or scrum',
      'Tempo calls with the jumper',
    ],
    variations: [
      'Throw to a lifted jumper (pod of three) — see “Lineout pod”',
      'Throw under fatigue',
    ],
  },
  {
    key: 'lineout-pod',
    title: 'Lineout pod — throw, lift, catch',
    category: 'set_piece',
    contactLevel: 'none',
    intensity: 3,
    players: [5, 16],
    area: [16, 12],
    equipment: { balls: 6, cones: 6, tackle_shields: 3 },
    minutes: 15,
    description:
      'A pod of front lifter, jumper and back lifter wins the hooker’s throw, then sets the maul.',
    setup:
      'Touchline on the left. Cones on the 5 m and 15 m lines at the line of touch. Pod 6–8 m from touch, 9 two metres back. Stations of hooker, front lifter, jumper, back lifter and 9; optionally 3 defenders with shields.',
    coachingPoints: [
      'Same throwing routine every time',
      'Lift on the jumper’s push; lower safely — hold until feet are down (Law 18)',
      'Jumper: two hands, high, then protect the ball',
      'Check your union’s age-grade rules on lifting before teaching it',
    ],
    variations: [
      'Middle (10 m) and back (13 m) targets',
      'Add a contesting pod',
      'Live maul v 3 shields (contact)',
    ],
  },
  {
    key: 'box-kick-chase',
    title: 'Box kick — chase and catch',
    category: 'kicking',
    contactLevel: 'none',
    intensity: 3,
    players: [4, 12],
    area: [30, 40],
    equipment: { balls: 6, cones: 6 },
    minutes: 12,
    description:
      'The scrum-half (9) box-kicks from a ruck; chasers compete for the high ball and a receiver catches.',
    setup:
      'Touchline on the left. Ruck cone 12 m in from touch. Landing-zone cones 10–15 m in from touch, about 25 m downfield. Chasers start behind the kicker.',
    coachingPoints: [
      'Hang time over distance (aim 4+ s, land 10–15 m in from touch)',
      'Chasers onside, then sprint',
      'Chaser times the jump to compete for the ball, not the player',
      'No taking players in the air (Law 9)',
      'Receiver calls early, gets side-on, catches above the head, lands balanced',
    ],
    variations: [
      'Kick off the non-preferred foot',
      'Add a receiver to compete (seniors; check age-grade rules on aerial contests) — contact level becomes touch',
      'Exit from inside your 22 under pressure',
    ],
  },
  {
    key: 'shuttles',
    title: 'Conditioning shuttles',
    category: 'conditioning',
    contactLevel: 'none',
    intensity: 5,
    players: [4, 40],
    area: [10, 20],
    equipment: { cones: 8 },
    minutes: 8,
    description:
      'Shuttle to 5, 10 and 15 m and back (60 m per rep). 6–10 reps, work:rest about 1:2.',
    setup: 'Cones at 0, 5, 10 and 15 m, players in waves.',
    coachingPoints: [
      'Touch every line with your hand',
      'Low turns, drive out',
      'Same effort every set',
    ],
    variations: ['Long version: 10, 20, 30 and 40 m and back', 'Add a ball pick-up at each line'],
  },
  {
    key: 'touch-game',
    title: 'Touch rugby game',
    category: 'game',
    contactLevel: 'touch',
    intensity: 3,
    players: [8, 24],
    area: [25, 35],
    equipment: { cones: 8, balls: 1, bibs: 15 },
    minutes: 15,
    description: 'Conditioned touch (or flag) game to finish: six touches and turnover.',
    setup:
      'About 25 × 35 m for 5 v 5, 35 × 50 m for 8 v 8, half a pitch for 12 v 12+. Cones and 3 m try zones; two bibbed teams.',
    coachingPoints: ['Scan, then call', 'Width and depth in attack', 'Line speed in defense'],
    variations: [
      'Touch = 2-second ruck: the defense must retreat 5 m',
      'Flag rugby: a flag pull counts as a touch',
      'Only offloads score bonus points',
    ],
  },
];

/** Starter drill rows for a new team (inserted with one bulk statement). */
export function starterDrillRows(teamId: string, t: number): Record<string, unknown>[] {
  return STARTER_DRILLS.map((d, i) => {
    const diagram: Play | null = starterDiagram(d.key);
    return {
      id: uuidv7(t + i),
      team_id: teamId,
      title: d.title,
      category: d.category,
      contact_level: d.contactLevel,
      intensity: d.intensity,
      players_min: d.players[0],
      players_max: d.players[1],
      area: JSON.stringify({ w: d.area[0], h: d.area[1] }),
      equipment: JSON.stringify(d.equipment),
      default_duration_min: d.minutes,
      description: d.description,
      coaching_points: JSON.stringify(d.coachingPoints),
      setup: d.setup,
      variations: JSON.stringify(d.variations),
      diagram: diagram ? JSON.stringify(diagram) : null,
      visibility: 'team',
      source: 'starter',
      version: 1,
      created_by: null,
      created_at: t,
      updated_at: t,
    };
  });
}
