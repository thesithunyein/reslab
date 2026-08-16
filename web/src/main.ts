import './styles.css';
import { CsvAnalyzer } from './csv';
import { StudyFlow } from './study';

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

function initStudy(): void {
  const output = document.getElementById('studyOutput') as HTMLElement;
  const status = document.getElementById('studyStatus') as HTMLElement;
  const steps = document.querySelectorAll<HTMLButtonElement>('#studySteps .s-step');
  const summary = document.getElementById('studySummary') as HTMLElement;
  const flow = new StudyFlow(output, status, steps, summary);
  void flow.init();
  document.getElementById('studyRunAll')!.addEventListener('click', () => void flow.runAll());
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
initStudy();
initCsv();
