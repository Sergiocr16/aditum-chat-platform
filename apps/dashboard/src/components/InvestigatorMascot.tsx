'use client';

import type { InvestigationPhase } from '@/lib/data-investigations';

export type MascotPose = 'queued' | 'resuming' | InvestigationPhase;

const CLAUDE = 'var(--color-claude)';
// Each prop takes the color of the thing it is: wood and sand, paper, a dark editor, a steel server.
const INK = 'var(--color-ink)';
const PAPER = 'var(--color-cream-0)';
const EDGE = 'var(--color-warm-gray-4)';
const STEEL = 'var(--color-warm-gray)';
const WOOD = 'var(--color-warn-dark)';
const GOLD = 'var(--color-gold)';
const GREEN = 'var(--color-ok)';

const HOLDS_PROP: Partial<Record<MascotPose, boolean>> = { preparing: true, files: true, code: true, resuming: true };

/** Paces while it thinks, hops when a piece of code lands or the answer arrives, leans in to read code. */
const WHOLE_MOTION: Partial<Record<MascotPose, string>> = {
  starting: 'mascot-pace',
  preparing: 'mascot-hop',
  resuming: 'mascot-nod',
  code: 'mascot-lean',
  database: 'mascot-answer',
};

/** Lifts to turn the page, pushes to send the query. */
const ARM_MOTION: Partial<Record<MascotPose, string>> = { files: 'mascot-arm-turn', database: 'mascot-arm-push' };

/** The mascot standing still, for where it only marks that Claude is behind something. */
export function ClaudeLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 16 32 20" className={`w-auto ${className ?? ''}`} aria-hidden>
      <g fill={CLAUDE}>
        <rect x="4" y="16" width="24" height="16" />
        <rect x="0" y="24" width="32" height="4" />
        {[6, 10, 20, 24].map((x) => <rect key={x} x={x} y="32" width="2" height="4" />)}
      </g>
      <g fill={INK}>
        <rect x="8" y="20" width="2" height="4" />
        <rect x="22" y="20" width="2" height="4" />
      </g>
    </svg>
  );
}

/**
 * Claude's pixel mascot, on a grid where one logo pixel is 2 units. Each pose acts out what the
 * investigation is really doing, with the prop on its right:
 * - queued: waits with half-closed eyes, tapping a foot, next to an hourglass.
 * - starting: paces looking up, thinking about the question, in a bubble.
 * - preparing: holds a folder that fills up, following the code that comes down from the cloud.
 * - resuming: goes over its own notebook, ticking and nodding at what it already knows, up to where it left off.
 * - files: reads a document and lifts its arm to turn each page.
 * - code: leans in with a magnifier over code that scrolls past, and what's under it lights up.
 * - database: pushes a query to a database, whose rows light up, and hops when the answer arrives.
 * The keyframes live in globals.css and stop under reduced motion.
 */
export function InvestigatorMascot({ pose, label, className }: { pose: MascotPose; label: string; className?: string }) {
  return (
    <svg key={pose} viewBox="0 0 50 38" className={`mascot-phase-in w-auto flex-none ${className ?? ''}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x="5" y="36" width="22" height="1" fill="var(--color-cream-3)" />

      {pose === 'files' && <FilesProp />}
      {pose === 'code' && <CodeProp />}
      {pose === 'preparing' && <PreparingProp />}
      {pose === 'resuming' && <NotebookProp />}
      {pose === 'database' && <DatabaseProp />}
      {pose === 'queued' && <Hourglass />}
      {pose === 'starting' && <ThoughtBubble />}

      <g className={WHOLE_MOTION[pose]}>
        <g fill={CLAUDE}>
          <rect className={pose === 'starting' ? 'mascot-step' : undefined} x="6" y="32" width="2" height="4" />
          <rect className={pose === 'starting' ? 'mascot-step mascot-step-2' : undefined} x="10" y="32" width="2" height="4" />
          <rect className={pose === 'starting' ? 'mascot-step' : undefined} x="20" y="32" width="2" height="4" />
          <rect
            className={pose === 'queued' ? 'mascot-tap' : pose === 'starting' ? 'mascot-step mascot-step-2' : undefined}
            x="24"
            y="32"
            width="2"
            height="4"
          />
        </g>

        <g className={pose === 'database' ? undefined : 'mascot-breathe'}>
          <rect x="4" y="16" width="24" height="16.5" fill={CLAUDE} />
          <rect x="0" y="24" width="4" height="4" fill={CLAUDE} />
          {/* Stretches out to whatever it's holding. */}
          <rect className={ARM_MOTION[pose]} x="28" y="24" width={HOLDS_PROP[pose] ? 7 : 4} height="4" fill={CLAUDE} />
          <Eyes pose={pose} />
        </g>
      </g>
    </svg>
  );
}

/** Where it looks is part of the story: up at the bubble, following the code down, across the page. */
function Eyes({ pose }: { pose: MascotPose }) {
  const pair = (y: number, height: number, shift = 0) => (
    <>
      <rect x={8 + shift} y={y} width="2" height={height} />
      <rect x={22 + shift} y={y} width="2" height={height} />
    </>
  );
  if (pose === 'queued') return <g fill={INK}>{pair(22, 2)}</g>;
  if (pose === 'starting') return <g className="mascot-eyes" fill={INK}>{pair(18, 4, 1)}</g>;
  if (pose === 'preparing') return <g className="mascot-follow" fill={INK}>{pair(20, 4)}</g>;
  if (pose === 'database') return <g className="mascot-eyes" fill={INK}>{pair(20, 4, 2)}</g>;
  return <g className="mascot-read" fill={INK}>{pair(20, 4)}</g>;
}

function Hourglass() {
  return (
    <g>
      <rect x="36" y="9" width="11" height="2" fill={WOOD} />
      <rect x="36" y="31" width="11" height="2" fill={WOOD} />
      <rect x="37" y="11" width="1" height="20" fill={EDGE} />
      <rect x="45" y="11" width="1" height="20" fill={EDGE} />
      <rect className="mascot-sand-top" x="39" y="12" width="5" height="7" fill={GOLD} />
      <rect className="mascot-sand-fall" x="41" y="19" width="1" height="5" fill={GOLD} />
      <rect className="mascot-sand-bottom" x="39" y="24" width="5" height="7" fill={GOLD} />
    </g>
  );
}

function ThoughtBubble() {
  return (
    <g>
      <rect x="31" y="15" width="2" height="2" fill={EDGE} />
      <rect x="33" y="12" width="3" height="2" fill={EDGE} />
      <rect x="33" y="2" width="16" height="9" fill={EDGE} />
      <rect x="32" y="3" width="18" height="7" fill={EDGE} />
      <g className="mascot-question" fill={INK}>
        <rect x="39" y="3" width="4" height="1" />
        <rect x="42" y="4" width="2" height="2" />
        <rect x="40" y="6" width="3" height="1" />
        <rect x="40" y="7" width="2" height="1" />
        <rect x="40" y="9" width="2" height="1" />
      </g>
      <g className="mascot-idea" fill={INK}>
        <rect className="mascot-think" x="36" y="5" width="2" height="3" />
        <rect className="mascot-think mascot-think-2" x="40" y="5" width="2" height="3" />
        <rect className="mascot-think mascot-think-3" x="44" y="5" width="2" height="3" />
      </g>
    </g>
  );
}

function PreparingProp() {
  return (
    <g>
      {/* Production's code, in the cloud. */}
      <rect x="38" y="1" width="7" height="2" fill={EDGE} />
      <rect x="35" y="3" width="14" height="4" fill={EDGE} />
      <g fill={STEEL}>
        <rect className="mascot-fall" x="37" y="8" width="3" height="2" />
        <rect className="mascot-fall mascot-fall-2" x="41" y="8" width="3" height="2" />
        <rect className="mascot-fall mascot-fall-3" x="45" y="8" width="3" height="2" />
      </g>
      {/* A manila folder, with how much has arrived. */}
      <rect x="34" y="21" width="7" height="2" fill={WOOD} />
      <rect x="34" y="23" width="16" height="12" fill={GOLD} />
      <rect x="37" y="28" width="11" height="3" fill={INK} />
      <rect className="mascot-fill" x="37" y="28" width="11" height="3" fill={GREEN} />
      <rect x="37" y="25" width="5" height="1" fill={WOOD} />
    </g>
  );
}

function NotebookProp() {
  const tick = (y: number, order: number) => (
    <g className={`mascot-tick mascot-tick-${order}`} fill={GREEN}>
      <rect x="37" y={y + 1} width="1" height="1" />
      <rect x="38" y={y + 2} width="1" height="1" />
      <rect x="39" y={y + 1} width="1" height="1" />
      <rect x="40" y={y} width="1" height="1" />
    </g>
  );
  return (
    <g>
      <rect x="35" y="5" width="15" height="28" fill={EDGE} />
      <rect x="36" y="6" width="13" height="26" fill={PAPER} />
      {/* The binding along the top. */}
      <g fill={INK}>
        {[38, 42, 46].map((x) => <rect key={x} x={x} y="3" width="1" height="4" />)}
      </g>
      {tick(10, 1)}
      <rect x="42" y="11" width="6" height="1" fill={STEEL} />
      {tick(15, 2)}
      <rect x="42" y="16" width="5" height="1" fill={STEEL} />
      {tick(20, 3)}
      <rect x="42" y="21" width="6" height="1" fill={STEEL} />
      {/* Where it left off: what comes next is still unwritten. */}
      <rect x="37" y="25" width="11" height="4" fill="var(--color-gold-bg)" />
      <rect className="mascot-cursor" x="38" y="26" width="1" height="2" fill={WOOD} />
    </g>
  );
}

function FilesProp() {
  const page = (
    <>
      <rect x="35" y="6" width="15" height="26" fill={EDGE} />
      <rect x="36" y="7" width="13" height="24" fill={PAPER} />
      <rect x="37" y="9" width="8" height="6" fill={EDGE} />
      <rect x="37" y="18" width="11" height="1" fill={STEEL} />
      <rect x="37" y="21" width="9" height="1" fill={STEEL} />
      <rect x="37" y="24" width="11" height="1" fill={STEEL} />
    </>
  );
  return (
    <g>
      {page}
      {/* The page being turned, hinged on the left edge. */}
      <g className="mascot-page">{page}</g>
    </g>
  );
}

function CodeProp() {
  // Twice the 12-unit pattern, so the scroll loops without a jump.
  const lines = [0, 12, 24, 36].flatMap((y) => [
    { x: 37, y: y + 3, width: 8 },
    { x: 39, y: y + 6, width: 9 },
    { x: 39, y: y + 9, width: 5 },
    { x: 37, y: y + 12, width: 3 },
  ]);
  const drawn = lines.map((line) => <rect key={`${line.x}-${line.y}`} x={line.x} y={line.y} width={line.width} height="1" />);
  return (
    <g>
      <clipPath id="mascot-code-page"><rect x="35" y="2" width="15" height="31" /></clipPath>
      <clipPath id="mascot-code-lens"><rect x="37" y="15" width="9" height="9" /></clipPath>
      {/* A dark editor, and under the magnifier the line it's reading stands out. */}
      <rect x="35" y="2" width="15" height="31" fill={INK} />
      <g clipPath="url(#mascot-code-page)">
        <g className="mascot-scroll" fill={STEEL}>{drawn}</g>
      </g>
      <g clipPath="url(#mascot-code-lens)">
        <rect x="37" y="15" width="9" height="9" fill="var(--color-gold-bg)" />
        <g className="mascot-scroll" fill={INK}>{drawn}</g>
      </g>
      <rect x="37" y="14" width="9" height="1" fill={GOLD} />
      <rect x="37" y="24" width="9" height="1" fill={GOLD} />
      <rect x="36" y="15" width="1" height="9" fill={GOLD} />
      <rect x="46" y="15" width="1" height="9" fill={GOLD} />
      <rect x="35" y="24" width="2" height="2" fill={WOOD} />
    </g>
  );
}

function DatabaseProp() {
  return (
    <g>
      {/* A steel server. Its rows light green as the query finds them. */}
      <rect x="39" y="5" width="9" height="1" fill={STEEL} />
      <rect x="38" y="6" width="11" height="29" fill={STEEL} />
      <rect x="39" y="35" width="9" height="1" fill={STEEL} />
      <rect x="38" y="15" width="11" height="1" fill={INK} />
      <rect x="38" y="25" width="11" height="1" fill={INK} />
      <rect className="mascot-row" x="40" y="9" width="7" height="3" fill={GREEN} />
      <rect className="mascot-row mascot-row-2" x="40" y="19" width="7" height="3" fill={GREEN} />
      <rect className="mascot-row mascot-row-3" x="40" y="29" width="7" height="3" fill={GREEN} />
      {/* The query going over, and the answer coming back. */}
      <rect className="mascot-query" x="33" y="26" width="2" height="2" fill={GOLD} />
      <rect className="mascot-reply" x="33" y="26" width="2" height="2" fill={GREEN} />
    </g>
  );
}
