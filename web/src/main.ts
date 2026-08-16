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
  const steps = document.querySelectorAll<HTMLElement>('#studyStrip .s-step');
  const status = document.getElementById('studyStatus') as HTMLElement;
  const runBtn = document.getElementById('studyRunAll') as HTMLButtonElement;
  const result = document.getElementById('studyResult') as HTMLElement;
  const flow = new StudyFlow(steps, status, runBtn, result);
  void flow.init();
  runBtn.addEventListener('click', () => void flow.runAll());
}

function initFaq(): void {
  const btn = document.getElementById('howBtn') as HTMLButtonElement;
  const faq = document.getElementById('faq') as HTMLElement;
  btn.addEventListener('click', () => {
    const closing = !faq.classList.contains('hidden');
    faq.classList.toggle('hidden', closing);
    btn.textContent = closing ? 'How it works' : 'Close';
    if (!closing) {
      requestAnimationFrame(() => {
        faq.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
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
    el('csvResult') as HTMLElement,
    el('sampleBtn') as HTMLButtonElement,
    el('downloadBtn') as HTMLButtonElement,
    el('advToggle') as HTMLButtonElement,
    el('advPanel') as HTMLElement,
    el('alphaSel') as HTMLSelectElement,
    el('tailsSel') as HTMLSelectElement,
  );
}

initReveal();
initFaq();
initStudy();
initCsv();
