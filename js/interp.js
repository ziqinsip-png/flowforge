// fg-core: Flowgorithm-compatible expression language + program model.
(function () {
  const FG = (window.FG = {});

  FG.TYPES = ['Integer', 'Real', 'String', 'Boolean'];
  FG.RESERVED = new Set(['and', 'or', 'not', 'mod', 'true', 'false', 'pi', 'integer',
    'real', 'string', 'boolean', 'void', 'array', 'main', 'then', 'else', 'while', 'do',
    'for', 'if', 'call', 'return', 'break', 'continue', 'end', 'declare', 'input',
    'output', 'assign', 'comment']);

  // ---------- identifier + text helpers ----------
  FG.normName = function (s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  };
  FG.validName = function (s) {
    s = String(s || '');
    return /^[A-Za-z][A-Za-z0-9]*$/.test(s) && !FG.RESERVED.has(s.toLowerCase());
  };
  FG.html = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };
  FG.eqNum = function (a, b) { return Math.abs(a - b) < 1e-9; };

  // ---------- tokenizer ----------
  const OPS3 = ['not ', 'AND ', 'OR '];
  const SYMBOLS = {
    '\u2260': '!=', '\u2264': '<=', '\u2265': '>=', '\u2227': '&&', '\u2228': '||',
    '\u00AC': '!', '\u00D7': '*', '\u00F7': '/', '\u2191': '^', '\u2261': '=='
  };
  FG.tokenize = function (src) {
    const t = [];
    let i = 0;
    const S = String(src);
    const isDigit = (c) => c >= '0' && c <= '9';
    const isAlpha = (c) => /[A-Za-z_\u03C0]/.test(c);
    while (i < S.length) {
      const c = S[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
      if (SYMBOLS[c]) { t.push({ k: 'sym', v: SYMBOLS[c] }); i++; continue; }
      if (c === '"') {
        let s = '';
        i++;
        while (i < S.length && S[i] !== '"') { s += S[i++]; }
        i++;
        t.push({ k: 'str', v: s });
        continue;
      }
      if (isDigit(c) || (c === '.' && isDigit(S[i + 1] || ''))) {
        let s = '';
        while (i < S.length && (isDigit(S[i]) || S[i] === '.')) { s += S[i++]; }
        if (S[i] === 'e' || S[i] === 'E') {
          s += S[i++];
          if (S[i] === '+' || S[i] === '-') { s += S[i++]; }
          while (i < S.length && isDigit(S[i])) { s += S[i++]; }
        }
        t.push({ k: 'num', v: s, real: /[.eE]/.test(s) });
        continue;
      }
      if (isAlpha(c)) {
        let s = '';
        while (i < S.length && /[A-Za-z0-9_\u03C0]/.test(S[i])) { s += S[i++]; }
        const low = s.toLowerCase();
        if (low === 'and' || low === 'or' || low === 'not' || low === 'mod') {
          t.push({ k: 'word', v: low });
          continue;
        }
        t.push({ k: 'id', v: s });
        continue;
      }
      const two = S.substr(i, 2);
      if (['==', '!=', '<=', '>=', '<>', '&&', '||'].includes(two)) {
        t.push({ k: 'op', v: two === '<>' ? '!=' : two });
        i += 2;
        continue;
      }
      if ('+-*/%^&<>=(),[]!'.includes(c)) { t.push({ k: 'op', v: c }); i++; continue; }
      throw FG.err('Unexpected character \u201C' + c + '\u201D in expression');
    }
    return t;
  };

  // ---------- parser -> RPN ----------
  const BIN = {
    '||': { p: 1 }, 'or': { p: 1 },
    '&&': { p: 2 }, 'and': { p: 2 },
    '==': { p: 3 }, '!=': { p: 3 }, '<': { p: 3 }, '>': { p: 3 }, '<=': { p: 3 }, '>=': { p: 3 },
    '&': { p: 4 },
    '+': { p: 5 }, '-': { p: 5 },
    '*': { p: 6 }, '/': { p: 6 }, '%': { p: 6 }, 'mod': { p: 6 },
    '^': { p: 7, r: true }
  };
  FG.parse = function (src) {
    const toks = typeof src === 'string' ? FG.tokenize(src) : src;
    const out = [];
    const stack = [];
    let prev = null;
    let want = true;
    const push = (x) => { out.push(x); prev = x; want = false; };
    const pushBin = (o, op) => {
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.t === 'un') { out.push(stack.pop()); continue; }
        if (top.t === 'bin' && (BIN[top.op].p > o.p || (BIN[top.op].p === o.p && !o.r))) { out.push(stack.pop()); continue; }
        break;
      }
      stack.push({ t: 'bin', op: op });
      want = true;
    };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.k === 'num') { push({ t: 'num', v: parseFloat(t.v), real: !!t.real }); }
      else if (t.k === 'str') { push({ t: 'str', v: t.v }); }
      else if (t.k === 'id') {
        const name = t.v.toLowerCase();
        const nxt = toks[i + 1];
        if (nxt && nxt.k === 'op' && nxt.v === '(') {
          i++;
          const args = [];
          let depth = 1, cur = [];
          for (; i + 1 < toks.length; i++) {
            const a = toks[i + 1];
            if (a.k === 'op' && a.v === ')') { depth--; if (!depth) break; }
            else if (a.k === 'op' && a.v === '(') { depth++; }
            else if (depth === 1 && a.k === 'op' && a.v === ',') { args.push(cur); cur = []; continue; }
            cur.push(a);
          }
          if (depth !== 0) { throw FG.err('Missing closing parenthesis'); }
          if (cur.length || args.length) { args.push(cur); }
          i++;
          if (name === 'eof') { push({ t: 'call', name: 'eof', args: [] }); }
          else { push({ t: 'call', name: name, args: args.map((a) => FG.parse(a)) }); }
        } else if (FG.CONST[name]) {
          push(FG.CONST[name]());
        } else if (nxt && nxt.k === 'op' && nxt.v === '[') {
          i++;
          let depth = 1, cur = [];
          for (; i + 1 < toks.length; i++) {
            const a = toks[i + 1];
            if (a.k === 'op' && a.v === '[') { depth++; }
            else if (a.k === 'op' && a.v === ']') { depth--; if (!depth) break; }
            cur.push(a);
          }
          if (depth !== 0) { throw FG.err('Missing closing bracket'); }
          i++;
          push({ t: 'index', name: t.v, idx: FG.parse(cur) });
        } else {
          push({ t: 'var', name: t.v });
        }
      } else if (t.k === 'word' || t.k === 'sym') {
        if (t.v === 'not') { stack.push({ t: 'un', op: 'not' }); continue; }
        if (t.v === '!') { stack.push({ t: 'un', op: 'not' }); continue; }
        pushBin(BIN[t.v], t.v);
      } else if (t.k === 'op') {
        const v = t.v;
        if (v === '(') { stack.push({ t: 'par' }); want = true; }
        else if (v === ')') {
          let found = false;
          while (stack.length) {
            const top = stack.pop();
            if (top.t === 'par') { found = true; break; }
            out.push(top);
          }
          if (!found) { throw FG.err('Unbalanced parenthesis'); }
          want = false;
        } else if (v === '-') {
          if (want) { stack.push({ t: 'un', op: 'neg' }); }
          else { pushBin(BIN['-'], '-'); }
        } else if (v === '!') { stack.push({ t: 'un', op: 'not' }); want = true; }
        else if (v === '=') { pushBin(BIN['=='], '=='); }
        else if (BIN[v]) { pushBin(BIN[v], v); }
        else if (v === ',') { throw FG.err('Unexpected comma'); }
        else if (v === '[' || v === ']') { throw FG.err('Unexpected bracket'); }
        else { throw FG.err('Unexpected operator \u201C' + v + '\u201D'); }
      }
    }
    while (stack.length) {
      const s = stack.pop();
      if (s.t === 'par') { throw FG.err('Unbalanced parenthesis'); }
      out.push(s);
    }
    return out;
  };

  // ---------- constants + intrinsics ----------
  FG.CONST = {
    pi: () => ({ t: 'num', v: Math.PI }),
    '\u03C0': () => ({ t: 'num', v: Math.PI }),
    true: () => ({ t: 'bool', v: true }),
    false: () => ({ t: 'bool', v: false })
  };
  const E = FG.err = function (msg, type) {
    const e = new Error(msg);
    e.fgType = type || 'runtime';
    return e;
  };
  const num = (x, what) => {
    if (typeof x === 'number') { return x; }
    throw E(what + ' needs a number, got ' + FG.typeNameOf(x));
  };
  const str = (x, what) => {
    if (typeof x === 'string') { return x; }
    if (typeof x === 'boolean') { return x ? 'True' : 'False'; }
    throw E(what + ' needs a String, got ' + FG.typeNameOf(x));
  };
  const bool = (x, what) => {
    if (typeof x === 'boolean') { return x; }
    throw E(what + ' needs a Boolean, got ' + FG.typeNameOf(x));
  };
  const cat = (x) => {
    if (typeof x === 'number') { return FG.valueToString(x); }
    return str(x, 'Concatenation');
  };
  FG.FN = {
    abs: [1, (a) => Math.abs(num(a[0], 'Abs'))],
    arcsin: [1, (a) => Math.asin(num(a[0], 'Arcsin'))],
    arccos: [1, (a) => Math.acos(num(a[0], 'Arccos'))],
    arctan: [1, (a) => Math.atan(num(a[0], 'Arctan'))],
    cos: [1, (a) => Math.cos(num(a[0], 'Cos'))],
    sin: [1, (a) => Math.sin(num(a[0], 'Sin'))],
    tan: [1, (a) => Math.tan(num(a[0], 'Tan'))],
    int: [1, (a) => Math.trunc(num(a[0], 'Int'))],
    ln: [1, (a) => { const x = num(a[0], 'Ln'); if (x <= 0) { throw E('Ln needs a positive value'); } return Math.log(x); }],
    log: [1, (a) => { const x = num(a[0], 'Log'); if (x <= 0) { throw E('Log needs a positive value'); } return Math.log(x); }],
    log10: [1, (a) => { const x = num(a[0], 'Log10'); if (x <= 0) { throw E('Log10 needs a positive value'); } return Math.log10(x); }],
    sgn: [1, (a) => Math.sign(num(a[0], 'Sgn'))],
    sqrt: [1, (a) => { const x = num(a[0], 'Sqrt'); if (x < 0) { throw E('Sqrt needs a non-negative value'); } return Math.sqrt(x); }],
    len: [1, (a) => str(a[0], 'Len').length],
    char: [2, (a) => { const s = str(a[0], 'Char'); const i = num(a[1], 'Char'); if (i < 0 || i >= s.length) { throw E('Char index out of range'); } return s[i]; }],
    tochar: [1, (a) => String.fromCharCode(num(a[0], 'ToChar'))],
    tocode: [1, (a) => (str(a[0], 'ToCode').length ? str(a[0], 'ToCode').charCodeAt(0) : 0)],
    tofixed: [2, (a) => { const x = num(a[0], 'ToFixed'); const d = num(a[1], 'ToFixed'); if (d < 0 || d > 15) { throw E('ToFixed digits out of range'); } return x.toFixed(Math.trunc(d)); }],
    tointeger: [1, (a) => {
      if (typeof a[0] === 'number') { return Math.trunc(a[0]); }
      const s = str(a[0], 'ToInteger').trim();
      const n = Number(s);
      if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s) || !isFinite(n)) { throw E('ToInteger: \u201C' + s + '\u201D is not a number'); }
      return Math.trunc(n);
    }],
    toreal: [1, (a) => {
      if (typeof a[0] === 'number') { return a[0]; }
      const s = str(a[0], 'ToReal').trim();
      const n = Number(s);
      if (s === '' || !isFinite(n)) { throw E('ToReal: \u201C' + s + '\u201D is not a number'); }
      return n;
    }],
    tostring: [1, (a) => FG.valueToString(a[0])],
    random: [1, (a) => { const n = num(a[0], 'Random'); if (n <= 0) { throw E('Random needs a positive bound'); } return Math.floor(Math.random() * Math.trunc(n)); }]
  };
  FG.valueToString = function (v) {
    if (typeof v === 'boolean') { return v ? 'True' : 'False'; }
    if (typeof v === 'number') {
      if (Number.isInteger(v) && Math.abs(v) < 1e15) { return String(v); }
      return String(v);
    }
    if (v == null) { return ''; }
    return String(v);
  };
  FG.typeNameOf = function (v) {
    if (typeof v === 'boolean') { return 'Boolean'; }
    if (typeof v === 'number') { return 'Real'; }
    if (typeof v === 'string') { return 'String'; }
    if (Array.isArray(v)) { return 'Array'; }
    return 'Void';
  };

  // ---------- evaluator ----------
  const FNR = { abs: 'k', arcsin: 1, arccos: 1, arctan: 1, cos: 1, sin: 1, tan: 1, ln: 1, log: 1,
    log10: 1, sqrt: 1, toreal: 1, tofixed: 1, int: 0, sgn: 0, len: 0, tocode: 0, tointeger: 0,
    random: 0, char: 0, tostring: 0, eof: 0, size: 0 };
  function realOf(fn, argR) {
    const m = FNR[fn];
    if (m === 'k') { return !!argR; }
    return !!m;
  }

  FG.evalRpn = function (rpn, ctx) { return ev(rpn, ctx).v; };
  FG.evalRpnR = ev;

  function ev(rpn, ctx) {
    const st = [];
    const bin = (op) => {
      const b = st.pop();
      const a = st.pop();
      if (!a || !b) { throw E('Incomplete expression'); }
      const v = FG.applyBin(op, a.v, b.v, ctx, a.r, b.r);
      st.push({ v, r: binReal(op, a.r, b.r) });
    };
    for (const n of rpn) {
      if (n.t === 'num') { st.push({ v: n.v, r: !!n.real }); }
      else if (n.t === 'str') { st.push({ v: n.v, r: false }); }
      else if (n.t === 'bool') { st.push({ v: n.v, r: false }); }
      else if (n.t === 'var') { st.push({ v: ctx.get(FG.normName(n.name), n.name), r: ctx.typeOf ? ctx.typeOf(n.name) === 'Real' : false }); }
      else if (n.t === 'index') {
        const i = FG.evalRpn(n.idx, ctx);
        st.push({ v: ctx.index(ctx.get(FG.normName(n.name), n.name), i),
          r: ctx.elemType ? ctx.elemType(n.name) === 'Real' : false });
      } else if (n.t === 'un') {
        const a = st.pop();
        if (!a) { throw E('Incomplete expression'); }
        if (n.op === 'neg') {
          if (typeof a.v === 'boolean') { throw E('Cannot negate a Boolean'); }
          st.push({ v: -a.v, r: a.r });
        } else { st.push({ v: !bool(a.v, 'Not'), r: false }); }
      } else if (n.t === 'bin') { bin(n.op); }
      else if (n.t === 'call') {
        const args = (n.args || []).map((a) => ev(a, ctx));
        if (n.name === 'size') {
          if (args.length !== 1) { throw E('Size needs 1 argument', 'compile'); }
          st.push({ v: ctx.sizeOf(args[0].v), r: false });
          continue;
        }
        if (n.name === 'eof') { st.push({ v: ctx.eof ? ctx.eof() : 1, r: false }); continue; }
        const f = FG.FN[n.name];
        if (!f) { throw E('Unknown function \u201C' + n.name + '\u201D', 'compile'); }
        if (args.length !== f[0]) { throw E(n.name + ' needs ' + f[0] + ' argument(s)', 'compile'); }
        st.push({ v: f[1](args.map((a) => a.v), ctx), r: realOf(n.name, args[0] && args[0].r) });
      } else { throw E('Bad expression node'); }
    }
    if (st.length !== 1) { throw E('Incomplete expression'); }
    return st[0];
  }
  function binReal(op, ar, br) {
    switch (op) {
      case '/': return true;
      case '+': case '-': case '*': case '^': return !!(ar || br);
      default: return false;
    }
  }
  FG.truthy = function (v) { return v === true; };
  FG.applyBin = function (op, a, b, ctx, ar, br) {
    switch (op) {
      case '&': return cat(a) + cat(b);
      case '+': case '-': case '*': {
        const x = num(a, op), y = num(b, op);
        return op === '+' ? x + y : op === '-' ? x - y : x * y;
      }
      case '/': {
        const x = num(a, '/'), y = num(b, '/');
        if (y === 0) { throw E('Division by zero'); }
        return x / y;
      }
      case '%': case 'mod': {
        const x = num(a, 'Mod'), y = num(b, 'Mod');
        if (y === 0) { throw E('Modulo by zero'); }
        return x % y;
      }
      case '^': {
        const x = num(a, '^'), y = num(b, '^');
        return Math.pow(x, y);
      }
      case '==': case '!=': {
        let eq;
        if (typeof a === 'number' && typeof b === 'number') { eq = FG.eqNum(a, b); }
        else if (typeof a === typeof b) { eq = a === b; }
        else { eq = false; }
        return op === '==' ? eq : !eq;
      }
      case '<': case '>': case '<=': case '>=': {
        let x, y;
        if (typeof a === 'string' && typeof b === 'string') { x = a; y = b; }
        else if (typeof a === 'number' && typeof b === 'number') { x = a; y = b; }
        else { throw E('Cannot compare ' + FG.typeNameOf(a) + ' with ' + FG.typeNameOf(b)); }
        return op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
      }
      case '&&': case 'and': return bool(a, 'And') && bool(b, 'And');
      case '||': case 'or': return bool(a, 'Or') || bool(b, 'Or');
      default: throw E('Unknown operator ' + op);
    }
  };

  // ---------- program model ----------
  FG.COMPOUND = {
    If: { then: 'then', els: 'els' },
    While: { body: 'body' },
    Do: { body: 'body' },
    For: { body: 'body', done: 'done' }
  };
  FG.LABELS = {
    then: ['True', 'v'], els: ['False', 'x'], body: null, done: ['Done', 'x']
  };
  let seq = 1;
  FG.newId = () => 'f' + (seq++) + '-' + Math.random().toString(36).slice(2, 7);
  FG.shape = function (type, props) {
    const s = { id: FG.newId(), type: type, props: props || {}, children: {} };
    const c = FG.COMPOUND[type];
    if (c) { for (const k of Object.values(c)) { s.children[k] = []; } }
    return s;
  };
  FG.newFunction = function (name, type, variable) {
    const f = {
      name: name, type: type || 'Void', variable: variable || '',
      returnVar: '', params: [], body: []
    };
    if (type && type !== 'Void') {
      f.returnVar = FG.normName(f.variable || (name + '_result'));
      f.body.push(FG.shape('Assign', { variable: f.returnVar, expression: FG.defaultValue(type) }));
    }
    if (f.name !== 'Main') { f.body.unshift(FG.shape('Start', {})); }
    f.body.push(FG.shape('End', {}));
    return f;
  };
  FG.defaultValue = function (type) {
    return type === 'Integer' ? 0 : type === 'Real' ? 0 : type === 'Boolean' ? false : '';
  };
  FG.newProgram = function () {
    const main = { name: 'Main', type: 'Void', variable: '', returnVar: '', params: [], body: [FG.shape('Start', {}), FG.shape('End', {})] };
    return {
      attributes: { name: 'Untitled', authors: '', about: '' },
      fileversion: '4.2',
      functions: [main]
    };
  };
  FG.walk = function (body, fn) {
    for (const s of body) {
      fn(s);
      if (s.children) { for (const k of Object.keys(s.children)) { FG.walk(s.children[k], fn); } }
    }
  };
  FG.clone = function (o) { return JSON.parse(JSON.stringify(o)); }
})();
