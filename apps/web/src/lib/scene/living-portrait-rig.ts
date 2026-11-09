/** Authored in the native RGBA character's 1670 × 941 pixel coordinate system. */
import rigConfig from "./living-portrait-rig-config.json";
export type Point2 = { x: number; y: number };
export const CHARACTER_PLACEMENT = rigConfig.placement;
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const area = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => 1 - smooth(.35, 1, Math.hypot((x - cx) / rx, (y - cy) / ry));

/** 2.2 s inhale, 3.6 s exhale, with zero speed at both turning points. */
export function breathAt(time: number) {
  const phase = ((time % 5.8) + 5.8) % 5.8;
  const u = phase < 2.2 ? phase / 2.2 : 1 - (phase - 2.2) / 3.6;
  return .5 - .5 * Math.cos(Math.PI * u);
}

/** Rigid head, blended neck, very small chest expansion. Hands and seat stay pinned. */
export function breathingDeformation(x: number, y: number, breath: number): Point2 {
  const head = 1 - smooth(220, 295, y), angle = breath * .0018;
  const px = x - rigConfig.head.x, py = y - rigConfig.head.y;
  const dx = px * (Math.cos(angle) - 1) - py * Math.sin(angle) + breath * .22;
  const dy = px * Math.sin(angle) + py * (Math.cos(angle) - 1) - breath * 1.5;
  const c = rigConfig.chest, s = rigConfig.shoulder;
  const chest = area(x, y, c.x, c.y, c.rx, c.ry);
  const shoulder = area(x, y, s.x, s.y, s.rx, s.ry);
  return { x: dx * head + (x - c.x) * .012 * breath * chest || 0,
    y: dy * head - breath * (2.4 * chest + .9 * shoulder) || 0 };
}

export const IDLE_CHAINS = rigConfig.chains;
type Node = Point2 & { previousX: number; previousY: number };
const STEP = 1 / 120;

/** Verlet chains: inertial particles, damped rest springs and exact-length constraints.
 * Wind is a shared external force, never a direct sine displacement of image regions.
 * Coordinates remain near the painted silhouette; this is 2D secondary motion, not 3D cloth.
 */
export class IdleRig {
  time = 0;
  private accumulator = 0;
  chains = IDLE_CHAINS.map(config => ({ name: config.name, nodes: config.points.map(([x, y]): Node => ({ x, y, previousX: x, previousY: y })) }));
  offsets: Point2[] = IDLE_CHAINS.flatMap(config => config.points.map(() => ({ x: 0, y: 0 })));
  get breath() { return breathAt(this.time); }
  reset() {
    this.time = 0; this.accumulator = 0;
    this.chains.forEach((chain, c) => chain.nodes.forEach((node, i) => {
      const [x, y] = IDLE_CHAINS[c].points[i]; Object.assign(node, { x, y, previousX: x, previousY: y });
    }));
    this.offsets.forEach(p => { p.x = 0; p.y = 0; });
  }
  advance(delta: number, wind: number, active = true) {
    if (!active || !Number.isFinite(delta) || delta <= 0) return;
    this.accumulator += Math.min(delta, 1 / 30);
    const force = Number.isFinite(wind) ? clamp(wind) : 0;
    while (this.accumulator + 1e-10 >= STEP) {
      this.accumulator = Math.max(0, this.accumulator - STEP); this.time += STEP;
      const breath = this.breath;
      const gust = force * (72 + 18 * Math.sin(this.time * .8) + 12 * Math.sin(this.time * 1.9 + .4));
      this.chains.forEach((chain, c) => {
        const config = IDLE_CHAINS[c], nodes = chain.nodes;
        const root = config.points[0], rootMotion = breathingDeformation(root[0], root[1], breath);
        nodes[0].x = root[0] + rootMotion.x; nodes[0].y = root[1] + rootMotion.y;
        for (let i = 1; i < nodes.length; i++) {
          const node = nodes[i], rest = config.points[i], freedom = i / (nodes.length - 1);
          const target = breathingDeformation(rest[0], rest[1], breath);
          const ax = (rest[0] + target.x - node.x) * config.stiffness - gust * freedom;
          const ay = (rest[1] + target.y - node.y) * config.stiffness + 3 * freedom;
          const x = node.x, y = node.y, drag = Math.exp(-4.5 * STEP);
          node.x += (node.x - node.previousX) * drag + ax * STEP * STEP;
          node.y += (node.y - node.previousY) * drag + ay * STEP * STEP;
          node.previousX = x; node.previousY = y;
        }
        for (let iteration = 0; iteration < 12; iteration++) {
          for (let i = 1; i < nodes.length; i++) {
            const a = nodes[i - 1], b = nodes[i], pa = config.points[i - 1], pb = config.points[i];
            const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
            const rest = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
            if (length < 1e-8) continue;
            const correction = (length - rest) / length, weight = i === 1 ? 1 : .5;
            b.x -= dx * correction * weight; b.y -= dy * correction * weight;
            if (i > 1) { a.x += dx * correction * .5; a.y += dy * correction * .5; }
          }
        }
      });
    }
    let index = 0;
    this.chains.forEach((chain, c) => chain.nodes.forEach((node, i) => {
      const [x, y] = IDLE_CHAINS[c].points[i], carrier = breathingDeformation(x, y, this.breath);
      this.offsets[index].x = node.x - x - carrier.x; this.offsets[index++].y = node.y - y - carrier.y;
    }));
  }
}

/** Compact skin weights around each authored path. No influence on contact points. */
export function sampleSecondaryMotion(x: number, y: number, offsets: readonly Point2[]): Point2 {
  let resultX = 0, resultY = 0, total = 0, base = 0;
  for (const chain of IDLE_CHAINS) {
    let best = Infinity, along = 0, segment = 0, amount = 0;
    for (let i = 1; i < chain.points.length; i++) {
      const a = chain.points[i - 1], b = chain.points[i], dx = b[0] - a[0], dy = b[1] - a[1];
      const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy));
      const distance = Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
      if (distance < best) { best = distance; along = (i - 1 + t) / (chain.points.length - 1); segment = i - 1; amount = t; }
    }
    const weight = (1 - smooth(.25, 1, best / chain.radius)) * smooth(0, .38, along);
    const a = offsets[base + segment], b = offsets[base + segment + 1];
    resultX += (a.x + (b.x - a.x) * amount) * weight; resultY += (a.y + (b.y - a.y) * amount) * weight;
    total += weight; base += chain.points.length;
  }
  return { x: resultX / Math.max(1, total) || 0, y: resultY / Math.max(1, total) || 0 };
}

const f = (n: number) => n.toFixed(4);
// Generated from the same path data used by the solver and CPU acceptance tests.
let uniformBase = 0;
const skinCode = IDLE_CHAINS.map(chain => {
  const base = uniformBase; uniformBase += chain.points.length;
  return `{ float best=1e10; float along=0.; vec2 offset=vec2(0.);
    ${chain.points.slice(1).map((b, s) => {
      const a = chain.points[s];
      return `{ vec2 a=vec2(${f(a[0])},${f(a[1])}); vec2 b=vec2(${f(b[0])},${f(b[1])});
        vec2 ab=b-a; float t=clamp(dot(p-a,ab)/dot(ab,ab),0.,1.); float d=length(p-a-ab*t);
        if(d<best){best=d;along=(${f(s)}+t)/${f(chain.points.length - 1)};offset=mix(uMotion[${base + s}],uMotion[${base + s + 1}],t);}}`;
    }).join("\n")}
    float w=(1.-smoothstep(.25,1.,best/${f(chain.radius)}))*smoothstep(0.,.38,along);
    motion+=offset*w; total+=w; }`;
}).join("\n");
export const IDLE_RIG_GLSL = `
uniform vec2 uMotion[${uniformBase}]; uniform float uBreath;
float area(vec2 p,vec2 c,vec2 r){return 1.-smoothstep(.35,1.,length((p-c)/r));}
vec2 idleMotion(vec2 p){
  float head=1.-smoothstep(220.,295.,p.y); float angle=uBreath*.0018;
  vec2 q=p-vec2(${f(rigConfig.head.x)},${f(rigConfig.head.y)});
  vec2 motion=vec2(q.x*(cos(angle)-1.)-q.y*sin(angle)+uBreath*.22,
    q.x*sin(angle)+q.y*(cos(angle)-1.)-uBreath*1.5)*head;
  float chest=area(p,vec2(${f(rigConfig.chest.x)},${f(rigConfig.chest.y)}),vec2(${f(rigConfig.chest.rx)},${f(rigConfig.chest.ry)}));
  float shoulder=area(p,vec2(${f(rigConfig.shoulder.x)},${f(rigConfig.shoulder.y)}),vec2(${f(rigConfig.shoulder.rx)},${f(rigConfig.shoulder.ry)}));
  motion+=vec2((p.x-${f(rigConfig.chest.x)})*.012*uBreath*chest,-uBreath*(2.4*chest+.9*shoulder));
  vec2 breathing=motion; motion=vec2(0.);float total=0.;
  ${skinCode}
  return breathing+motion/max(1.,total);
}`;
