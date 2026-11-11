// fg-app: canvas editor + debugger + watch + console + file I/O.
(function () {
  const FG = window.FG, CG = window.CG;
  const $ = (s) => document.querySelector(s);
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

  const STORE = 'flowforge.doc.v1';
  const SHAPE_TYPES = ['Declare', 'Assign', 'Input', 'Output', 'If', 'While', 'Do', 'For', 'Call', 'Comment', 'Breakpoint'];
  const GEOM = {
    Start: 'g-stadium', End: 'g-stadium', Assign: 'g-rect', Declare: 'g-rect g-head',
    Input: 'g-para', Output: 'g-para', If: 'g-diamond', While: 'g-hex', Do: 'g-hex',
    For: 'g-hex', Call: 'g-rect g-bandL g-bandR', Comment: 'g-dash', Breakpoint: 'g-oct'
  };
  const CAT = {
    Start: 'term', End: 'term', Declare: 'dec', Assign: 'proc', If: 'dec', While: 'loop', Do: 'loop',
    For: 'loop', Input: 'io', Output: 'io', Call: 'call', Comment: 'note', Breakpoint: 'brk'
  };
  const st = {
    prog: FG.newProgram(), fn: 'Main', sel: null, undo: [], redo: [],
    speed: 2, mode: 'idle', gen: null, frames: [], waitInput: null, stepOnce: false,
    clip: null, watchFrame: 0, ignoreBpts: false, autoConsole: false
  };

  // ---------- helpers ----------
  function curFn() { return st.prog.functions.find((f) => f.name === st.fn) || st.prog.functions[0]; }
  function findShape(id, body) {
    body = body || curFn().body;
    for (const s of body) {
      if (s.id === id) { return s; }
      for (const k of Object.keys(s.children || {})) {
        const r = findShape(id, s.children[k]);
        if (r) { return r; }
      }
    }
    return null;
  }
  function locate(id, body, trail) {
    body = body || curFn().body; trail = trail || [];
    for (let i = 0; i < body.length; i++) {
      if (body[i].id === id) { return { list: body, index: i + 1, shape: body[i], trail }; }
      for (const k of Object.keys(body[i].children || {})) {
        const r = locate(id, body[i].children[k], trail.concat([{ shape: body[i], segment: k }]));
        if (r) { return r; }
      }
    }
    return null;
  }
  const esc = FG.html, norm = FG.normName;
  function snap() { st.undo.push(JSON.stringify(st.prog)); if (st.undo.length > 80) st.undo.shift(); st.redo.length = 0; }
  function autosave() { try { localStorage.setItem(STORE, JSON.stringify(st.prog)); } catch (e) {} }

  // ---------- shape text ----------
  function shapeText(s) {
    const p = s.props || {};
    switch (s.type) {
      case 'Start': return '<span class="lbl">' + esc(s.props.main ? 'Main' : st.fn) + '</span>Start';
      case 'End': return 'End';
      case 'Comment': return '<span class="txt">' + (esc(p.text || '').replace(/\n/g, '<br>') || '<i style="color:var(--dim)">(empty comment)</i>') + '</span>';
      case 'Breakpoint': return 'Breakpoint' + (p.expression ? '<br><span style="color:var(--rose)">if ' + esc(p.expression) + '</span>' : '');
      case 'Declare': return '<span class="band">' + (p.array ? 'Array' : 'Declare') + '</span><span class="txt" style="padding:4px 8px">' +
        esc(p.variable) + ' ' + typeSpan(p.type) + (p.array ? ' = ' + esc(p.size) + ' elements' : '') + '</span>';
      case 'Assign': return '<span class="lbl">Assign</span><span class="txt">' + assignHtml(p) + '</span>';
      case 'If': return '<span class="lbl">If</span><span class="txt">' + esc(p.expression) + '</span>';
      case 'While': return '<span class="lbl">While</span><span class="txt">' + esc(p.expression) + '</span>';
      case 'Do': return '<span class="txt">' + esc(p.expression) + '</span><span class="lbl" style="margin-top:3px">Do - Loop Until</span>';
      case 'For': return '<span class="lbl">For</span><span class="txt">i = ' + forHtml(p) + '</span>';
      case 'Input': return '<span class="lbl">Input</span><span class="txt">' + esc(p.variable) + '</span>';
      case 'Output': return '<span class="lbl">Output</span><span class="txt">' + esc(p.expression) + '</span>';
      case 'Call': return '<span class="lbl">Call</span><span class="txt">' + esc(p.name || 'Main') +
        '(' + (p.args || []).map(esc).join(', ') + ')' + (p.returnTo ? '<br>→ ' + esc(p.returnTo) : '') + '</span>';
      default: return s.type;
    }
  }
  function typeSpan(t) { return '<span class="t' + (t || 'Void') + '">' + esc(t || '') + '</span>'; }
  function assignHtml(p) {
    const e = p.expression || '';
    if (p.declare) { return esc(e); }
    const m = FG.splitAssign(e);
    if (m.at < 0) { return esc(e); }
    return '<b>' + esc(m.lhs) + '</b> = ' + esc(m.rhs);
  }
  function forHtml(p) {
    return esc([p.variable, '=', p.start, 'To', p.end, 'Step', p.step || '1'].join(' '));
  }

  // ---------- render ----------
  function render() {
    const flow = $('#flow');
    flow.innerHTML = '';
    flow.appendChild(branch(curFn().body, []));
    const shapes = flow.querySelectorAll('.shape');
    shapes.forEach((n, i) => n.style.setProperty('--i', Math.min(i, 26)));
    const sc = $('#shapeCount');
    if (sc) { sc.textContent = shapes.length + ' shapes'; }
    $('#fnSel').value = st.fn;
    $('#stRight').innerHTML = esc(st.prog.attributes.name) + ' · ' + st.prog.functions.length + ' function(s)';
    markBpt();
    autoFit();
  }
  function branch(list, trail) {
    const wrap = el('div', 'row');
    list.forEach((s, i) => {
      const wire = el('div', 'wire');
      const add = el('button', 'add', '+');
      add.title = 'Insert shape before ' + s.type;
      add.onclick = (ev) => { ev.stopPropagation(); openPop(ev, { list, index: i, trail }); };
      wire.appendChild(add);
      wrap.appendChild(wire);
      wrap.appendChild(node(s, trail.concat([{ shape: s, segment: null }])), true);
    });
    const tailWire = el('div', 'wire');
    const tAdd = el('button', 'add', '+');
    tAdd.title = 'Append shape';
    tAdd.onclick = (ev) => { ev.stopPropagation(); openPop(ev, { list, index: list.length, trail }); };
    tailWire.appendChild(tAdd);
    wrap.appendChild(tailWire);
    return wrap;
  }
  function node(s, trail) {
    const box = el('div', 'shape ' + (GEOM[s.type] || 'g-rect') + ' c-' + (CAT[s.type] || 'proc'));
    box.dataset.id = s.id;
    const bd = el('div', 'border');
    const face = el('div', 'face', shapeText(s));
    bd.appendChild(face);
    box.appendChild(bd);
    box.appendChild(el('div', 'tag', s.type));
    const ops = el('div', 'ops');
    ops.appendChild(miniBtn('edit', () => editDialog(s)));
    ops.appendChild(miniBtn('dup', () => duplicate(s)));
    ops.appendChild(miniBtn('del', () => remove(s)));
    if (s.type !== 'Start' && s.type !== 'End') {
      ops.appendChild(miniBtn(s.props && s.props.bpt ? 'bpt✓' : 'bpt', () => toggleBpt(s)));
    }
    box.appendChild(ops);
    box.onclick = (ev) => { ev.stopPropagation(); select(s.id); };
    box.ondblclick = (ev) => { ev.stopPropagation(); editDialog(s); };
    if (!FG.COMPOUND[s.type]) { return box; }

    const out = el('div', 'row');
    out.appendChild(box);
    const c = FG.COMPOUND[s.type];
    if (s.type === 'If') {
      const cols = el('div', 'branch');
      cols.appendChild(col(s, s.children[c.els], trail, 'False', true));
      cols.appendChild(col(s, s.children[c.then], trail, 'True', false));
      out.appendChild(cols);
      out.appendChild(el('div', 'merge'));
    } else if (s.type === 'For') {
      out.appendChild(col(s, s.children[c.body], trail, 'Next', false, true));
      if ((s.children[c.done] || []).length) { out.appendChild(branch(s.children[c.done], trail)); }
    } else {
      out.appendChild(col(s, s.children[c.body], trail, s.type === 'Do' ? 'Loop' : null, false, true));
    }
    return out;
  }
  function col(s, list, trail, label, isFalse, isLoop) {
    const box = el('div', 'bl' + (list.length ? '' : ' empty') + (isLoop ? ' loop' : ''));
    if (isLoop) {
      box.appendChild(el('div', 'backline'));
      box.appendChild(el('div', 'upline'));
    } else {
      box.appendChild(el('div', 'run'));
      box.appendChild(el('div', 'capTop'));
    }
    if (label) {
      const cap = el('div', 'cap');
      cap.appendChild(el('i', isFalse ? 'f' : '', label));
      box.appendChild(cap);
    }
    if (!list.length) {
      const add = el('button', 'add', '+ add ' + (label || 'block'));
      add.style.cssText = 'width:auto;position:static;transform:none;opacity:1;margin:10px auto;display:block';
      add.onclick = (ev) => { ev.stopPropagation(); openPop(ev, { list, index: 0, trail: trail.concat([{ shape: s, segment: labelSeg(s, label) }]) }); };
      box.appendChild(el('div', 'none', '(empty)'));
      box.appendChild(add);
    } else {
      box.appendChild(branch(list, trail.concat([{ shape: s, segment: labelSeg(s, label) }])));
    }
    if (!isLoop) {
      box.appendChild(el('div', 'capBot'));
      box.appendChild(el('div', 'runb'));
    }
    return box;
  }
  function labelSeg(s, label) {
    const c = FG.COMPOUND[s.type];
    if (label === 'True') { return c.then; }
    if (label === 'False') { return c.els; }
    if (label === 'Done') { return c.done; }
    return c.body;
  }
  function miniBtn(t, fn) { const b = el('button', 'mini', t); b.onclick = (ev) => { ev.stopPropagation(); fn(); }; return b; }
  function select(id) {
    st.sel = id;
    document.querySelectorAll('.shape.sel').forEach((n) => n.classList.remove('sel'));
    if (id) { const n = document.querySelector('.shape[data-id="' + id + '"]'); if (n) n.classList.add('sel'); }
  }
  function markBpt() {
    document.querySelectorAll('.shape').forEach((n) => {
      const s = findShape(n.dataset.id);
      const on = !!(s && s.props && s.props.bpt);
      n.classList.toggle('bpt', on);
      n.classList.toggle('ignored', on && st.ignoreBpts);
    });
  }
  function highlight(s, failed) {
    document.querySelectorAll('.shape.running,.shape.failed').forEach((n) => n.classList.remove('running', 'failed'));
    if (!s) { return; }
    const n = document.querySelector('.shape[data-id="' + s.id + '"]');
    if (n) { n.classList.add(failed ? 'failed' : 'running'); n.scrollIntoView({ block: 'center' }); }
  }

  // ---------- structural edits ----------
  function insertShape(type, where) {
    snap();
    const s = FG.shape(type, defaults(type));
    where.list.splice(where.index, 0, s);
    render(); autosave();
    if (Object.keys(FG.COMPOUND[type] || {}).length) { editDialog(s, true); } else { select(s.id); editDialog(s); }
  }
  function defaults(type) {
    const f = curFn();
    const v = firstVar() || 'x';
    switch (type) {
      case 'Declare': return { variable: v, type: 'Integer', array: false, size: '0' };
      case 'Assign': return { variable: v, expression: v + ' = 0' };
      case 'Input': return { variable: v };
      case 'Output': return { expression: v };
      case 'If': case 'While': case 'Do': return { expression: v + ' > 0' };
      case 'For': return { variable: 'i', start: '1', end: '10', step: '1' };
      case 'Call': return { name: f.name === 'Main' ? 'Function1' : f.name, args: [], returnTo: '' };
      case 'Comment': return { text: '' };
      case 'Breakpoint': return { expression: '' };
      default: return {};
    }
  }
  function firstVar() {
    let name = '';
    FG.walk(curFn().body, (s) => { if (!name && s.props.variable && (s.type === 'Declare' || s.type === 'Assign' || s.type === 'Input')) { name = s.props.variable; } });
    if (!name) { for (const p of curFn().params) { if (!name) { name = p.name; } } }
    return name;
  }
  function remove(s) {
    snap();
    const w = locate(s.id);
    if (w) { w.list.splice(w.index - 1, 1); }
    st.sel = null; render(); autosave();
  }
  function duplicate(s) {
    snap();
    const w = locate(s.id);
    const copy = FG.clone(s);
    renewIds(copy);
    w.list.splice(w.index, 0, copy);
    render(); autosave();
  }
  function renewIds(s) {
    s.id = FG.newId();
    for (const k of Object.keys(s.children || {})) { s.children[k].forEach(renewIds); }
  }
  function toggleBpt(s) {
    snap();
    s.props.bpt = !s.props.bpt;
    if (s.props.bpt && s.props.expression == null) { s.props.expression = ''; }
    render(); autosave();
  }

  // ---------- insert popup ----------
  function openPop(ev, where) {
    const pop = $('#pop');
    pop.innerHTML = '';
    const byName = {
      Declare: 'Declare', Assign: 'Assign', Input: 'Input', Output: 'Output', If: 'If',
      While: 'While', Do: 'Do Loop', For: 'For', Call: 'Call', Comment: 'Rem / Comment', Breakpoint: 'Breakpoint'
    };
    for (const t of SHAPE_TYPES) {
      const b = el('button', '', byName[t]);
      b.onclick = () => { pop.style.display = 'none'; insertShape(t, where); };
      pop.appendChild(b);
    }
    pop.style.display = 'grid';
    const x = Math.min(ev.clientX + 6, window.innerWidth - 250);
    const y = Math.min(ev.clientY + 6, window.innerHeight - 220);
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
    const close = (e) => { if (!pop.contains(e.target)) { pop.style.display = 'none'; document.removeEventListener('mousedown', close); } };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  // ---------- dialogs ----------
  function dialog(title, fields, onOk, opts) {
    const mask = $('#mask'), dlg = $('#dlg');
    mask.style.display = 'flex';
    dlg.innerHTML = '<h3>' + esc(title) + '</h3>';
    const get = {};
    for (const f of fields) {
      if (f.html) { dlg.appendChild(el('div', 'fld', f.html)); continue; }
      const row = el('div', 'fld');
      row.appendChild(el('label', '', f.label));
      let inp;
      if (f.opts) {
        inp = el('select');
        for (const o of f.opts) {
          const op = el('option', '', typeof o === 'string' ? o : o[1]);
          op.value = typeof o === 'string' ? o : o[0];
          inp.appendChild(op);
        }
      } else if (f.multi) { inp = el('textarea'); } else { inp = el('input'); inp.type = 'text'; }
      inp.value = f.value == null ? '' : f.value;
      inp.id = 'fld_' + f.key;
      get[f.key] = inp;
      row.appendChild(inp);
      if (f.note) { row.appendChild(el('div', 'note', f.note)); }
      dlg.appendChild(row);
    }
    const foot = el('div', 'foot');
    const ok = el('button', 'primary', (opts && opts.ok) || 'OK');
    const no = el('button', '', (opts && opts.no) || 'Cancel');
    ok.onclick = () => { close(); onOk(Object.keys(get).reduce((a, k) => { a[k] = get[k].value; return a; }, {})); };
    no.onclick = () => { close(); if (opts && opts.onCancel) { opts.onCancel(); } };
    foot.appendChild(no); foot.appendChild(ok);
    dlg.appendChild(foot);
    const first = dlg.querySelector('input,select,textarea');
    if (first) { first.focus(); if (first.select) first.select(); }
    dlg.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); ok.click(); } if (e.key === 'Escape') { close(); } };
    function close() { mask.style.display = 'none'; dlg.innerHTML = ''; dlg.onkeydown = null; }
    mask.onclick = (e) => { if (e.target === mask) { close(); } };
    return { close, get };
  }

  function varList() {
    const seen = {};
    const out = [''];
    FG.walk(curFn().body, (s) => {
      const n = s.props.variable;
      if (n && !seen[norm(n)] && s.type !== 'Call') { seen[norm(n)] = 1; out.push(n); }
    });
    for (const p of curFn().params) { if (!seen[norm(p.name)]) { seen[norm(p.name)] = 1; out.push(p.name); } }
    if (curFn().returnVar) { out.push(curFn().returnVar); }
    return out;
  }
  function declaredType(name) {
    const n = norm(name);
    for (const p of curFn().params) { if (norm(p.name) === n) { return p.type; } }
    if (n === norm(curFn().returnVar)) { return curFn().type; }
    let t = '';
    FG.walk(curFn().body, (s) => { if (s.props.variable && norm(s.props.variable) === n && s.props.type) { t = s.props.type; } });
    return t;
  }

  function editDialog(s, fresh) {
    const p = s.props;
    const V = varList().map((v) => [v, v || '(choose…)']);
    const cancelOnly = () => { if (fresh) { remove(s); } };
    const ok = (vals) => {
      if (!fresh) { snap(); }
      applyEdits(s, vals);
      render(); autosave();
      if (fresh && Object.keys(FG.COMPOUND[s.type] || {}).length === 0) { select(s.id); }
    };
    switch (s.type) {
      case 'Assign': return dialog('Assign', [
        { key: 'expression', label: 'Assignment (variable = expression)', value: p.expression, multi: true,
          note: 'Type must match. Integer variables take Integer values; use ToInteger for text.' }
      ], (v) => {
        const m = v.expression.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s*(\[[^\]]*\])?\s*=\s*([\s\S]*)$/);
        if (!m) { return badMsg('Use the form: name = expression'); }
        p.variable = m[1]; p.expression = v.expression.trim(); ok(v);
      }, { onCancel: cancelOnly });
      case 'Declare': return dialog('Declare', [
        { key: 'variable', label: 'Variable name', value: p.variable },
        { key: 'type', label: 'Type', value: p.type, opts: FG.TYPES.map((t) => [t, t]) },
        { key: 'array', label: 'Single-dimension array?', opts: [['no', 'No — scalar'], ['yes', 'Yes — array']], value: p.array ? 'yes' : 'no' },
        { key: 'size', label: 'Array size (expression)', value: p.size }
      ], (v) => {
        if (!FG.validName(v.variable)) { return badMsg('Names use letters and digits only, and may not be a keyword.'); }
        p.variable = v.variable; p.type = v.type; p.array = v.array === 'yes'; p.size = v.size;
        ok(v);
      }, { onCancel: cancelOnly });
      case 'Input': return dialog('Input', [
        { key: 'variable', label: 'Store in variable', value: p.variable, opts: V },
        { key: 'asExpr', label: 'Wrap conversion (optional)', value: p.conv || '', note: 'Leave blank to read in the variable’s own type.' }
      ], (v) => { p.variable = v.variable; p.conv = v.asExpr; ok(v); }, { onCancel: cancelOnly });
      case 'Output': return dialog('Output', [
        { key: 'expression', label: 'Expression or text to output', value: p.expression, multi: true }
      ], (v) => { p.expression = v.expression; ok(v); }, { onCancel: cancelOnly });
      case 'If': case 'While': case 'Do': return dialog(s.type === 'If' ? 'If — condition' : s.type + ' — condition', [
        { key: 'expression', label: 'Boolean expression', value: p.expression, multi: true,
          note: 'Operators: = ≠ < ≤ > ≥ and(&&) or(||) not(¬) — strings join with &' }
      ], (v) => { p.expression = v.expression; ok(v); }, { onCancel: cancelOnly });
      case 'For': return dialog('For', [
        { key: 'variable', label: 'Control variable', value: p.variable, opts: V.filter((x) => x[0]) },
        { key: 'start', label: 'Start value', value: p.start },
        { key: 'end', label: 'End value', value: p.end },
        { key: 'step', label: 'Step (positive)', value: p.step }
      ], (v) => {
        if (!FG.validName(v.variable)) { return badMsg('Pick a valid control variable.'); }
        Object.assign(p, { variable: v.variable, start: v.start, end: v.end, step: v.step || '1' });
        ok(v);
      }, { onCancel: cancelOnly });
      case 'Call': return dialog('Call', [
        { key: 'name', label: 'Function', value: p.name, opts: st.prog.functions.map((f) => [f.name, f.name + (f.type !== 'Void' ? ' → ' + f.type : '')]) },
        { key: 'params', label: 'Arguments (comma separated)', value: (p.args || []).join(', '), multi: true },
        { key: 'returnTo', label: 'Return value into', value: p.returnTo, opts: V }
      ], (v) => {
        p.name = v.name;
        p.args = v.params.split(',').map((x) => x.trim()).filter((x) => x !== '');
        p.returnTo = v.returnTo;
        ok(v);
      }, { onCancel: cancelOnly });
      case 'Comment': return dialog('Comment', [
        { key: 'text', label: 'Comment text', value: p.text, multi: true }
      ], (v) => { p.text = v.text; ok(v); }, { onCancel: cancelOnly });
      case 'Breakpoint': return dialog('Breakpoint', [
        { key: 'expression', label: 'Condition (blank = always break)', value: p.expression }
      ], (v) => { p.expression = v.expression; ok(v); }, { onCancel: cancelOnly });
      default: return dialog(s.type, [{ html: '<div class="note">The ' + s.type + ' shape marks the flow boundary and needs no settings.</div>' }], () => {}, {});
    }
  }
  function applyEdits() {}
  function badMsg(m) { status(m, true); return false; }

  // ---------- function manager ----------
  function fnDialog() {
    const mask = $('#mask'), dlg = $('#dlg');
    mask.style.display = 'flex';
    function draw() {
      dlg.innerHTML = '<h3>Functions</h3>';
      const list = el('div', 'plist');
      for (const f of st.prog.functions) {
        const row = el('div', 'fi');
        row.appendChild(el('span', 'nm', f.name + ' : ' + (f.type === 'Void' ? 'Sub' : f.type + (f.variable ? ' ' + f.variable : '')) +
          ' (' + f.params.length + ' param)'));
        const b1 = el('button', 'mini', 'edit'); b1.onclick = () => fnEdit(f);
        const b2 = el('button', 'mini', 'open'); b2.onclick = () => { st.fn = f.name; draw(); syncFnSel(); render(); };
        const b3 = el('button', 'mini', f.name === 'Main' ? '' : 'del');
        if (f.name !== 'Main') { b3.onclick = () => { snap(); st.prog.functions = st.prog.functions.filter((x) => x !== f); if (st.fn === f.name) st.fn = 'Main'; draw(); syncFnSel(); render(); autosave(); }; }
        row.appendChild(el('span', '', '')).appendChild(b2); row.appendChild(b1); row.appendChild(b3);
        list.appendChild(row);
      }
      dlg.appendChild(list);
      const add = el('button', 'primary', '+ Add function');
      add.style.marginTop = '12px';
      add.onclick = () => newFunction();
      const attrs = el('button', '', 'Program properties…');
      attrs.style.marginTop = '12px'; attrs.style.marginLeft = '8px';
      attrs.onclick = () => dialog('Program properties', [
        { key: 'name', label: 'Name', value: st.prog.attributes.name },
        { key: 'authors', label: 'Authors', value: st.prog.attributes.authors },
        { key: 'about', label: 'About', value: st.prog.attributes.about, multi: true }
      ], (v) => { snap(); Object.assign(st.prog.attributes, v); autosave(); renderCode(); });
      const foot = el('div', 'foot');
      const closeB = el('button', '', 'Close');
      closeB.onclick = () => { mask.style.display = 'none'; render(); };
      foot.appendChild(attrs); foot.appendChild(add); foot.appendChild(closeB);
      dlg.appendChild(foot);
    }
    draw();
  }
  function newFunction() {
    dialog('Add function', [
      { key: 'name', label: 'Function name', value: 'Function' + (st.prog.functions.length + 1) },
      { key: 'type', label: 'Return type', opts: [['Void', 'Sub (no return)']].concat(FG.TYPES.map((t) => [t, t])), value: 'Void' },
      { key: 'variable', label: 'Return variable', value: '' },
      { key: 'params', label: 'Parameters — name:type:byref, comma separated', value: '', multi: true,
        note: 'Example: total:Real:byref, count:Integer' }
    ], (v) => {
      if (!FG.validName(v.name) || v.name === 'Main') { return badMsg('Use a valid, unique name (letters and digits).'); }
      if (st.prog.functions.some((f) => f.name.toLowerCase() === v.name.toLowerCase())) { return badMsg('That name already exists.'); }
      snap();
      const f = FG.newFunction(v.name, v.type, v.variable || v.name + '_Result');
      f.params = parseParams(v.params);
      st.prog.functions.push(f);
      st.fn = f.name;
      syncFnSel(); render(); autosave();
    });
  }
  function parseParams(s) {
    return String(s || '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
      const a = p.split(':');
      const t = FG.TYPES.indexOf(a[1]) >= 0 ? a[1] : 'Integer';
      return { name: a[0], type: a[1] ? t : 'Integer', ref: /^byref$/i.test(a[2] || '') };
    });
  }
  function fnEdit(f) {
    dialog('Edit ' + f.name, [
      { key: 'name', label: 'Name', value: f.name },
      { key: 'type', label: 'Return type', opts: [['Void', 'Sub (no return)']].concat(FG.TYPES.map((t) => [t, t])), value: f.type },
      { key: 'variable', label: 'Return variable', value: f.variable },
      { key: 'params', label: 'Parameters', value: f.params.map((p) => p.name + ':' + p.type + (p.ref ? ':byref' : '')).join(', '), multi: true }
    ], (v) => {
      snap();
      const old = f.name;
      f.name = v.name; f.type = v.type; f.variable = v.variable;
      f.returnVar = v.type !== 'Void' ? norm(v.variable || v.name + '_Result') : '';
      f.params = parseParams(v.params);
      st.prog.functions.forEach((g) => g.body.forEach((s) => fixCall(s)));
      FG.walk(f.body, fixCall);
      function fixCall(s) { if (s.type === 'Call' && norm(s.props.name) === norm(old)) { s.props.name = v.name; } }
      st.fn = v.name;
      syncFnSel(); render(); autosave();
    });
  }
  function syncFnSel() {
    const sel = $('#fnSel');
    sel.innerHTML = '';
    for (const f of st.prog.functions) {
      const o = el('option', '', f.name + (f.type !== 'Void' ? ' : ' + f.type : ''));
      o.value = f.name;
      sel.appendChild(o);
    }
    sel.value = st.fn;
  }
  // ---------- interpreter ----------
  const MAXDEPTH = 5000;
  function newFrame(fn, vars) {
    return { fn, vars: vars || {}, depth: (st.frames.length ? st.frames[st.frames.length - 1].depth + 1 : 0) };
  }
  function rec(frame, name) { return frame.vars[norm(name)]; }
  function makeRec(type, array, size, value) {
    return { type, array: !!array, size: size || 0, value: array ? new Array(Number(size) || 0).fill(value) : value };
  }
  function display(v) {
    if (Array.isArray(v)) { return '[' + v.map(FG.valueToString).join(', ') + ']'; }
    return FG.valueToString(v);
  }
  function ctxFor(frame) {
    return {
      get(rawName, display2) {
        const r = rec(frame, rawName);
        if (!r) { throw FG.err('The variable “' + display2 + '” has not been declared in ' + frame.fn.name, 'runtime'); }
        return r.value;
      },
      index(v, i) {
        if (!Array.isArray(v)) { throw FG.err('Only arrays can be indexed'); }
        if (!Number.isInteger(i)) { throw FG.err('Array index must be an Integer'); }
        if (i < 0 || i >= v.length) { throw FG.err('Array index ' + i + ' is out of bounds (0…' + (v.length - 1) + ')'); }
        return v[i];
      },
      sizeOf(v) {
        if (Array.isArray(v)) { return v.length; }
        if (typeof v === 'string') { return v.length; }
        throw FG.err('Size needs an array or string');
      },
      typeOf(rawName) {
        const r = rec(frame, rawName);
        return r && !r.array ? r.type : '';
      },
      elemType(rawName) {
        const r = rec(frame, rawName);
        return r && r.array ? r.type : '';
      },
      eof() { return st.eofDone ? 0 : 1; }
    };
  }
  function evalx(frame, src) {
    const rpn = rpnCache(src);
    return FG.evalRpn(rpn, ctxFor(frame));
  }
  const RC = {};
  function rpnCache(src) {
    if (!RC[src]) { RC[src] = FG.parse(src || ''); }
    return RC[src];
  }
  function coerce(v, type, what) {
    if (type === 'Boolean') { if (typeof v === 'boolean') { return v; } throw FG.err(what + ': expected Boolean'); }
    if (type === 'String') { if (typeof v === 'string') { return v; } throw FG.err(what + ': expected String, got ' + FG.typeNameOf(v)); }
    if (typeof v !== 'number') { throw FG.err(what + ': expected a number, got ' + FG.typeNameOf(v)); }
    if (type === 'Integer') { return Math.trunc(v); }
    return v;
  }
  function store(frame, target, value, srcShape) {
    const m = String(target).trim().match(/^([A-Za-z][A-Za-z0-9]*)\s*(?:\[([\s\S]*)\])?$/);
    if (!m) { throw FG.err('Cannot assign to “' + target + '”'); }
    let r = rec(frame, m[1]);
    if (!r) {
      const t = guessType(value);
      r = makeRec(t, !!m[2], m[2] ? 0 : 0, m[2] ? [] : value);
      frame.vars[norm(m[1])] = r;
    }
    if (m[2]) {
      const i = Math.trunc(evalx(frame, m[2]));
      if (!Array.isArray(r.value)) { throw FG.err(r.value + ' is not an array'); }
      if (i < 0 || i >= r.value.length) { throw FG.err('Array index ' + i + ' is out of bounds (0…' + (r.value.length - 1) + ')'); }
      r.value[i] = coerce(value, r.type, 'Assignment to ' + m[1] + '[' + i + ']');
      return;
    }
    r.value = coerce(value, r.type, 'Assignment to ' + m[1]);
  }
  function guessType(v) {
    if (typeof v === 'boolean') return 'Boolean';
    if (typeof v === 'string') return 'String';
    if (typeof v === 'number') return Number.isInteger(v) ? 'Integer' : 'Real';
    return 'String';
  }

  function* runShape(frame, s) {
    const p = s.props || {};
    let brk = !!p.bpt || s.type === 'Breakpoint';
    if (s.type === 'Breakpoint' && p.expression) { brk = FG.truthy(evalx(frame, p.expression)); }
    if (st.ignoreBpts) { brk = false; }
    const marker = yield { shape: s, brk };
    if (marker === 'stop') { return; }
    switch (s.type) {
      case 'Start': case 'End': case 'Comment': return;
      case 'Declare': {
        const size = p.array ? Math.max(0, Math.trunc(coerce(evalx(frame, p.size || '0'), 'Integer', 'Array size'))) : 0;
        const val = FG.defaultValue(p.type);
        if (p.array && size && rec(frame, p.variable) && Array.isArray(rec(frame, p.variable).value) &&
          rec(frame, p.variable).value.length === size) { return; }
        if (p.array) { frame.vars[norm(p.variable)] = makeRec(p.type, true, size, val); }
        else if (!rec(frame, p.variable)) { frame.vars[norm(p.variable)] = makeRec(p.type, false, 0, val); }
        return;
      }
      case 'Assign': {
        const m = FG.splitAssign(p.expression);
        if (m.at < 0) { throw FG.err('Malformed assignment: ' + p.expression); }
        store(frame, m.lhs, evalx(frame, m.rhs), s);
        return;
      }
      case 'Output': {
        log('out', FG.valueToString(evalx(frame, p.expression)));
        return;
      }
      case 'Input': {
        const r = rec(frame, p.variable);
        const t = r ? r.type : 'String';
        const raw = yield { shape: s, input: t, name: p.variable };
        const v = readValue(raw, t, p.variable);
        if (r) { r.value = v; } else { frame.vars[norm(p.variable)] = makeRec(t, false, 0, v); }
        log('in', String(raw));
        return;
      }
      case 'If': {
        const c = FG.truthy(evalx(frame, p.expression));
        yield* runSeq(frame, s.children[c ? 'then' : 'els']);
        return;
      }
      case 'While': {
        let guard = 0;
        while (FG.truthy(evalx(frame, p.expression))) {
          yield* runSeq(frame, s.children.body);
          if (++guard > 2e6) { throw FG.err('This While loop never ends (2,000,000 turns)'); }
        }
        return;
      }
      case 'Do': {
        let guard = 0;
        do {
          yield* runSeq(frame, s.children.body);
          if (++guard > 2e6) { throw FG.err('This Do loop never ends (2,000,000 turns)'); }
        } while (!FG.truthy(evalx(frame, p.expression)));
        return;
      }
      case 'For': {
        const v = norm(p.variable);
        const a = coerce(evalx(frame, p.start), 'Integer', 'For start');
        const b = coerce(evalx(frame, p.end), 'Integer', 'For end');
        const step = Math.abs(coerce(evalx(frame, p.step || '1'), 'Integer', 'For step'));
        frame.vars[v] = makeRec('Integer', false, 0, a);
        let i = a;
        while (i <= b) {
          frame.vars[v].value = i;
          yield* runSeq(frame, s.children.body);
          i += step;
        }
        yield* runSeq(frame, s.children.done);
        return;
      }
      case 'Call': {
        const rawName = String(p.name || '');
        if (/^turtle\./i.test(rawName)) {
          const args = (p.args || []).map((a) => evalx(frame, a));
          const rv = runTurtle(rawName.slice(7), args);
          if (p.returnTo && rv != null) { store(frame, p.returnTo, rv, s); }
          if (!winVisible('turtle')) { showWin('turtle', true); }
          drawTurtle();
          return;
        }
        const target = st.prog.functions.find((f) => norm(f.name) === norm(p.name));
        if (!target) { throw FG.err('Unknown function “' + p.name + '”'); }
        if (frame.depth >= MAXDEPTH) { throw FG.err('Stack Overflow Error', 'runtime'); }
        const args = (p.args || []).map((a) => evalx(frame, a));
        const vars = {};
        target.params.forEach((pp, idx) => {
          const src = rec(frame, args.length > idx ? argName(pp, args, idx) : pp.name);
          if (pp.ref && src) { vars[norm(pp.name)] = src; }
          else {
            const val = idx < args.length ? args[idx] : FG.defaultValue(pp.type);
            vars[norm(pp.name)] = makeRec(pp.type, false, 0, coerce(val, pp.type, 'Parameter ' + pp.name));
          }
        });
        if (target.returnVar) {
          vars[target.returnVar] = makeRec(target.type, false, 0, FG.defaultValue(target.type));
        }
        for (const d of declNames(target)) {
          if (!vars[d.name]) { vars[d.name] = makeRec(d.type, d.array, d.size, d.val); }
        }
        const sub = newFrame(target, vars);
        st.frames.push(sub);
        paintWatch();
        yield* runSeq(sub, target.body);
        st.frames.pop();
        if (target.type !== 'Void' && p.returnTo) {
          const rv = rec(sub, target.returnVar);
          store(frame, p.returnTo, rv ? rv.value : null, s);
        }
        return;
      }
      default: return;
    }
  }
  function argName(pp, args, idx) {
    const src = String(args[idx] || '').trim();
    return /^[A-Za-z][A-Za-z0-9]*(\s*\[[^\]]*\])?$/.test(src) ? src : pp.name;
  }
  function declNames(fn) {
    const out = [];
    FG.walk(fn.body, (s) => {
      if (s.type === 'Declare') { out.push({ name: norm(s.props.variable), type: s.props.type, array: s.props.array, size: 0, val: FG.defaultValue(s.props.type) }); }
    });
    return out;
  }
  function* runSeq(frame, list) {
    for (const s of (list || [])) { yield* runShape(frame, s); }
  }
  function readValue(raw, type, name) {
    const s = String(raw == null ? '' : raw);
    if (type === 'String') { return s; }
    if (type === 'Boolean') {
      if (/^(true|1|yes|y)$/i.test(s.trim())) return true;
      if (/^(false|0|no|n)$/i.test(s.trim())) return false;
      throw FG.err('Input for ' + name + ' must be True or False');
    }
    if (!/^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(s)) {
      throw FG.err('Input for ' + name + ' must be a number');
    }
    const n = Number(s);
    if (type === 'Integer') {
      if (!Number.isInteger(n)) { throw FG.err('Input for ' + name + ' must be an Integer'); }
      return n;
    }
    return n;
  }
  function entryGen() {
    const main = st.prog.functions.find((f) => f.name === 'Main') || st.prog.functions[0];
    const vars = {};
    for (const d of declNames(main)) { vars[d.name] = makeRec(d.type, d.array, d.size, d.val); }
    st.frames = [newFrame(main, vars)];
    return runSeq(st.frames[0], main.body);
  }

  // ---------- driver ----------
  let timer = null;
  function delay() { return [0, 420, 160, 50, 8][st.speed]; }
  function startRun(mode) {
    mode = mode || 'running';
    if (st.mode === 'running' || st.mode === 'paused') {
      if (st.mode === 'paused') { st.mode = 'running'; loop(); }
      return;
    }
    snapRun();
    st.gen = entryGen();
    st.mode = mode;
    clearMarks();
    st.autoConsole = true;
    showWin('watch', true);
    log('sys', mode === 'step' ? 'Single-step mode — F6 advances one shape.' : 'Running ' + st.prog.attributes.name);
    loop();
  }
  function snapRun() { RC && Object.keys(RC).forEach((k) => delete RC[k]); }
  function loop() {
    if (st.mode === 'stopped' || !st.gen) { return; }
    let res;
    try {
      res = st.gen.next();
    } catch (e) {
      fail(e);
      return;
    }
    if (res.done) { finish(); return; }
    const m = res.value || {};
    highlight(m.shape, false);
    paintWatch();
    if (m.input) { awaitInput(m); return; }
    if (m.brk) {
      st.mode = 'paused';
      status('Paused at breakpoint: ' + m.shape.type + (m.shape.props.expression ? ' if ' + m.shape.props.expression : ''), true);
      paintWatch();
      return;
    }
    if (st.mode === 'step') { st.mode = 'paused'; status('Stepped ' + m.shape.type + '.'); paintWatch(); return; }
    timer = setTimeout(loop, delay());
  }
  function stepOnce() {
    if (st.mode === 'running') { return; }
    if (st.mode === 'idle' || !st.gen) { st.mode = 'step'; startRun('step'); return; }
    st.mode = 'step';
    loop();
  }
  function awaitInput(m) {
    st.waitInput = m;
    $('#inp').disabled = false;
    $('#inRow').classList.add('wait');
    $('#inp').placeholder = 'Value for ' + m.name + ' (' + m.input + ') — Enter to send';
    $('#inp').focus();
    showWin('console', true);
    status('Waiting for input into ' + m.name + ' …');
  }
  function inputIdle() { $('#inRow').classList.remove('wait'); $('#inp').disabled = true; }
  function sendInput() {
    if (!st.waitInput) { return; }
    const v = $('#inp').value;
    $('#inp').value = '';
    inputIdle();
    const m = st.waitInput;
    st.waitInput = null;
    const was = st.mode;
    st.mode = 'running';
    let res;
    try { res = st.gen.next(v); } catch (e) { fail(e); return; }
    if (res.done) { finish(); return; }
    st.mode = was === 'step' ? 'step' : (was === 'paused' ? 'paused' : 'running');
    const mm = res.value || {};
    highlight(mm.shape, false);
    paintWatch();
    if (mm.input) { awaitInput(mm); return; }
    if (mm.brk) { st.mode = 'paused'; status('Paused at breakpoint.', true); return; }
    if (st.mode !== 'running') { if (st.mode === 'step') { st.mode = 'paused'; } return; }
    timer = setTimeout(loop, delay());
  }
  function pauseRun() {
    if (st.mode === 'running') { clearTimeout(timer); st.mode = 'paused'; status('Paused.'); }
    else if (st.mode === 'paused') { st.mode = 'running'; loop(); }
  }
  function stopRun(msg) {
    clearTimeout(timer);
    st.gen = null; st.frames = []; st.waitInput = null;
    inputIdle();
    st.mode = 'idle';
    clearMarks();
    paintWatch();
    status(msg || 'Stopped.');
  }
  function finish() {
    clearTimeout(timer);
    st.gen = null; st.mode = 'idle';
    clearMarks();
    log('sys', 'End of program.');
    status('Finished.');
    paintWatch();
  }
  function fail(e) {
    clearTimeout(timer);
    st.mode = 'idle'; st.gen = null;
    inputIdle();
    log('err', (e.fgType === 'compile' ? 'Syntax error: ' : 'Runtime error: ') + e.message);
    status(e.message, true);
    if (e.shape) { highlight(e.shape, true); }
  }
  function clearMarks() {
    document.querySelectorAll('.shape.running,.shape.failed').forEach((n) => n.classList.remove('running', 'failed'));
  }

  // ---------- docked windows ----------
  const WINS = ['watch', 'console', 'code', 'turtle'];
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function winVisible(n) { const w = $('#win-' + n); return !!w && !w.classList.contains('hidden'); }
  function updateDock() { $('#dock').classList.toggle('empty', !WINS.some(winVisible)); }
  function showWin(n, on) {
    const w = $('#win-' + n);
    if (!w) { return; }
    const willShow = on == null ? !winVisible(n) : !!on;
    if (willShow === winVisible(n) && willShow) { paint(n); return; }
    w.classList.toggle('hidden', !willShow);
    const tb = $('#b' + n.charAt(0).toUpperCase() + n.slice(1));
    if (tb) { tb.classList.toggle('on', willShow); }
    if (willShow) {
      w.classList.remove('winIn'); void w.offsetWidth; w.classList.add('winIn');
      paint(n);
      if (window.innerWidth <= 900) { w.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }); }
    }
    updateDock();
  }
  function paint(n) { if (n === 'code') { renderCode(); } if (n === 'turtle') { drawTurtle(); } }

  // ---------- side panels ----------
  function log(kind, text) {
    if (kind === 'err' || (st.autoConsole && (kind === 'out' || kind === 'in'))) {
      if (!winVisible('console')) { showWin('console', true); }
      if (kind === 'out' || kind === 'in') { st.autoConsole = false; }
    }
    const box = $('#log');
    const m = el('div', 'msg ' + kind, esc(text));
    box.appendChild(m);
    box.scrollTop = box.scrollHeight;
    while (box.children.length > 400) { box.removeChild(box.firstChild); }
  }
  function status(msg, isErr) {
    const s = $('#stMsg');
    s.textContent = msg;
    s.className = isErr ? 'err' : '';
    const b = document.body.classList;
    b.toggle('failed', !!isErr);
    b.toggle('live', st.mode === 'running' || st.mode === 'step');
    b.toggle('paused', st.mode === 'paused');
  }
  const PREV = {};
  function paintWatch() {
    const fr = st.frames;
    const bar = $('#frames');
    bar.innerHTML = '';
    if (!fr.length) {
      for (const k of Object.keys(PREV)) { delete PREV[k]; }
      $('#wtbody').innerHTML = '<tr><td colspan="3" style="color:var(--dim)">No variables yet — run or step the flowchart.</td></tr>';
      return;
    }
    fr.forEach((f, i) => {
      const b = el('button', i === st.watchFrame ? 'on' : '', f.fn.name);
      b.onclick = () => { st.watchFrame = i; paintWatch(); };
      bar.appendChild(b);
    });
    if (st.watchFrame >= fr.length) { st.watchFrame = fr.length - 1; }
    const frame = fr[st.watchFrame];
    const rows = Object.keys(frame.vars).sort().map((k) => {
      const r = frame.vars[k];
      const val = display(r.value), key = st.watchFrame + '/' + k;
      const chg = PREV[key] !== undefined && PREV[key] !== val ? ' chg' : '';
      PREV[key] = val;
      return '<tr><td>' + esc(r.array ? k + '[]' : k) + '</td><td class="t' + r.type + '">' + r.type +
        (r.array ? ' array' : '') + '</td><td class="t' + r.type + chg + '">' + esc(val) + '</td></tr>';
    });
    $('#wtbody').innerHTML = rows.length ? rows.join('') :
      '<tr><td colspan="3" style="color:var(--dim)">' + esc(frame.fn.name) + ' has no local variables.</td></tr>';
  }
  function renderCode() {
    const L = CG.LANGS.find((x) => x.id === $('#langSel').value) || CG.LANGS[0];
    let text = '';
    try {
      text = CG.emit(st.prog, L);
    } catch (e) {
      text = 'Code generation failed: ' + e.message;
    }
    $('#code').textContent = text;
    $('#codeInfo').textContent = (st.prog.functions.length) + ' function(s) · .' + L.ext;
  }

  // ---------- file ----------
  function toXml() {
    const q = (s) => esc(String(s == null ? '' : s));
    const out = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<flowgorithm fileversion="' + st.prog.fileversion + '">', '  <attributes>'];
    const A = st.prog.attributes || {};
    for (const k of ['name', 'authors', 'about']) {
      out.push('    <attribute name="' + k + '" value="' + q(A[k] || '') + '"/>');
    }
    out.push('  </attributes>');
    for (const f of st.prog.functions) {
      out.push('<function name="' + q(f.name) + '" type="' + q(f.type) + '" variable="' + q(f.variable) + '">');
      out.push('<parameters>');
      for (const p of f.params) { out.push('<parameter name="' + q(p.name) + '" type="' + q(p.type) + '" link="' + (p.ref ? 'true' : 'false') + '"/>'); }
      out.push('</parameters>');
      out.push('<body>');
      seqXml(f.body, out);
      out.push('</body></function>');
    }
    out.push('</flowgorithm>');
    return out.join('\n');

    function seqXml(list, o) {
      for (const s of list) { shapeXml(s, o); }
    }
    function shapeXml(s, o) {
      const p = s.props;
      const ind = '  ';
      switch (s.type) {
        case 'Start': o.push(ind + '<start/>'); return;
        case 'End': o.push(ind + '<end/>'); return;
        case 'Declare': o.push(ind + '<declare name="' + q(p.variable) + '" type="' + q(p.type) +
          '" array="' + (p.array ? 'True' : 'False') + '" size="' + q(p.size) + '"/>'); return;
        case 'Assign': o.push(ind + '<assign variable="' + q(p.variable || FG.splitAssign(p.expression).lhs) +
          '" expression="' + q(p.expression) + '"/>'); return;
        case 'Input': o.push(ind + '<input variable="' + q(p.variable) + '"/>'); return;
        case 'Output': o.push(ind + '<output expression="' + q(p.expression) + '"/>'); return;
        case 'Comment': o.push(ind + '<comment text="' + q(p.text) + '"/>'); return;
        case 'Breakpoint': o.push(ind + '<breakpoint expression="' + q(p.expression) + '"/>'); return;
        case 'Call': {
          o.push(ind + '<call name="' + q(p.name) + '" return="' + q(p.returnTo || '') + '">');
          for (const a of (p.args || [])) { o.push(ind + '  <parameter expression="' + q(a) + '"/>'); }
          o.push(ind + '</call>');
          return;
        }
        case 'If': {
          o.push(ind + '<if expression="' + q(p.expression) + '">');
          o.push(ind + '  <then>'); seqXml(s.children.then, o); o.push(ind + '  </then>');
          o.push(ind + '  <else>'); seqXml(s.children.els, o); o.push(ind + '  </else>');
          o.push(ind + '</if>');
          return;
        }
        case 'While': o.push(ind + '<while expression="' + q(p.expression) + '">'); seqXml(s.children.body, o); o.push(ind + '</while>'); return;
        case 'Do': o.push(ind + '<do expression="' + q(p.expression) + '">'); seqXml(s.children.body, o); o.push(ind + '</do>'); return;
        case 'For': {
          o.push(ind + '<for variable="' + q(p.variable) + '" start="' + q(p.start) + '" end="' + q(p.end) + '" step="' + q(p.step) + '">');
          seqXml(s.children.body, o);
          o.push(ind + '  <done>'); seqXml(s.children.done, o); o.push(ind + '  </done>');
          o.push(ind + '</for>');
          return;
        }
        default: return;
      }
    }
  }
  function fromXml(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.querySelector('parsererror')) { throw new Error('This file is not a valid .fprg flowchart.'); }
    const prog = { attributes: { name: 'Imported', authors: '', about: '' }, fileversion: doc.documentElement.getAttribute('fileversion') || '4.2', functions: [] };
    for (const a of doc.querySelectorAll('attributes > attribute')) {
      const k = (a.getAttribute('name') || '').toLowerCase();
      if (['name', 'authors', 'about'].includes(k)) { prog.attributes[k] = a.getAttribute('value') || ''; }
    }
    for (const fnode of doc.querySelectorAll('function')) {
      const f = { name: fnode.getAttribute('name') || 'Main', type: fnode.getAttribute('type') || 'Void',
        variable: fnode.getAttribute('variable') || '', returnVar: '', params: [], body: [] };
      f.returnVar = f.type !== 'Void' ? norm(f.variable || f.name + '_Result') : '';
      for (const p of fnode.querySelectorAll(':scope > parameters > parameter')) {
        f.params.push({ name: p.getAttribute('name'), type: p.getAttribute('type') || 'Integer',
          ref: String(p.getAttribute('link')).toLowerCase() === 'true' });
      }
      const body = fnode.querySelector(':scope > body');
      if (body) { f.body = parseSeq(body); }
      if (!f.body.some((s) => s.type === 'Start')) { f.body.unshift(FG.shape('Start', {})); }
      if (!f.body.some((s) => s.type === 'End')) { f.body.push(FG.shape('End', {})); }
      FG.walk(f.body, (s) => { if (s.type === 'Start') { s.props.main = f.name === 'Main'; } });
      prog.functions.push(f);
    }
    if (!prog.functions.length) { prog.functions = [FG.newProgram().functions[0]]; }
    return prog;

    function parseSeq(node) {
      const list = [];
      for (const child of node.children) {
        const s = parseShape(child);
        if (s) { list.push(s); }
      }
      return list;
    }
    function parseShape(n) {
      const g = (a) => n.getAttribute(a) || '';
      const tag = n.tagName.toLowerCase();
      if (tag === 'start') { return FG.shape('Start', {}); }
      if (tag === 'end') { return FG.shape('End', {}); }
      if (tag === 'declare') { return FG.shape('Declare', { variable: g('name') || g('variable'), type: g('type') || 'Integer', array: /true/i.test(g('array')), size: g('size') }); }
      if (tag === 'assign') {
        const v = g('variable'), e = g('expression');
        const full = v && FG.splitAssign(e).at < 0 ? v + ' = ' + e : e;
        return FG.shape('Assign', { variable: v || FG.splitAssign(full).lhs, expression: full });
      }
      if (tag === 'input') { return FG.shape('Input', { variable: g('variable') }); }
      if (tag === 'output') { return FG.shape('Output', { expression: g('expression') }); }
      if (tag === 'comment') { return FG.shape('Comment', { text: g('text') }); }
      if (tag === 'breakpoint') { return FG.shape('Breakpoint', { expression: g('expression') }); }
      if (tag === 'call') {
        const args = [];
        for (const p of n.children) { if (p.tagName.toLowerCase() === 'parameter') { args.push(p.getAttribute('expression') || ''); } }
        return FG.shape('Call', { name: g('name'), args, returnTo: g('return') });
      }
      if (tag === 'if') {
        const s = FG.shape('If', { expression: g('expression') });
        const t = n.querySelector(':scope > then'), e2 = n.querySelector(':scope > else');
        s.children.then = parseSeq(t || n); s.children.els = parseSeq(e2 || emptyNode());
        return s;
      }
      if (tag === 'while' || tag === 'do') {
        const s = FG.shape(tag === 'while' ? 'While' : 'Do', { expression: g('expression') });
        s.children.body = kids(n, ['body']);
        return s;
      }
      if (tag === 'for') {
        const s = FG.shape('For', { variable: g('variable'), start: g('start'), end: g('end'), step: g('step') || '1' });
        s.children.body = kids(n, ['done']);
        s.children.done = kids(n, null, 'done');
        return s;
      }
      return null;
    }
    function kids(n, skipSegment, only) {
      const out = [];
      for (const c of n.children) {
        const t = c.tagName.toLowerCase();
        if (only) { if (t === only) { return parseSeq(c); } continue; }
        if (['then', 'else', 'done', 'parameter', 'parameters', 'body'].includes(t)) { continue; }
        const s = parseShape(c);
        if (s) { out.push(s); }
      }
      return out;
    }
    function emptyNode() { return document.createElement('empty'); }
  }
  function download(name, text, mime) {
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }


  // ---------- samples ----------
  function S(type, props) { return FG.shape(type, props); }
  function sampleProgram(id) {
    const P = FG.newProgram();
    const main = P.functions[0];
    function add(list) { main.body.splice(main.body.length - 1, 0, ...list); }
    function kids(s) { return s.children; }

    if (id === 'guess') {
      P.attributes.name = 'Number Guessing Game';
      const loop = S('While', { expression: 'guess <> secret' });
      add([
        S('Declare', { variable: 'secret', type: 'Integer', array: false, size: '0' }),
        S('Declare', { variable: 'guess', type: 'Integer', array: false, size: '0' }),
        S('Declare', { variable: 'tries', type: 'Integer', array: false, size: '0' }),
        S('Assign', { variable: 'secret', expression: 'secret = Random(100) + 1' }),
        S('Assign', { variable: 'tries', expression: 'tries = 0' }),
        S('Assign', { variable: 'guess', expression: 'guess = -1' }),
        S('Output', { expression: '"I am thinking of a number from 1 to 100."' }),
        loop
      ]);
      const ask = S('Output', { expression: '"Have a guess:"' });
      const inp = S('Input', { variable: 'guess' });
      const cnt = S('Assign', { variable: 'tries', expression: 'tries = tries + 1' });
      const test = S('If', { expression: 'guess = secret' });
      kids(loop).body.push(ask, inp, cnt, test);
      const inner = S('If', { expression: 'guess < secret' });
      kids(test).then.push(S('Output', { expression: '"You got it in " & ToString(tries) & " tries!"' }));
      kids(test).els.push(inner);
      kids(inner).then.push(S('Output', { expression: '"Too low."' }));
      kids(inner).els.push(S('Output', { expression: '"Too high."' }));
    } else if (id === 'fib') {
      P.attributes.name = 'Fibonacci with by-reference call';
      const f = FG.newFunction('Next', 'Void', '');
      f.params = [{ name: 'a', type: 'Integer', ref: true }, { name: 'b', type: 'Integer', ref: true }];
      f.body.splice(f.body.length - 1, 0,
        S('Declare', { variable: 't', type: 'Integer', array: false, size: '0' }),
        S('Assign', { variable: 't', expression: 't = a + b' }),
        S('Assign', { variable: 'a', expression: 'a = b' }),
        S('Assign', { variable: 'b', expression: 'b = t' }));
      P.functions.push(f);
      const loop = S('For', { variable: 'i', start: '1', end: '15', step: '1' });
      add([
        S('Declare', { variable: 'a', type: 'Integer', array: false, size: '0' }),
        S('Declare', { variable: 'b', type: 'Integer', array: false, size: '0' }),
        S('Assign', { variable: 'a', expression: 'a = 0' }),
        S('Assign', { variable: 'b', expression: 'b = 1' }),
        loop,
        S('Output', { expression: '"finished"' })
      ]);
      kids(loop).body.push(S('Output', { expression: 'ToString(a)' }),
        S('Call', { name: 'Next', args: ['a', 'b'], returnTo: '' }));
    } else if (id === 'sieve') {
      P.attributes.name = 'Prime print with array';
      const fill = S('For', { variable: 'i', start: '2', end: 'n', step: '1' });
      const scan = S('For', { variable: 'p', start: '2', end: 'n', step: '1' });
      add([
        S('Declare', { variable: 'n', type: 'Integer', array: false, size: '0' }),
        S('Declare', { variable: 'flag', type: 'Boolean', array: true, size: '101' }),
        S('Declare', { variable: 'i', type: 'Integer', array: false, size: '0' }),
        S('Declare', { variable: 'p', type: 'Integer', array: false, size: '0' }),
        S('Output', { expression: '"Sieve up to (max 100):"' }),
        S('Input', { variable: 'n' }),
        fill,
        scan
      ]);
      kids(fill).body.push(S('Assign', { variable: 'flag[i]', expression: 'flag[i] = True' }));
      const test = S('If', { expression: 'flag[p] = True' });
      kids(scan).body.push(test);
      kids(test).then.push(S('Output', { expression: '"prime: " & ToString(p)' }));
      kids(test).els.push(S('Output', { expression: '"skip: " & ToString(p)' }));
      kids(scan).done.push(S('Output', { expression: '"done"' }));
    } else if (id === 'turtle') {
      P.attributes.name = 'Turtle spiral';
      const loop = S('For', { variable: 'i', start: '1', end: '90', step: '1' });
      add([
        S('Declare', { variable: 'side', type: 'Real', array: false, size: '0' }),
        S('Assign', { variable: 'side', expression: 'side = 4' }),
        loop
      ]);
      kids(loop).body.push(
        S('Call', { name: 'Turtle.Forward', args: ['side'], returnTo: '' }),
        S('Call', { name: 'Turtle.Right', args: ['5'], returnTo: '' }),
        S('Assign', { variable: 'side', expression: 'side = side + 1.5' })
      );
    } else {
      P.attributes.name = 'Hello, FlowForge';
      add([
        S('Declare', { variable: 'name', type: 'String', array: false, size: '0' }),
        S('Output', { expression: '"What is your name?"' }),
        S('Input', { variable: 'name' }),
        S('Output', { expression: '"Hello, " & name & "!"' })
      ]);
    }
    return P;
  }

  // ---------- turtle (F11) ----------
  function newTurtle() { return { x: 0, y: 0, a: 0, down: true, color: cssVar('--teal') || '#0d9488', width: 2.5, pen: [] }; }
  const TC = { w: 640, h: 420 };
  function drawTurtle() {
    const c = $('#turtle');
    if (!c) { return; }
    if (!st.turtle) { st.turtle = newTurtle(); }
    const t = st.turtle, g = c.getContext('2d');
    const dark = document.documentElement.dataset.theme !== 'pastel';
    g.fillStyle = cssVar('--bg2') || (dark ? '#0d0d18' : '#ffffff');
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = dark ? 'rgba(255,255,255,.07)' : 'rgba(28,40,70,.08)';
    g.lineWidth = 1;
    for (let x = 0; x <= c.width; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke(); }
    for (let y = 0; y <= c.height; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
    g.strokeStyle = dark ? 'rgba(255,255,255,.16)' : 'rgba(28,40,70,.18)';
    g.beginPath(); g.moveTo(0, c.height / 2); g.lineTo(c.width, c.height / 2);
    g.moveTo(c.width / 2, 0); g.lineTo(c.width / 2, c.height); g.stroke();
    const ox = c.width / 2, oy = c.height / 2;
    g.lineWidth = t.width;
    g.lineCap = 'round';
    g.strokeStyle = t.color;
    let px = ox + t.x, py = oy - t.y;
    for (const seg of t.pen) {
      if (seg.move) { px = seg.x; py = seg.y; continue; }
      g.beginPath(); g.moveTo(px, py); g.lineTo(seg.x, seg.y); g.stroke();
      px = seg.x; py = seg.y;
    }
    g.fillStyle = cssVar('--amber') || '#d97706';
    g.beginPath(); g.arc(px, py, 4.5, 0, 7); g.fill();
  }
  function turtleMove(d) {
    const t = st.turtle;
    const rad = t.a * Math.PI / 180;
    t.x = t.x + Number(d) * Math.cos(rad);
    t.y = t.y + Number(d) * Math.sin(rad);
    const x = TC.w / 2 + t.x, y = TC.h / 2 - t.y;
    if (t.down) { t.pen.push({ x, y }); }
    drawTurtle();
  }
  function runTurtle(name, args) {
    if (!st.turtle) { st.turtle = newTurtle(); }
    const t = st.turtle;
    const k = String(name).toLowerCase();
    if (k === 'forward') { turtleMove(args[0]); return null; }
    if (k === 'back') { turtleMove(-Number(args[0])); return null; }
    if (k === 'right') { t.a += Number(args[0]); return null; }
    if (k === 'left') { t.a -= Number(args[0]); return null; }
    if (k === 'up') { t.down = false; return null; }
    if (k === 'down') { t.down = true; return null; }
    if (k === 'clear') { t.pen = []; t.x = 0; t.y = 0; t.a = 0; drawTurtle(); return null; }
    if (k === 'color') { t.color = String(args[0]); return null; }
    if (k === 'width') { t.width = Number(args[0]) || 2; return null; }
    if (k === 'xcoord') { return Math.round(t.x * 100) / 100; }
    if (k === 'ycoord') { return Math.round(t.y * 100) / 100; }
    if (k === 'show' || k === 'hide') { return null; }
    throw FG.err('Unknown Turtle function “' + name + '”');
  }

  // ---------- image export ----------
  function exportSvg() {
    const flow = $('#flow');
    const base = flow.getBoundingClientRect();
    const W = Math.max(320, Math.ceil(flow.scrollWidth)), H = Math.max(240, Math.ceil(flow.scrollHeight));
    const stroke = 'stroke="' + cssVar('--teal') + '" stroke-width="2" fill="' + cssVar('--panel') + '"';
    const parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
      '" viewBox="0 0 ' + W + ' ' + H + '"><rect width="100%" height="100%" fill="' + cssVar('--bg') + '"/>'];
    flow.querySelectorAll('.wire').forEach((n) => {
      const r = n.getBoundingClientRect();
      parts.push('<line x1="' + (r.left - base.left + r.width / 2) + '" y1="' + (r.top - base.top) +
        '" x2="' + (r.left - base.left + r.width / 2) + '" y2="' + (r.bottom - base.top) +
        '" stroke="' + cssVar('--violet') + '" stroke-width="2"/>');
    });
    flow.querySelectorAll('.shape').forEach((n) => {
      const r = n.getBoundingClientRect();
      const x = r.left - base.left, y = r.top - base.top, w = r.width, h = r.height;
      const s = findShape(n.dataset.id) || { type: 'Assign', props: {} };
      const geom = GEOM[s.type] || 'g-rect';
      const poly = (pts) => '<polygon points="' + pts.map((p) => p.map((v) => Math.round(v * 10) / 10).join(',')).join(' ') + '" ' + stroke + '/>';
      if (geom.indexOf('g-diamond') >= 0) { parts.push(poly([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]])); }
      else if (geom.indexOf('g-hex') >= 0) { parts.push(poly([[x + w * .15, y], [x + w * .85, y], [x + w, y + h / 2], [x + w * .85, y + h], [x + w * .15, y + h], [x, y + h / 2]])); }
      else if (geom.indexOf('g-para') >= 0) { parts.push(poly([[x + w * .12, y], [x + w, y], [x + w * .88, y + h], [x, y + h]])); }
      else if (geom.indexOf('g-oct') >= 0) { parts.push(poly([[x + w * .3, y], [x + w * .7, y], [x + w, y + h * .3], [x + w, y + h * .7], [x + w * .7, y + h], [x + w * .3, y + h], [x, y + h * .7], [x, y + h * .3]])); }
      else {
        const rx = geom.indexOf('g-stadium') >= 0 ? h / 2 : 6;
        parts.push('<rect x="' + Math.round(x) + '" y="' + Math.round(y) + '" width="' + Math.round(w) +
          '" height="' + Math.round(h) + '" rx="' + rx + '" ' + stroke +
          (geom.indexOf('g-dash') >= 0 ? ' stroke-dasharray="6 4"' : '') + '/>');
      }
      textLines(n).forEach((ln, i, all) => {
        parts.push('<text x="' + (x + w / 2) + '" y="' + (y + h / 2 + (i - (all.length - 1) / 2) * 15 + 5) +
          '" fill="' + cssVar('--ink') + '" font-family="monospace" font-size="13" text-anchor="middle">' + esc(ln) + '</text>');
      });
    });
    parts.push('</svg>');
    return parts.join('');
    function textLines(n) {
      const face = n.querySelector('.face');
      const t = face.querySelector('.txt');
      const src = t || face;
      const one = src.textContent.replace(/\s+/g, ' ').trim();
      if (one.length <= 38) { return [one]; }
      const words = one.split(' ');
      const out = [];
      let line = '';
      for (const word of words) {
        if ((line + ' ' + word).trim().length > 38) { out.push(line.trim()); line = word; } else { line += ' ' + word; }
      }
      if (line.trim()) { out.push(line.trim()); }
      return out;
    }
  }
  function b64(s) { return btoa(unescape(encodeURIComponent(s))); }
  function pngFrom(svg, cb) {
    const img = new Image();
    img.onload = () => {
      const c = el('canvas');
      c.width = Math.min(img.width * 2, 4000);
      c.height = Math.min(img.height * 2, 4000);
      const g = c.getContext('2d');
      g.fillStyle = cssVar('--bg');
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => cb(b));
    };
    img.onerror = () => status('SVG could not be rasterised here; download the SVG instead.', true);
    img.src = 'data:image/svg+xml;base64,' + b64(svg);
  }
  function imageDialog() {
    const svg = exportSvg();
    const mask = $('#mask'), dlg = $('#dlg');
    mask.style.display = 'flex';
    dlg.innerHTML = '<h3>Export flowchart image</h3><div class="note">SVG keeps the theme colours and stays sharp at any size. ' +
      'PNG is rasterised at 2×. Copy image puts the vector on the clipboard (secure context only).</div>';
    const foot = el('div', 'foot');
    const mk = (label, cls, fn) => { const b = el('button', cls, label); b.onclick = () => { fn(); mask.style.display = 'none'; }; foot.appendChild(b); };
    mk('Download SVG', 'primary', () => download(st.prog.attributes.name + '.svg', svg, 'image/svg+xml'));
    mk('Download PNG', '', () => pngFrom(svg, (b) => {
      const a = el('a');
      a.href = URL.createObjectURL(b);
      a.download = st.prog.attributes.name + '.png';
      a.click();
    }));
    mk('Copy image', '', () => {
      fetch('data:image/svg+xml;base64,' + b64(svg)).then((r) => r.blob()).then(async (blob) => {
        await navigator.clipboard.write([new ClipboardItem({ 'image/svg+xml': blob })]);
        status('Flowchart image copied to clipboard.');
      }).catch(() => status('Clipboard image not available here — use Download.', true));
    });
    mk('Close', '', () => {});
    dlg.appendChild(foot);
  }

  function helpDialog() {
    const rows = [
      ['F1', 'Help \u00b7 F5 run \u00b7 F6 step \u00b7 F7 pause \u00b7 F8 stop'],
      ['F9 / F10', 'Variable Watch / Console windows'], ['F11 / F12', 'Turtle graphics / generated source'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+S / Ctrl+O', 'Save .fprg / open .fprg'],
      ['Ctrl+C / Ctrl+V', 'Copy / paste the selected shape'], ['Del', 'Remove the selected shape'],
      ['B', 'Toggle a breakpoint on the selected shape'], ['Ctrl+wheel', 'Zoom the canvas'],
      ['Double-click', 'Edit a shape'], ['Hover a wire \u2192 +', 'Insert a shape on that connector'],
      ['Esc', 'Close menus, popups and dialogs']
    ].map((r) => '<tr><td><kbd>' + r[0] + '</kbd></td><td>' + r[1] + '</td></tr>').join('');
    const shapes = [
      ['Declare', 'Creates a typed variable or a one-dimensional array.'],
      ['Assign', 'variable = expression. The type must match the variable.'],
      ['Input / Output', 'Reads a value / writes a value to the console.'],
      ['If', 'True and False branches merge back below the diamond.'],
      ['While / Do', 'Pre-test loop / post-test loop that runs until the condition is true.'],
      ['For', 'Integer counter from start to end with a positive step; the Done branch runs after the loop.'],
      ['Call', 'Calls a function. Parameters can be by value or by reference; a return value can be stored.'],
      ['Comment / Breakpoint', 'A note for readers / a pause point with an optional Boolean condition.']
    ].map((r) => '<tr><td style="color:var(--teal);font-family:var(--mono)">' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('');
    dialog('FlowForge — help', [{ html:
      '<div class="note" style="margin:0 0 12px">A flowchart-first programming studio: draw the logic, run it with a live ' +
      'interpreter, watch every variable, and export the same flowchart as source code in 19 languages.</div>' +
      '<div class="pTitle" style="margin-top:0">Keyboard</div><table>' + rows + '</table>' +
      '<div class="pTitle">Shapes</div><table>' + shapes + '</table>' +
      '<div class="pTitle">Expressions</div><div class="note" style="margin:0">' +
      'Types: <b>Integer, Real, String, Boolean</b> and arrays of those. Operators: ' +
      '<span style="font-family:var(--mono)">^ * / % mod + - &amp; = == != &lt;&gt; &lt; &gt; &lt;= &gt;= and or not</span> ' +
      '(symbol spellings <span style="font-family:var(--mono)">× ÷ ≠ ≤ ≥ ∧ ∨ ¬ ↑</span> also work). ' +
      'Integer ÷ Integer truncates; any Real operand gives a Real result. ' +
      'Intrinsics: Abs, Int, Sgn, Sqrt, Ln, Log, Log10, Sin, Cos, Tan, Arcsin, Arccos, Arctan, ' +
      'Len, Char, Size, ToChar, ToCode, ToFixed, ToInteger, ToReal, ToString, Random, EOF. Constants: pi, true, false.</div>' +
      '<div class="pTitle">About</div><div class="note" style="margin:0">FlowForge is an independent, original implementation ' +
      'of the flowchart-programming workflow popularised by Flowgorithm. It shares no code or artwork with that application. ' +
      'Files use the open .fprg XML layout, so charts can be exchanged both ways.</div>' }],
      () => {}, { ok: 'Got it', no: 'Close' });
  }

  // ---------- view prefs ----------
  const UI = 'flowforge.ui.v2';
  const THEMES = [['pastel', 'Pastel light'], ['aurora', 'Aurora dark'], ['ember', 'Ember dark'], ['ion', 'Ion dark']];
  let prefs = { zoom: 1, grid: true, motion: true, theme: 'aurora' };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(UI) || '{}')); } catch (e) {}
  function savePrefs() { try { localStorage.setItem(UI, JSON.stringify(prefs)); } catch (e) {} }
  // phone/tablet: the chart must fit the window without horizontal panning
  let fitLock = false;
  function fitZoom() {
    const wrap = $('#canvasWrap'), flow = $('#flow');
    // #flow stretches to min-width:100%, so measure its true content width unzoomed and unstretched
    const prevZoom = flow.style.zoom;
    flow.style.zoom = '1';
    flow.style.minWidth = '0';
    const w = flow.getBoundingClientRect().width;
    flow.style.minWidth = '';
    flow.style.zoom = prevZoom;
    const avail = wrap.clientWidth - 26;
    if (!(w > 0) || !(avail > 0) || w <= avail) { return 1; }
    return Math.max(.6, Math.min(1, avail / w));
  }
  function autoFit() {
    if (fitLock || window.innerWidth > 900) { return; }
    const z = fitZoom();
    if (Math.abs(z - prefs.zoom) > .005) { setZoom(z); }
  }
  function setZoom(z) {
    prefs.zoom = Math.min(2, Math.max(.4, Math.round(z * 100) / 100));
    $('#flow').style.zoom = prefs.zoom;
    $('#zVal').textContent = Math.round(prefs.zoom * 100) + '%';
    savePrefs();
  }
  function setTheme(t) {
    prefs.theme = t;
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) { meta.setAttribute('content', cssVar('--bg')); }
    savePrefs();
    render();
    drawTurtle();
    const nice = THEMES.filter((x) => x[0] === t).map((x) => x[1])[0] || t;
    status('Colour theme: ' + nice + '.');
  }
  function setSpeed(s) {
    st.speed = s;
    $('#spd').value = String(s);
    savePrefs();
    status('Execution speed ' + s + '\u00d7.');
  }
  function selShape() { return st.sel ? findShape(st.sel) : null; }
  function canEditSel() { const s = selShape(); return !!s && s.type !== 'Start' && s.type !== 'End'; }
  function copySel() { if (!st.sel) { return; } st.clip = JSON.stringify(selShape()); status('Shape copied — Ctrl+V to paste.'); }
  function deleteSel() { if (canEditSel()) { remove(selShape()); } }
  function loadExample(id) {
    snap(); stopRun();
    st.prog = sampleProgram(id); st.fn = 'Main';
    rebuild();
    status('Loaded example: ' + st.prog.attributes.name + '. Press F5 to run.');
  }
  function attrsDialog() {
    dialog('Program attributes', [
      { key: 'name', label: 'Program name', value: st.prog.attributes.name },
      { key: 'authors', label: 'Authors', value: st.prog.attributes.authors },
      { key: 'about', label: 'About', value: st.prog.attributes.about, multi: true }
    ], (v) => {
      snap(); Object.assign(st.prog.attributes, v); autosave(); render(); renderCode();
      status('Attributes updated.');
    });
  }
  function aboutDialog() {
    dialog('About FlowForge', [{ html:
      '<div class="note" style="margin:0"><b>FlowForge</b> \u2014 visual logic studio, build 2026.11.<br><br>' +
      'An independent, original implementation of the flowchart-programming workflow: a vertical auto-laid-out chart, ' +
      'a live interpreter with a single-step debugger, variable watch, console, turtle graphics and source generation for ' +
      + CG.LANGS.length + ' languages. Files use the open <span style="font-family:var(--mono)">.fprg</span> XML layout.<br><br>' +
      'FlowForge shares no code, shapes, icons or strings with any other flowchart application.<br><br>' +
      'Program: ' + esc(st.prog.attributes.name) + ' \u00b7 ' + st.prog.functions.length + ' function(s) \u00b7 author: ' +
      esc(st.prog.attributes.authors || '\u2014') + '</div>' }], () => {}, { ok: 'Got it', no: 'Close' });
  }
  function removeAllBpts() {
    snap();
    const strip = (list) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        if (s.type === 'Breakpoint') { list.splice(i, 1); continue; }
        if (s.props && s.props.bpt) { delete s.props.bpt; }
        for (const k of Object.keys(s.children || {})) { strip(s.children[k]); }
      }
    };
    st.prog.functions.forEach((f) => strip(f.body));
    render(); autosave();
    status('All breakpoints removed.');
  }

  // ---------- menu model ----------
  const MENUS = [
    { label: 'File', items: () => [
      { label: 'New flowchart\u2026', kbd: 'Ctrl+N', fn: newDoc },
      { label: 'Open .fprg\u2026', kbd: 'Ctrl+O', fn: () => $('#file').click() },
      { label: 'Save .fprg', kbd: 'Ctrl+S', fn: saveFile },
      { label: 'Export image\u2026', fn: imageDialog },
      { sep: true },
      { label: 'Examples', sub: () => [
        { label: 'Number guessing game', fn: () => loadExample('guess') },
        { label: 'Fibonacci + by-reference', fn: () => loadExample('fib') },
        { label: 'Prime sieve (array)', fn: () => loadExample('sieve') },
        { label: 'Turtle spiral', fn: () => loadExample('turtle') },
        { label: 'Hello, world', fn: () => loadExample('hello') }
      ] },
      { label: 'Function manager\u2026', fn: fnDialog },
      { label: 'Program attributes\u2026', fn: attrsDialog }
    ] },
    { label: 'Edit', items: () => [
      { label: 'Undo', kbd: 'Ctrl+Z', fn: undo, off: !st.undo.length },
      { label: 'Redo', kbd: 'Ctrl+Y', fn: redo, off: !st.redo.length },
      { sep: true },
      { label: 'Copy shape', kbd: 'Ctrl+C', fn: copySel, off: !st.sel },
      { label: 'Paste shape', kbd: 'Ctrl+V', fn: paste, off: !st.clip },
      { label: 'Delete shape', kbd: 'Del', fn: deleteSel, off: !canEditSel() },
      { sep: true },
      { label: 'Edit selected shape', kbd: 'Enter', fn: () => { const s = selShape(); if (s) { editDialog(s); } }, off: !st.sel }
    ] },
    { label: 'View', items: () => [
      { label: 'Zoom in', kbd: 'Ctrl+wheel', fn: () => setZoom(prefs.zoom + .1) },
      { label: 'Zoom out', fn: () => setZoom(prefs.zoom - .1) },
      { label: 'Reset zoom', fn: () => { setZoom(1); $('#canvasWrap').scrollTo({ top: 0, behavior: 'smooth' }); status('View reset to 100%.'); } },
      { sep: true },
      { label: 'Blueprint grid', check: prefs.grid, fn: () => {
        prefs.grid = !prefs.grid; $('#canvasWrap').dataset.grid = prefs.grid ? 'on' : 'off'; savePrefs();
        status(prefs.grid ? 'Grid on.' : 'Grid off.');
      } },
      { label: 'Animations', check: prefs.motion, fn: () => {
        prefs.motion = !prefs.motion; document.documentElement.dataset.motion = prefs.motion ? 'on' : 'off'; savePrefs();
        status(prefs.motion ? 'Animation on.' : 'Animation off.');
      } },
      { sep: true },
      { label: 'Colour theme', sub: () => THEMES.map((t) => ({ label: t[1], radio: true, on: prefs.theme === t[0], fn: () => setTheme(t[0]) })) }
    ] },
    { label: 'Run', items: () => [
      { label: 'Run', kbd: 'F5', fn: () => startRun('running') },
      { label: 'Step', kbd: 'F6', fn: stepOnce },
      { label: 'Pause / resume', kbd: 'F7', fn: pauseRun },
      { label: 'Stop', kbd: 'F8', fn: () => stopRun() },
      { sep: true },
      { label: 'Speed', sub: () => [[1, '1\u00d7 \u00b7 slow'], [2, '2\u00d7 \u00b7 normal'], [3, '3\u00d7 \u00b7 fast'], [4, '4\u00d7 \u00b7 fastest']]
        .map((x) => ({ label: x[1], radio: true, on: st.speed === x[0], fn: () => setSpeed(x[0]) })) }
    ] },
    { label: 'Debug', items: () => [
      { label: 'Toggle breakpoint', kbd: 'B', fn: () => { if (canEditSel()) { toggleBpt(selShape()); } }, off: !canEditSel() },
      { label: 'Remove all breakpoints', fn: removeAllBpts },
      { label: 'Ignore all breakpoints', check: st.ignoreBpts, fn: () => {
        st.ignoreBpts = !st.ignoreBpts; markBpt();
        status(st.ignoreBpts ? 'Breakpoints are being ignored.' : 'Breakpoints are active.');
      } },
      { sep: true },
      { label: 'Variable Watch', kbd: 'F9', check: winVisible('watch'), fn: () => showWin('watch') },
      { label: 'Console', kbd: 'F10', check: winVisible('console'), fn: () => showWin('console') }
    ] },
    { label: 'Tools', items: () => [
      { label: 'Function manager\u2026', fn: fnDialog },
      { label: 'Source Code', kbd: 'F12', check: winVisible('code'), fn: () => showWin('code') },
      { label: 'Turtle Graphics', kbd: 'F11', check: winVisible('turtle'), fn: () => showWin('turtle') },
      { sep: true },
      { label: 'Program attributes\u2026', fn: attrsDialog },
      { label: 'Export image\u2026', fn: imageDialog }
    ] },
    { label: 'Help', items: () => [
      { label: 'Keyboard & shapes', kbd: 'F1', fn: helpDialog },
      { label: 'About FlowForge', fn: aboutDialog }
    ] }
  ];

  // ---------- wiring ----------
  function boot() {
    let openWrap = null;
    function closeMenus() {
      document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
      document.querySelectorAll('.menuBtn.on').forEach((b) => b.classList.remove('on'));
      document.querySelectorAll('.hasSub.subOpen').forEach((s) => s.classList.remove('subOpen'));
      openWrap = null;
    }
    function openMenu(wrap, btn, drop, m) {
      closeMenus();
      renderItems(drop, m.items());
      wrap.classList.add('open'); btn.classList.add('on'); openWrap = wrap;
      drop.style.marginLeft = '0px';
      const r = drop.getBoundingClientRect();
      const over = r.right - window.innerWidth + 8;
      if (over > 0) { drop.style.marginLeft = '-' + Math.min(over, Math.max(0, r.left - 8)) + 'px'; }
    }
    function renderItems(box, items) {
      box.innerHTML = '';
      for (const it of items) {
        if (!it) { continue; }
        if (it.sep) { box.appendChild(el('div', 'msep')); continue; }
        const mi = el('button', 'mi');
        if (it.off) { mi.classList.add('off'); }
        mi.appendChild(el('span', 'ind', it.radio ? (it.on ? '\u25cf' : '') : (it.check ? '\u2713' : '')));
        mi.appendChild(el('span', 'ml', esc(it.label)));
        if (it.kbd) { mi.appendChild(el('span', 'mk', esc(it.kbd))); }
        if (it.sub) {
          const parent = el('div', 'hasSub');
          mi.appendChild(el('span', 'arr', '\u25b8'));
          const sd = el('div', 'drop sub');
          parent.appendChild(mi); parent.appendChild(sd);
          box.appendChild(parent);
          renderItems(sd, typeof it.sub === 'function' ? it.sub() : it.sub);
          mi.onclick = (e) => { e.stopPropagation(); parent.classList.toggle('subOpen'); };
        } else {
          mi.onclick = (e) => { e.stopPropagation(); closeMenus(); if (it.fn) { it.fn(); } };
          box.appendChild(mi);
        }
      }
    }
    const nav = $('#menus');
    nav.innerHTML = '';
    for (const m of MENUS) {
      const wrap = el('div', 'menu');
      const btn = el('button', 'menuBtn', esc(m.label));
      const drop = el('div', 'drop');
      btn.onclick = (e) => {
        e.stopPropagation();
        if (openWrap === wrap) { closeMenus(); return; }
        openMenu(wrap, btn, drop, m);
      };
      btn.onmouseenter = () => {
        if (!openWrap || openWrap === wrap) { return; }
        openMenu(wrap, btn, drop, m);
      };
      wrap.appendChild(btn); wrap.appendChild(drop);
      nav.appendChild(wrap);
    }
    document.addEventListener('mousedown', (e) => { if (openWrap && !openWrap.contains(e.target)) { closeMenus(); } });

    // window buttons + close boxes
    $('#bWatch').onclick = () => showWin('watch');
    $('#bConsole').onclick = () => showWin('console');
    $('#bCode').onclick = () => showWin('code');
    $('#bTurtle').onclick = () => showWin('turtle');
    document.querySelectorAll('.winX').forEach((b) => { b.onclick = () => showWin(b.dataset.win, false); });

    // toolbar
    $('#bNew').onclick = newDoc;
    $('#bOpen').onclick = () => $('#file').click();
    $('#bSave').onclick = saveFile;
    $('#bImg').onclick = imageDialog;
    $('#bUndo').onclick = undo;
    $('#bRedo').onclick = redo;
    $('#bRun').onclick = () => startRun('running');
    $('#bStep').onclick = stepOnce;
    $('#bPause').onclick = pauseRun;
    $('#bStop').onclick = () => stopRun();
    $('#bFn').onclick = fnDialog;
    $('#bHelp').onclick = helpDialog;
    $('#spd').value = String(st.speed);
    $('#spd').onchange = (e) => setSpeed(Number(e.target.value));
    const tb = $('#toolbar');
    const tbMore = () => document.body.classList.toggle('tbMore', tb.scrollWidth > tb.clientWidth + 4);
    tbMore();
    let lastFitW = window.innerWidth;
    window.addEventListener('resize', () => {
      tbMore();
      if (Math.abs(window.innerWidth - lastFitW) < 40) { return; }
      lastFitW = window.innerWidth;
      fitLock = false;
      autoFit();
    });
    tb.addEventListener('wheel', (e) => {
      if (tb.scrollWidth <= tb.clientWidth) { return; }
      e.preventDefault();
      tb.scrollLeft += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY);
      tbMore();
    }, { passive: false });
    $('#file').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) { return; }
      const r = new FileReader();
      r.onload = () => openText(String(r.result), f.name.replace(/\.(fprg|xml)$/i, ''));
      r.readAsText(f);
      e.target.value = '';
    };
    $('#fnSel').onchange = (e) => { stopRun(); st.fn = e.target.value; render(); };

    // zoom pill + ctrl-wheel zoom
    $('#zIn').onclick = () => { fitLock = true; setZoom(prefs.zoom + .1); };
    $('#zOut').onclick = () => { fitLock = true; setZoom(prefs.zoom - .1); };
    $('#zFit').onclick = () => { fitLock = true; setZoom(fitZoom()); $('#canvasWrap').scrollTo({ top: 0, left: 0, behavior: 'smooth' }); status('Flowchart fitted to the window.'); };
    $('#canvasWrap').addEventListener('wheel', (e) => {
      if (!e.ctrlKey) { return; }
      e.preventDefault();
      fitLock = true;
      setZoom(prefs.zoom + (e.deltaY < 0 ? .1 : -.1));
    }, { passive: false });

    // code window
    const ls = $('#langSel');
    for (const L of CG.LANGS) { const o = el('option', '', L.name); o.value = L.id; ls.appendChild(o); }
    ls.onchange = renderCode;
    $('#bCopy').onclick = () => { navigator.clipboard.writeText($('#code').textContent); status('Generated source copied.'); };
    $('#bDl').onclick = () => {
      const L = CG.LANGS.find((x) => x.id === ls.value) || CG.LANGS[0];
      download(st.prog.attributes.name + '.' + L.ext, $('#code').textContent);
    };

    // console input
    $('#bSend').onclick = sendInput;
    $('#inp').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { sendInput(); } };
    $('#canvasWrap').onclick = () => select(null);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeMenus(); $('#pop').style.display = 'none'; return; }
      if (e.target.matches('input,textarea,select')) { return; }
      const k = e.key;
      const map = {
        F1: helpDialog,
        F5: () => startRun('running'), F6: stepOnce, F7: pauseRun, F8: () => stopRun(),
        F9: () => showWin('watch'), F10: () => showWin('console'), F11: () => showWin('turtle'), F12: () => showWin('code')
      };
      if (map[k]) { e.preventDefault(); map[k](); return; }
      if (k === 'b' && st.sel) { e.preventDefault(); toggleBpt(selShape()); return; }
      if ((k === 'Delete' || k === 'Backspace') && st.sel) {
        const s = findShape(st.sel);
        if (s && s.type !== 'Start' && s.type !== 'End') { e.preventDefault(); remove(s); }
        return;
      }
      const lk = k.toLowerCase();
      if (e.ctrlKey && !e.altKey && lk === 'z') { e.preventDefault(); undo(); }
      else if (e.ctrlKey && (lk === 'y' || (e.shiftKey && lk === 'z'))) { e.preventDefault(); redo(); }
      else if (e.ctrlKey && lk === 's') { e.preventDefault(); saveFile(); }
      else if (e.ctrlKey && lk === 'o') { e.preventDefault(); $('#file').click(); }
      else if (e.ctrlKey && lk === 'n') { e.preventDefault(); newDoc(); }
      else if (e.ctrlKey && lk === 'c' && st.sel) { e.preventDefault(); copySel(); }
      else if (e.ctrlKey && lk === 'v' && st.clip) { e.preventDefault(); paste(); }
    });

    setZoom(prefs.zoom);
    $('#canvasWrap').dataset.grid = prefs.grid ? 'on' : 'off';
    document.documentElement.dataset.motion = prefs.motion ? 'on' : 'off';
    document.documentElement.dataset.theme = prefs.theme;
    WINS.forEach((n) => {
      const tb = $('#b' + n.charAt(0).toUpperCase() + n.slice(1));
      if (tb) { tb.classList.toggle('on', winVisible(n)); }
    });
    updateDock();

    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) {}
    st.prog = saved && saved.functions && saved.functions.length ? saved : sampleProgram('guess');
    st.fn = st.prog.functions.some((f) => f.name === 'Main') ? 'Main' : st.prog.functions[0].name;
    syncFnSel();
    render();
    renderCode();
    status('Ready \u2014 F5 run, F6 step, hover a connector and click + to insert a shape.');
  }

  function paste() {
    snap();
    const s = JSON.parse(st.clip);
    renewIds(s);
    const fn = curFn();
    let index = fn.body.length - 1;
    if (st.sel) { const w = locate(st.sel); if (w) { index = w.index; } }
    fn.body.splice(index, 0, s);
    render(); autosave();
  }
  function undo() {
    if (!st.undo.length) { return; }
    st.redo.push(JSON.stringify(st.prog));
    st.prog = JSON.parse(st.undo.pop());
    if (!st.prog.functions.some((f) => f.name === st.fn)) { st.fn = st.prog.functions[0].name; }
    stopRun('Undo.');
    rebuild();
  }
  function redo() {
    if (!st.redo.length) { return; }
    st.undo.push(JSON.stringify(st.prog));
    st.prog = JSON.parse(st.redo.pop());
    if (!st.prog.functions.some((f) => f.name === st.fn)) { st.fn = st.prog.functions[0].name; }
    stopRun('Redo.');
    rebuild();
  }
  function rebuild() { syncFnSel(); render(); autosave(); renderCode(); }
  function newDoc() {
    dialog('New flowchart', [{ key: 'start', label: 'Start from', opts: [
      ['blank', 'Blank Main'], ['guess', 'Sample: Number Guessing Game'],
      ['fib', 'Sample: Fibonacci with by-reference call'], ['sieve', 'Sample: sieve with an array'],
      ['turtle', 'Sample: Turtle spiral']], value: 'blank' }], (v) => {
      snap();
      st.prog = v.start === 'blank' ? FG.newProgram() : sampleProgram(v.start);
      st.fn = 'Main';
      stopRun('New document.');
      rebuild();
    });
  }
  function saveFile() {
    download(st.prog.attributes.name + '.fprg', toXml(), 'application/xml');
    status('Saved ' + st.prog.attributes.name + '.fprg');
  }
  function openText(text, name) {
    try {
      snap();
      st.prog = fromXml(text);
      if (name) { st.prog.attributes.name = name; }
      st.fn = st.prog.functions.some((f) => f.name === 'Main') ? 'Main' : st.prog.functions[0].name;
      stopRun('Loaded ' + st.prog.attributes.name + '.');
      rebuild();
    } catch (e) {
      status(e.message, true);
    }
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', boot); } else { boot(); }
  window.FF = { st, FG, CG, sampleProgram, toXml, fromXml, exportSvg, startRun, stepOnce, stopRun,
    runTurtle, render, renderCode, status, evalx, curFn, showWin, winVisible, setTheme, setZoom,
    setSpeed, loadExample, removeAllBpts, WINS };
})();
