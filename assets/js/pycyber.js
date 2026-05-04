/* ============================================
   PY-CYBER ENGINE — v1.1
   ============================================ */

(function () {
  const cfg = window.MODULE_CONFIG;
  if (!cfg) {
    console.error('[py-cyber] MODULE_CONFIG não definido. Abortando.');
    return;
  }

  const STORAGE_KEY = 'pycyber_' + cfg.id + '_progress';
  const COMPLETE_KEY = 'pycyber_' + cfg.id + '_complete';

  // ============ STATE ============
  const checks = {};
  Object.keys(cfg.checks).forEach(function (k) { checks[k] = false; });

  function loadProgress() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        Object.assign(checks, JSON.parse(saved));
        Object.keys(checks).forEach(function (k) {
          const el = document.querySelector('[data-check="' + k + '"]');
          if (el && checks[k]) el.classList.add('done');
        });
        updateProgress();
      } catch (e) {
        console.warn('[py-cyber] progresso corrompido, ignorando');
      }
    }
  }

  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checks));
  }

  function markCheck(key) {
    if (checks[key] === false) {
      checks[key] = true;
      const el = document.querySelector('[data-check="' + key + '"]');
      if (el) el.classList.add('done');
      saveProgress();
      updateProgress();
      console.log('[py-cyber] ✓ check marcado:', key);
    }
  }

  function updateProgress() {
    const done = Object.values(checks).filter(Boolean).length;
    const total = Object.keys(checks).length;
    const pct = total ? (done / total) * 100 : 0;
    const fill = document.getElementById('progress');
    if (fill) fill.style.width = pct + '%';
    const btn = document.getElementById('btn-validate');
    if (btn) btn.disabled = done < total;
  }

  // ============ TERMINAL ============
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 13,
    theme: {
      background: '#000000',
      foreground: '#d1d5db',
      cursor: '#f4c430',
      green: '#4ade80',
      yellow: '#f4c430',
      blue: '#60a5fa',
      red: '#f87171'
    },
    convertEol: true
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal'));
  fitAddon.fit();
  window.addEventListener('resize', function () { fitAddon.fit(); });

  function color(text, c) {
    const codes = {
      yellow: '\x1b[33m', green: '\x1b[32m', red: '\x1b[31m',
      blue: '\x1b[34m', dim: '\x1b[90m', reset: '\x1b[0m'
    };
    return (codes[c] || '') + text + codes.reset;
  }

  term.writeln(color('╔══════════════════════════════════════════╗', 'yellow'));
  term.writeln(color('║   py-cyber REPL · ' + cfg.id.toUpperCase().padEnd(20, ' ') + ' ║', 'yellow'));
  term.writeln(color('╚══════════════════════════════════════════╝', 'yellow'));
  term.writeln(color('Inicializando Python 3.11 (Pyodide WASM)...', 'dim'));

  // ============ PYODIDE ============
  let pyodide = null;
  let inputBuffer = '';
  let history = [];
  let historyIdx = -1;
  let multiline = false;
  let multilineBuffer = '';

  function prompt() {
    term.write(multiline ? color('... ', 'yellow') : color('>>> ', 'green'));
  }

  function detectChecks(code) {
    console.log('[py-cyber] detectChecks:', JSON.stringify(code));
    Object.keys(cfg.checks).forEach(function (key) {
      if (checks[key]) return;
      const matcher = cfg.checks[key];
      let hit = false;
      try {
        if (typeof matcher === 'function') hit = matcher(code);
        else if (matcher instanceof RegExp) hit = matcher.test(code);
        else if (typeof matcher === 'string') hit = code.indexOf(matcher) !== -1;
      } catch (e) {
        console.warn('[py-cyber] erro no matcher', key, e);
      }
      if (hit) markCheck(key);
    });
  }

  async function evalLine(code) {
  if (!code.trim()) return;
  history.push(code);
  historyIdx = history.length;
  detectChecks(code);

    try {
        // Tenta como expressão pura
        let isExpr = true;
        try {
        pyodide.runPython('compile(' + JSON.stringify(code) + ', "<repl>", "eval")');
        } catch (e) {
        isExpr = false;
        }

        if (isExpr) {
        // Avalia e guarda em __pyc_last sem re-executar o código
        await pyodide.runPythonAsync('__pyc_last = (' + code + ')');
        const result = pyodide.globals.get('__pyc_last');
        if (result !== undefined && result !== null) {
            const repr = pyodide.runPython('repr(__pyc_last)');
            term.writeln(color(repr, 'blue'));
        }
        } else {
        // Statement (import, atribuição, etc) — só executa
        await pyodide.runPythonAsync(code);
        }
        } catch (err) {
            const msg = err.message.split('\n').slice(-4).join('\n');
            term.writeln(color(msg, 'red'));
        }
    }

  function clearLine() {
    term.write('\x1b[2K\r');
    prompt();
    term.write(inputBuffer);
  }

  term.onData(async function (data) {
    if (!pyodide) return;
    const code = data.charCodeAt(0);

    if (data === '\r') {
      term.write('\r\n');
      const line = inputBuffer;
      inputBuffer = '';

      if (line.trim().endsWith(':') || multiline) {
        multilineBuffer += line + '\n';
        if (line.trim() === '' && multiline) {
          await evalLine(multilineBuffer);
          multilineBuffer = '';
          multiline = false;
        } else {
          multiline = true;
        }
      } else {
        await evalLine(line);
      }
      prompt();
    } else if (code === 127) {
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
        term.write('\b \b');
      }
    } else if (data === '\x1b[A') {
      if (historyIdx > 0) {
        historyIdx--;
        inputBuffer = history[historyIdx] || '';
        clearLine();
      }
    } else if (data === '\x1b[B') {
      if (historyIdx < history.length - 1) {
        historyIdx++;
        inputBuffer = history[historyIdx] || '';
      } else {
        historyIdx = history.length;
        inputBuffer = '';
      }
      clearLine();
    } else if (data === '\x03') {
      term.write('^C\r\n');
      inputBuffer = '';
      multilineBuffer = '';
      multiline = false;
      prompt();
    } else if (code >= 32) {
      inputBuffer += data;
      term.write(data);
    }
  });

  // ============ INIT ============
    // ============ INIT ============
  (async function () {
    try {
      pyodide = await loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/'
      });

      // Pacotes nativos do Pyodide (pré-compilados)
      if (cfg.packages && cfg.packages.length) {
        term.writeln(color('Carregando (built-in): ' + cfg.packages.join(', ') + '...', 'dim'));
        await pyodide.loadPackage(cfg.packages);
      }

      // Pacotes do PyPI via micropip
      if (cfg.micropipPackages && cfg.micropipPackages.length) {
        term.writeln(color('Carregando (PyPI): ' + cfg.micropipPackages.join(', ') + '...', 'dim'));
        await pyodide.loadPackage('micropip');
        const micropip = pyodide.pyimport('micropip');
        for (const pkg of cfg.micropipPackages) {
          try {
            await micropip.install(pkg);
          } catch (e) {
            term.writeln(color('  ⚠ falhou: ' + pkg + ' (' + e.message.split('\n')[0] + ')', 'red'));
          }
        }
      }

      if (cfg.setupCode) {
        await pyodide.runPythonAsync(cfg.setupCode);
      }

      term.writeln(color('✓ Python 3.11 pronto.', 'green'));
      term.writeln(color('Dicas: ↑/↓ histórico · Ctrl+C cancela · linha vazia encerra bloco', 'dim'));
      term.writeln('');
      const status = document.getElementById('status');
      if (status) {
        status.textContent = 'PRONTO';
        status.classList.remove('loading');
        status.classList.add('ready');
      }
      prompt();
      loadProgress();
    } catch (err) {
      term.writeln(color('✗ Erro ao carregar Pyodide: ' + err.message, 'red'));
      console.error('[py-cyber] init error:', err);
    }
  })();

  // ============ BOTÕES ============
  const btnReset = document.getElementById('btn-reset');
  if (btnReset) {
    btnReset.addEventListener('click', function () {
      if (confirm('Resetar checklist deste módulo?')) {
        Object.keys(checks).forEach(function (k) {
          checks[k] = false;
          const el = document.querySelector('[data-check="' + k + '"]');
          if (el) el.classList.remove('done');
        });
        saveProgress();
        updateProgress();
      }
    });
  }

  const btnValidate = document.getElementById('btn-validate');
  if (btnValidate) {
    btnValidate.addEventListener('click', function () {
      localStorage.setItem(COMPLETE_KEY, '1');
      const next = cfg.nextModule;
      if (next && confirm('✓ ' + cfg.id.toUpperCase() + ' validado!\n\nIr para o próximo módulo?')) {
        window.location.href = next;
      } else {
        window.location.href = '../index.html';
      }
    });
  }

  document.querySelectorAll('.check-item').forEach(function (item) {
    item.addEventListener('click', function () {
      const text = item.querySelector('.check-text').textContent.trim();
      if (inputBuffer.length > 0) {
        term.write('\b \b'.repeat(inputBuffer.length));
      }
      inputBuffer = text;
      term.write(text);
      term.focus();
    });
  });

})();