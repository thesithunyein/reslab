import './styles.css';
import { HonestFlowDemo } from './demo';
import { CsvAnalyzer } from './csv';

function line(el: HTMLElement, text: string, cls = ''): void {
  const div = document.createElement('div');
  div.className = `t-line ${cls}`.trim();
  div.textContent = text;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function initDemo(): void {
  const output = document.getElementById('demoOutput') as HTMLElement;
  const status = document.getElementById('demoStatus') as HTMLElement;
  const demo = new HonestFlowDemo((t, c) => line(output, t, c), (s) => (status.textContent = s));
  void demo.init();

  const btns = Array.from(document.querySelectorAll<HTMLButtonElement>('.step-btn[data-step]'));
  btns.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      void demo.runStep(i + 1);
      btn.classList.remove('active');
      btn.classList.add('done');
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
  );
}

initDemo();
initCsv();
