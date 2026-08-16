import './styles.css';
import { CsvAnalyzer } from './csv';
import { HeroStudio } from './hero';

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
initCsv();
