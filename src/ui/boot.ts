import gsap from 'gsap';

/** `?bootdemo` slows the loading screen right down, to look at (or photograph) every stage. */
const DEMO = new URLSearchParams(location.search).has('bootdemo');
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

interface Branch {
  strands: SVGPathElement[];
  lengths: number[];
  star: SVGGElement;
  lit: boolean;
  pop: { v: number };
}

/**
 * The loading screen (markup and styles live inline in index.html so it shows before any script).
 * Real startup progress drives a small constellation: braided light grows from the seed toward
 * each branch star in turn, the star ignites as it arrives, and at the end the seed flares and
 * the darkness opens from it like an iris onto the running game.
 */
class Boot {
  private el = document.getElementById('boot');
  private branches: Branch[] = [];
  private seed: SVGGElement | null = null;
  private phaseEl: HTMLElement | null = null;
  private target = 0;
  private shown = 0;
  private last = performance.now();
  private raf = 0;
  private stopped = false;
  private label = '';
  /** labels wait for the drawing to catch up: each one shows once progress reaches the point it was given at */
  private labels: { p: number; text: string }[] = [];
  private revealing: Promise<void> | null = null;

  constructor() {
    if (!this.el) return;
    for (const b of this.el.querySelectorAll<SVGGElement>('.branch')) {
      const strands = [...b.querySelectorAll<SVGPathElement>('.strand')];
      const lengths = strands.map((s) => s.getTotalLength());
      strands.forEach((s, i) => {
        s.style.strokeDasharray = `${lengths[i]} ${lengths[i]}`;
        s.style.strokeDashoffset = `${lengths[i]}`;
      });
      this.branches.push({ strands, lengths, star: b.querySelector<SVGGElement>('.star')!, lit: false, pop: { v: 0 } });
    }
    this.seed = this.el.querySelector<SVGGElement>('.seed');
    this.phaseEl = this.el.querySelector<HTMLElement>('.phase');
    this.label = this.phaseEl?.textContent ?? '';
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Startup progress, 0..1 (it only ever moves forward), and what is happening now. */
  step(p: number, label?: string) {
    this.target = Math.max(this.target, clamp01(p));
    if (label) this.labels.push({ p: this.target, text: label });
  }

  private setLabel(text: string) {
    this.label = text;
    const el = this.phaseEl;
    if (!el) return;
    el.classList.add('swap');
    setTimeout(() => {
      el.textContent = this.label;
      el.classList.remove('swap');
    }, 180);
  }

  private tick = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // ease toward the real progress, so a jump between phases still reads as growth
    this.shown += (this.target - this.shown) * (1 - Math.exp(-(DEMO ? 0.55 : 9) * dt));
    this.render();
    if (!this.stopped) this.raf = requestAnimationFrame(this.tick);
  };

  private render() {
    const p = this.shown;
    let text = this.label;
    for (const l of this.labels) if (l.p <= p + 0.02) text = l.text;
    if (text !== this.label) this.setLabel(text);
    this.branches.forEach((b, i) => {
      // staggered: the first branch draws over 0–35 %, the last over 60–95 %
      const f = clamp01((p - i * 0.2) / 0.35);
      b.strands.forEach((s, k) => { s.style.strokeDashoffset = `${b.lengths[k] * (1 - f)}`; });
      const lit = clamp01((f - 0.82) / 0.18);
      if (lit >= 1 && !b.lit) {
        b.lit = true; // the star ignites as its light arrives
        gsap.fromTo(b.pop, { v: 0.9 }, { v: 0, duration: 0.7, ease: 'power3.out' });
      }
      b.star.style.opacity = `${0.16 + 0.84 * lit}`;
      b.star.style.transform = `scale(${0.72 + 0.28 * lit + b.pop.v})`;
    });
    if (this.seed) {
      this.seed.style.opacity = `${0.5 + 0.5 * p}`;
      this.seed.style.transform = `scale(${0.82 + 0.18 * p})`;
    }
    if (this.el) {
      this.el.style.setProperty('--p', p.toFixed(4));
      this.el.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    }
  }

  /** Finish the constellation, flare the seed and open the darkness onto the game. */
  reveal(): Promise<void> {
    if (this.revealing) return this.revealing;
    this.revealing = this.playReveal();
    return this.revealing;
  }

  private async playReveal() {
    const el = this.el;
    if (!el) return;
    this.step(1, 'first light');
    // let the last branch finish drawing, but never hold the game back for long
    const t0 = performance.now();
    await new Promise<void>((res) => {
      const wait = () => (this.shown > 0.985 || performance.now() - t0 > (DEMO ? 8000 : 550) ? res() : requestAnimationFrame(wait));
      wait();
    });
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.shown = this.target = 1;
    this.render();
    this.setLabel('first light');

    if (document.documentElement.classList.contains('still')) {
      el.style.pointerEvents = 'none';
      await new Promise<void>((res) => gsap.to(el, { opacity: 0, duration: 0.3, onComplete: res }));
      el.remove();
      return;
    }
    const words = el.querySelector('.words');
    const sky = el.querySelector('.sky');
    const reach = Math.hypot(window.innerWidth, window.innerHeight);
    el.style.setProperty('--hole', '-180');
    // the seed and stars are scaled through inline styles (render() does the same), so animate plain values
    const f = { seed: 1, stars: 1 };
    const seed = this.seed;
    const stars = this.branches.map((b) => b.star);
    await new Promise<void>((res) => {
      gsap.timeline({ onComplete: res })
        .to(words, { opacity: 0, y: 6, duration: 0.25, ease: 'power2.in' }, 0)
        .to(f, { stars: 1.55, duration: 0.35, ease: 'back.out(3)', onUpdate: () => stars.forEach((s) => { s.style.transform = `scale(${f.stars})`; }) }, 0)
        // the seed gathers itself, then bursts as the darkness opens
        .to(f, { seed: 0.85, duration: 0.18, ease: 'power2.out', onUpdate: () => { if (seed) seed.style.transform = `scale(${f.seed})`; } }, 0)
        .to(f, { seed: 3.2, duration: 0.42, ease: 'power3.in', onUpdate: () => { if (seed) seed.style.transform = `scale(${f.seed})`; } }, 0.18)
        .add(() => {
          el.classList.add('opening');
          el.style.pointerEvents = 'none'; // the game is playable while the darkness is still opening
        }, 0.38)
        .to(el, { '--hole': reach, duration: 0.9, ease: 'power2.inOut' }, 0.38)
        .to(sky, { opacity: 0, scale: 1.3, duration: 0.7, ease: 'power2.in' }, 0.48);
    });
    el.remove();
  }

  /** Startup failed: say so where the progress was. */
  fail(message: string) {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    const el = this.phaseEl;
    if (!el) return;
    el.classList.remove('swap');
    el.classList.add('error');
    el.textContent = message;
  }
}

export const boot = new Boot();
