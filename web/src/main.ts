import './styles.css';
import { HonestFlowDemo } from './demo';
import { CsvAnalyzer } from './csv';
import { HeroStudio } from './hero';

function line(el: HTMLElement, text: string, cls = ''): void {
  const div = document.createElement('div');
  div.className = `t-line ${cls}`.trim();
  div.textContent = text;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function initReveal(): void {
  const els = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
  if (!('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12 },
  );
  els.forEach((el) => io.observe(el));
}

function initHero(): void {
  const output = document.getElementById('heroOutput') as HTMLElement;
  const status = document.getElementById('heroStatus') as HTMLElement;
  const steps = document.querySelectorAll<HTMLButtonElement>('#heroSteps .s-step');
  const summary = document.getElementById('heroSummary') as HTMLElement;
  const replay = document.getElementById('heroReplay') as HTMLButtonElement;
  const studio = new HeroStudio(output, status, steps, summary, replay);
  // Start once the hero is visible (or immediately if already in view).
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            void studio.init();
            io.disconnect();
            return;
          }
        }
      },
      { threshold: 0.3 },
    );
    io.observe(output);
  } else {
    void studio.init();
  }
}

function initDemo(): void {
  const output = document.getElementById('demoOutput') as HTMLElement;
  const status = document.getElementById('demoStatus') as HTMLElement;
  const demo = new HonestFlowDemo((t, c) => line(output, t, c), (s) => (status.textContent = s));
  void demo.init();

  const btns = Array.from(document.querySelectorAll<HTMLButtonElement>('.step-btn[data-step]'));
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const step = Number(btn.dataset.step);
      if (step >= 1 && step <= 5) {
        void demo.runStep(step);
        btn.classList.remove('active');
        btn.classList.add('done');
      }
    });
  });
  document.getElementById('runAll')!.addEventListener('click', () => {
    void demo.runAll();
    btns.forEach((b) => {
      b.classList.remove('active');
      b.classList.add('done');
    });
  });
}

function initCsv(): void {
  const el = (id: string): HTMLElement => document.getElementById(id)!;
  new CsvAnalyzer(
    el('dropzone') as HTMLElement,
    el('fileInput') as HTMLInputElement,
    el('browseLink') as HTMLElement,
    el('csvControls') as HTMLElement,
    el('valueCol') as HTMLSelectElement,
    el('groupCol') as HTMLSelectElement,
    el('runCsv') as HTMLButtonElement,
    el('csvStatus') as HTMLElement,
    el('sampleBtn') as HTMLButtonElement,
  );
}

initReveal();
initHero();
initDemo();
initCsv();
