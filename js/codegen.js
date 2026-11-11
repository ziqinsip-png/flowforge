// fg-codegen: translate the flowchart tree into 19 target languages.
(function () {
  const FG = window.FG;

  function rpnToAst(rpn) {
    const st = [];
    for (const n of rpn) {
      if (n.t === 'bin') { const b = st.pop(), a = st.pop(); st.push({ t: 'bin', op: n.op, a, b }); }
      else if (n.t === 'un') { st.push({ t: 'un', op: n.op, a: st.pop() }); }
      else if (n.t === 'call') { st.push({ t: 'call', name: n.name, args: (n.args || []).map(rpnToAst) }); }
      else if (n.t === 'index') { st.push({ t: 'index', name: n.name, i: rpnToAst(n.idx) }); }
      else { st.push(n); }
    }
    return st.length ? st[st.length - 1] : { t: 'str', v: '' };
  }
  const PC = { '||': 1, or: 1, '&&': 2, and: 2, '==': 3, '=': 3, '!=': 3, '<>': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
    '&': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, mod: 6, '^': 7 };
  const ALIAS = { '==': 'eq', '=': 'eq', '!=': 'ne', '<>': 'ne', '<': 'lt', '>': 'gt', '<=': 'le', '>=': 'ge',
    '&&': 'and', and: 'and', '||': 'or', or: 'or', '&': 'cat', mod: 'mod', '%': 'mod', '/': 'div', '^': 'pow' };
  function fill(s, map) {
    return String(s == null ? '' : s).replace(/\{(\d+|\w+)\}/g, (m, k) => (map[k] == null ? '' : map[k]));
  }

  const BASE = {
    cmt: '//', q: '"', semi: ';', indent: false, lower: true, style: 'brace',
    op: { and: '&&', or: '||', not: '!', eq: '==', ne: '!=', lt: '<', gt: '>', le: '<=', ge: '>=',
      cat: '+', mod: '%', pow: '^', div: '/' },
    ty: { Integer: 'var', Real: 'var', String: 'var', Boolean: 'var', Void: 'void' },
    z: { Integer: '0', Real: '0', String: '""', Boolean: 'false' },
    bool: ['true', 'false'],
    k: { i: 'if ({c}) {', e: '} else {', ei: '}', w: 'while ({c}) {', ew: '}',
      f: 'for ({v} = {a}; {v} <= {b}; {v} += {s}) {', ef: '}', dw: 'do {', edw: '} while ({c});',
      beg: '', end: '}', pass: '' },
    decl: '{n} = {e};', out: 'print({e});', read: 'input()', incast: { Integer: null, Real: null, Boolean: null },
    call: '{p}({a});', fncall: '{t} = {p}({a});',
    fnTpl: '{t} {n}({p}) {\n{b}\n}', mainTpl: '{t} {n}() {\n{b}\n}', ret: null, F: {}, cast: 'js'
  };
  function L(o) {
    const out = Object.assign({}, BASE, o);
    ['op', 'ty', 'z', 'k', 'F', 'incast'].forEach((g) => { out[g] = Object.assign({}, BASE[g], o[g]); });
    return out;
  }

  // ---- shared function maps ----
  function jsF() {
    return { abs: 'Math.abs({0})', int: 'Math.trunc({0})', sqrt: 'Math.sqrt({0})', ln: 'Math.log({0})',
      log: 'Math.log({0})', log10: 'Math.log10({0})', sin: 'Math.sin({0})', cos: 'Math.cos({0})',
      tan: 'Math.tan({0})', arcsin: 'Math.asin({0})', arccos: 'Math.acos({0})', arctan: 'Math.atan({0})',
      sgn: 'Math.sign({0})', len: '{0}.length', char: '{0}.substr({1}, 1)', size: '{0}.length',
      random: 'Math.floor(Math.random() * {0})', tointeger: 'Math.trunc(Number({0}))',
      toreal: 'Number({0})', tostring: 'String({0})', tochar: 'String.fromCharCode({0})',
      tocode: '{0}.charCodeAt(0)', tofixed: 'Number({0}).toFixed({1})' };
  }
  function dotF(m) {
    return Object.assign({ abs: m + 'Abs({0})', int: m + 'Truncate({0})', sqrt: m + 'Sqrt({0})',
      ln: m + 'Log({0})', log: m + 'Log({0})',
      log10: m === 'Math.' ? 'Math.Log10({0})' : m + 'Log10({0})',
      sin: m + 'Sin({0})', cos: m + 'Cos({0})', tan: m + 'Tan({0})', arcsin: m + 'Asin({0})',
      arccos: m + 'Acos({0})', arctan: m + 'Atan({0})', len: '{0}.Length', char: '{0}[{1}].ToString()',
      size: '{0}.Length', random: m + 'Next((int) ({0}))', tointeger: 'Convert.ToInt32({0})',
      toreal: 'Convert.ToDouble({0})', tostring: 'Convert.ToString({0})', tofixed: '{0}.ToString("F" + {1})' }, {});
  }
  function stdF(p) {
    return { abs: p + 'abs({0})', int: p + 'trunc({0})', sqrt: p + 'sqrt({0})', ln: p + 'log({0})',
      log: p + 'log({0})', log10: p + 'log10({0})', sin: p + 'sin({0})', cos: p + 'cos({0})',
      tan: p + 'tan({0})', arcsin: p + 'asin({0})', arccos: p + 'acos({0})', arctan: p + 'atan({0})',
      len: p + 'len({0})', char: p + 'char({0}, {1})', size: p + 'size({0})', random: p + 'random({0})' };
  }

  const PY_K = { i: 'if {c}:', e: 'else:', ei: '', w: 'while {c}:', ew: '', f: 'for {v} in range({a}, {b} + 1, {s}):',
    ef: '', dw: 'while True:', edw: '', beg: '', end: '', pass: 'pass' };

  const LANGS = [
    L({ id: 'pseudocode', name: 'Pseudocode', ext: 'txt', cmt: 'REM', semi: '', lower: false, style: 'vb',
      op: { and: 'And', or: 'Or', not: 'Not ', eq: '=', ne: '<>', cat: '&', mod: 'Mod' },
      ty: { Integer: 'Integer', Real: 'Real', String: 'String', Boolean: 'Boolean', Void: 'Sub' },
      z: { String: '""', Boolean: 'False' }, bool: ['True', 'False'],
      k: { i: 'If {c} Then', e: 'Else', ei: 'End If', w: 'While {c}', ew: 'End While',
        f: 'For {v} = {a} To {b} Step {s}', ef: 'Next {v}', dw: 'Do', edw: 'Loop Until {c}', beg: '', end: '' },
      decl: '{n} = {e}', out: 'Print {e}', read: 'Input', incast: {},
      call: 'Call {p}({a})', fncall: '{t} = {p}({a})',
      fnTpl: 'Function {n}({p})\n{b}\n    {n} = {r}\nEnd Function',
      mainTpl: 'Sub Main()\n{b}\nEnd Sub',
      F: { abs: 'Abs({0})', int: 'Int({0})', sqrt: 'Sqr({0})', ln: 'Log({0})', log: 'Log({0})',
        log10: 'Log({0}) / Log(10)', sin: 'Sin({0})', cos: 'Cos({0})', tan: 'Tan({0})',
        arcsin: 'Arcsin({0})', arccos: 'Arccos({0})', arctan: 'Arctan({0})', len: 'Len({0})',
        char: 'Mid({0}, {1} + 1, 1)', size: 'Size({0})', random: 'Rnd({0})', tointeger: 'ToInteger({0})',
        toreal: 'ToReal({0})', tostring: 'ToString({0})', tochar: 'ToChar({0})', tocode: 'ToCode({0})',
        tofixed: 'ToFixed({0}, {1})' } }),

    L({ id: 'python', name: 'Python 3', ext: 'py', cmt: '#', semi: '', indent: true, style: 'py',
      op: { and: 'and', or: 'or', not: 'not ', pow: '**' },
      ty: { Integer: 'int', Real: 'float', String: 'str', Boolean: 'bool', Void: 'None' },
      z: { Real: '0.0', Boolean: 'False' }, bool: ['True', 'False'],
      k: PY_K, decl: '{n} = {e}', out: 'print({e})', read: 'input()',
      incast: { Integer: 'int({0})', Real: 'float({0})', Boolean: 'str({0}).strip().lower() in ("true","1","yes")' },
      fnTpl: 'def {n}({p}):\n{b}\n    return {r}', mainTpl: 'def main():\n{b}',
      pre: 'import math, random\n', post: '\n\nmain()\n',
      F: { abs: 'abs({0})', int: 'int({0})', sqrt: 'math.sqrt({0})', ln: 'math.log({0})', log: 'math.log({0})',
        log10: 'math.log10({0})', sin: 'math.sin({0})', cos: 'math.cos({0})', tan: 'math.tan({0})',
        arcsin: 'math.asin({0})', arccos: 'math.acos({0})', arctan: 'math.atan({0})', sgn: 'cmp_or_zero({0})',
        len: 'len({0})', char: '{0}[{1}]', size: 'len({0})', random: 'random.randrange({0})',
        tointeger: 'int({0})', toreal: 'float({0})', tostring: 'str({0})', tochar: 'chr({0})',
        tocode: 'ord({0})', tofixed: '"%." + str(int({1})) + "f" % float({0})' }, cast: 'python' }),

    L({ id: 'nim', name: 'Nim', ext: 'nim', cmt: '#', semi: '', indent: true, style: 'py',
      op: { and: 'and', or: 'or', not: 'not ', cat: '&', pow: '^' },
      ty: { Integer: 'int', Real: 'float', String: 'string', Boolean: 'bool', Void: 'void' },
      z: { Boolean: 'false' },
      k: PY_K, decl: 'var {n}: {t} = {e}', out: 'echo {e}', read: 'readLine(stdin)',
      incast: { Integer: 'parseInt({0})', Real: 'parseFloat({0})', Boolean: 'parseBool({0})' },
      fnTpl: 'proc {n}({p}): {t} =\n{b}\n  result = {r}', mainTpl: 'proc main() =\n{b}',
      pre: 'import math, random, strutils\n\n', post: '\n\nmain()\n',
      F: { abs: 'abs({0})', int: 'trunc({0})', sqrt: 'sqrt({0})', ln: 'ln({0})', log: 'ln({0})',
        log10: 'log10({0})', sin: 'sin({0})', cos: 'cos({0})', tan: 'tan({0})', arcsin: 'arcsin({0})',
        arccos: 'arccos({0})', arctan: 'arctan({0})', len: '{0}.len', char: '{0}[{1}..{1}]',
        size: '{0}.len', random: 'random({0})', tointeger: 'parseInt($({0}))', toreal: 'parseFloat($({0}))',
        tostring: '$({0})', tochar: 'chr({0})', tocode: 'ord({0}[0])', tofixed: '{0}.format({1})' },
      cast: 'nim' }),

    L({ id: 'javascript', name: 'JavaScript', ext: 'js', op: { pow: '**' },
      ty: { Integer: 'number', Real: 'number', String: 'string', Boolean: 'boolean', Void: 'void' },
      z: { Boolean: 'false' },
      decl: 'let {n} = {e};', out: 'console.log({e});', read: 'prompt()',
      incast: { Integer: 'Math.trunc(Number({0}))', Real: 'Number({0})', Boolean: 'String({0}).toLowerCase() === "true"' },
      fnTpl: 'function {n}({p}) {\n{b}\n}', mainTpl: 'function main() {\n{b}\n}',
      post: '\n\nmain();\n', F: jsF(), cast: 'js' }),

    L({ id: 'typescript', name: 'TypeScript', ext: 'ts', op: { pow: '**' },
      ty: { Integer: 'number', Real: 'number', String: 'string', Boolean: 'boolean', Void: 'void' },
      z: { Boolean: 'false' },
      decl: 'let {n}: {t} = {e};', out: 'console.log({e});', read: 'prompt() as string',
      incast: { Integer: 'Math.trunc(Number({0}))', Real: 'Number({0})', Boolean: '(prompt() || "").toLowerCase() === "true"' },
      fnTpl: 'function {n}({p}): {t} {\n{b}\n}', mainTpl: 'function main(): void {\n{b}\n}',
      post: '\n\nmain();\n', F: jsF(), cast: 'ts' }),

    L({ id: 'java', name: 'Java', ext: 'java', op: { pow: null },
      ty: { Integer: 'int', Real: 'double', String: 'String', Boolean: 'boolean', Void: 'void' },
      z: { String: '""', Boolean: 'false' },
      typed: true,
      decl: '{t} {n} = {e};', out: 'System.out.println({e});', read: 'kb.nextLine()',
      incast: { Integer: 'Integer.parseInt({0})', Real: 'Double.parseDouble({0})', Boolean: 'Boolean.parseBoolean({0})' },
      fnTpl: 'public static {t} {n}({p}) {\n{b}\n}', mainTpl: 'public static void main(String[] args) {\n        Scanner kb = new Scanner(System.in);\n        Random rnd = new Random();\n{b}\n    }',
      cls: ['public class Main {', '}'], pre: 'import java.util.*;\n\n',
      F: Object.assign(jsF(), { char: 'String.valueOf({0}.charAt({1}))', len: '{0}.length()',
        size: '{0}.length', random: 'rnd.nextInt((int) ({0}))', tochar: 'String.valueOf((char) ({0}))',
        tocode: '{0}.charAt(0)', tostring: 'String.valueOf({0})', tointeger: '(int) Math.trunc(Double.parseDouble({0}))',
        toreal: 'Double.parseDouble({0})', tofixed: 'String.format("%." + (int) ({1}) + "f", {0})' }),
      cast: 'java' }),

    L({ id: 'cpp', name: 'C++', ext: 'cpp', op: { pow: null },
      ty: { Integer: 'int', Real: 'double', String: 'std::string', Boolean: 'bool', Void: 'void' },
      z: { String: '""', Boolean: 'false' },
      typed: true,
      decl: '{t} {n} = {e};', out: 'std::cout << {e} << std::endl;', read: 'std::getline(std::cin, {tmp})',
      incast: { Integer: 'std::stoi({0})', Real: 'std::stod({0})', Boolean: '({0} == "true")' },
      fnTpl: '{t} {n}({p}) {\n{b}\n}', mainTpl: 'int main() {\n{b}\n    return 0;\n}',
      pre: '#include <iostream>\n#include <string>\n#include <cmath>\n#include <cstdlib>\n\n',
      F: Object.assign(stdF('std::'), { char: '{0}.substr({1}, 1)', len: '(int) {0}.size()',
        size: '(int) {0}.size()', random: '(int) (std::rand() % (int) ({0}))', tostring: 'std::to_string({0})',
        tointeger: '(int) std::trunc(std::stod({0}))', toreal: 'std::stod({0})',
        tofixed: 'std::to_string({0})', tochar: 'std::string(1, (char) {0})', tocode: '(int) {0}[0]' }),
      cast: 'cpp' }),

    L({ id: 'csharp', name: 'C#', ext: 'cs', op: { pow: null },
      ty: { Integer: 'int', Real: 'double', String: 'string', Boolean: 'bool', Void: 'void' },
      z: { String: '""', Boolean: 'false' },
      typed: true,
      decl: '{t} {n} = {e};', out: 'Console.WriteLine({e});', read: 'Console.ReadLine()',
      incast: { Integer: 'int.Parse({0})', Real: 'double.Parse({0})', Boolean: 'bool.Parse({0})' },
      fnTpl: 'static {t} {n}({p}) {\n{b}\n}', mainTpl: 'static void Main() {\n        var rnd = new Random();\n{b}\n    }',
      cls: ['class Program {', '}'], pre: 'using System;\n\n',
      F: Object.assign(dotF('Math.'), { random: 'rnd.Next((int) ({0}))', char: '{0}[(int) ({1})].ToString()',
        sgn: 'Math.Sign({0})', tochar: '((char) ({0})).ToString()', tocode: '(int) {0}[0]',
        tointeger: 'int.Parse(Convert.ToString({0}))', toreal: 'double.Parse(Convert.ToString({0}))' }),
      cast: 'cs' }),

    L({ id: 'kotlin', name: 'Kotlin', ext: 'kt', semi: '', op: { pow: null },
      ty: { Integer: 'Int', Real: 'Double', String: 'String', Boolean: 'Boolean', Void: 'Unit' },
      z: { String: '""', Boolean: 'false' },
      typed: true,
      decl: 'var {n}: {t} = {e}', out: 'println({e})', read: 'readLine() ?: ""',
      incast: { Integer: '{0}.toInt()', Real: '{0}.toDouble()', Boolean: '{0}.toBoolean()' },
      fnTpl: 'fun {n}({p}): {t} {\n{b}\n}', mainTpl: 'fun main() {\n{b}\n}',
      F: Object.assign(stdF('kotlin.math.'), { char: '{0}[{1}].toString()', len: '{0}.length',
        size: '{0}.size', random: 'kotlin.random.Random.nextInt({0})', tostring: '{0}.toString()',
        tointeger: '{0}.toInt()', toreal: '{0}.toDouble()', tofixed: 'String.format("%.{}f", {0})' }),
      cast: 'kotlin' }),

    L({ id: 'swift', name: 'Swift', ext: 'swift', semi: '', op: { pow: null },
      ty: { Integer: 'Int', Real: 'Double', String: 'String', Boolean: 'Bool', Void: 'Void' },
      z: { String: '""', Boolean: 'false' },
      typed: true,
      decl: 'var {n}: {t} = {e}', out: 'print({e})', read: 'readLine() ?? ""',
      incast: { Integer: 'Int({0}) ?? 0', Real: 'Double({0}) ?? 0', Boolean: '{0} == "true"' },
      fnTpl: 'func {n}({p}) -> {t} {\n{b}\n}', mainTpl: 'func main() {\n{b}\n}',
      post: '\n\nmain()\n',
      F: Object.assign(stdF(''), { char: 'String(Array({0})[{1}])', len: '{0}.count', size: '{0}.count',
        random: 'Int.random(in: 0..<Int({0}))', tostring: 'String({0})', tointeger: 'Int({0}) ?? 0',
        toreal: 'Double({0}) ?? 0', tochar: 'String(UnicodeScalar(UInt8({0})))',
        tocode: 'Int({0}.unicodeScalars.first!.value)', tofixed: 'String(format: "%.\(Int({1}))f", {0})' }),
      cast: 'swift' }),

    L({ id: 'php', name: 'PHP', ext: 'php', op: { cat: '.', pow: '**' },
      ty: { Integer: 'int', Real: 'float', String: 'string', Boolean: 'bool', Void: 'void' },
      z: { String: '""', Boolean: 'false' },
      varSig: '$',
      decl: '${n} = {e};', out: 'echo {e}, PHP_EOL;', read: 'trim(fgets(STDIN))',
      incast: { Integer: '(int) {0}', Real: '(float) {0}', Boolean: '{0} === "true"' },
      call: '${p}({a});', fncall: '${t} = ${p}({a});',
      fnTpl: 'function {n}({p}) {\n{b}\n}', mainTpl: 'function main() {\n{b}\n}',
      pre: '<?php\n', post: '\n\nmain();\n',
      F: { abs: 'abs({0})', int: '(int) {0}', sqrt: 'sqrt({0})', ln: 'log({0})', log: 'log({0})',
        log10: 'log10({0})', sin: 'sin({0})', cos: 'cos({0})', tan: 'tan({0})', arcsin: 'asin({0})',
        arccos: 'acos({0})', arctan: 'atan({0})', len: 'strlen({0})', char: 'substr({0}, {1}, 1)',
        size: 'count({0})', random: 'random_int(0, (int) ({0}) - 1)', tointeger: '(int) {0}',
        toreal: '(float) {0}', tostring: 'strval({0})', tochar: 'chr({0})', tocode: 'ord({0})',
        tofixed: 'number_format((float) {0}, (int) {1})' }, cast: 'php' }),

    L({ id: 'perl', name: 'Perl', ext: 'pl', cmt: '#', op: { cat: '.', pow: '**' },
      ty: { Integer: 'my', Real: 'my', String: 'my', Boolean: 'my', Void: 'sub' },
      z: { String: '""', Boolean: '0' }, bool: ['1', '0'], varSig: '$',
      decl: 'my ${n} = {e};', out: 'print {e}, "\\n";', read: 'do { my $v = <STDIN>; chomp $v; $v }',
      incast: { Integer: 'int({0})', Real: '{0} + 0', Boolean: '({0} =~ /^(1|true|yes)$/i)' },
      fnTpl: 'sub {n} {\n    my ({p}) = @_;\n{b}\n}', mainTpl: 'sub main {\n{b}\n}',
      pre: "use strict;\nuse warnings;\n\n", post: '\n\nmain();\n',
      F: { abs: 'abs({0})', int: 'int({0})', sqrt: 'sqrt({0})', ln: 'log({0})', log: 'log({0})',
        log10: 'log({0}) / log(10)', sin: 'sin({0})', cos: 'cos({0})', tan: 'tan({0})',
        arcsin: 'atan2({0}, sqrt(1 - ({0}) ** 2))', arccos: 'atan2(sqrt(1 - ({0}) ** 2), {0})',
        arctan: 'atan({0})', len: 'length({0})', char: 'substr({0}, {1}, 1)', size: 'scalar @{{0}}',
        random: 'int(rand({0}))', tointeger: 'int({0})', toreal: '{0} + 0', tostring: '{0}',
        tochar: 'chr({0})', tocode: 'ord({0})', tofixed: 'sprintf("%.{1}f", {0})' }, cast: 'perl' }),

    L({ id: 'ruby', name: 'Ruby', ext: 'rb', cmt: '#', semi: '', style: 'kw',
      op: { pow: null },
      ty: { Integer: 'Integer', Real: 'Float', String: 'String', Boolean: 'Boolean', Void: 'nil' },
      z: { String: '""', Boolean: 'false' },
      k: { i: 'if {c}', e: 'else', ei: 'end', w: 'while {c}', ew: 'end',
        f: '{v} = {a}\nwhile {v} <= {b}', ef: 'end', dw: 'loop do', edw: 'break if !({c})\nend',
        beg: '', end: '' },
      decl: '{n} = {e}', out: 'puts {e}', read: '$stdin.gets.chomp',
      incast: { Integer: '{0}.to_i', Real: '{0}.to_f', Boolean: '{0} =~ /true|1|y/i ? true : false' },
      fnTpl: 'def {n}({p})\n{b}\n  return {r} if {r}\nend', mainTpl: 'def main\n{b}\nend',
      post: '\n\nmain\n',
      F: { abs: '{0}.abs', int: '{0}.to_i', sqrt: 'Math.sqrt({0})', ln: 'Math.log({0})', log: 'Math.log({0})',
        log10: 'Math.log10({0})', sin: 'Math.sin({0})', cos: 'Math.cos({0})', tan: 'Math.tan({0})',
        arcsin: 'Math.asin({0})', arccos: 'Math.acos({0})', arctan: 'Math.atan({0})', sgn: '{0} <=> 0',
        len: '{0}.length', char: '{0}[{1}]', size: '{0}.length', random: 'rand({0})',
        tointeger: '{0}.to_i', toreal: '{0}.to_f', tostring: '{0}.to_s', tochar: '{0}.chr',
        tocode: '{0}.ord', tofixed: '{0}.round({1})' },
      pow: '({a} ** {b})', cast: 'ruby' }),

    L({ id: 'lua', name: 'Lua', ext: 'lua', cmt: '--', semi: '', style: 'kw',
      op: { cat: '..', not: 'not ' },
      ty: { Integer: 'integer', Real: 'number', String: 'string', Boolean: 'boolean', Void: 'nil' },
      z: { String: '""', Boolean: 'false' },
      k: { i: 'if {c} then', e: 'else', ei: 'end', w: 'while {c} do', ew: 'end',
        f: 'for {v} = {a}, {b}, {s} do', ef: 'end', dw: 'repeat', edw: 'until {c}', beg: '', end: '' },
      decl: 'local {n} = {e}', out: 'print({e})', read: 'io.read()',
      incast: { Integer: 'math.floor({0})', Real: 'tonumber({0})', Boolean: '({0} == "true")' },
      fnTpl: 'local function {n}({p})\n{b}\nend', mainTpl: 'local function main()\n{b}\nend',
      pre: 'math.randomseed(os.time())\n\n', post: '\n\nmain()\n',
      F: { abs: 'math.abs({0})', int: 'math.floor({0})', sqrt: 'math.sqrt({0})', ln: 'math.log({0})',
        log: 'math.log({0})', log10: 'math.log10({0})', sin: 'math.sin({0})', cos: 'math.cos({0})',
        tan: 'math.tan({0})', arcsin: 'math.asin({0})', arccos: 'math.acos({0})', arctan: 'math.atan({0})',
        len: '#{0}', char: 'string.sub({0}, ({1}) + 1, ({1}) + 1)', size: '#{0}',
        random: 'math.random((int) ({0}))', tointeger: 'math.floor(tonumber({0}))',
        toreal: 'tonumber({0})', tostring: 'tostring({0})', tofixed: 'string.format("%.{1}f", {0})' },
      cast: 'lua' }),

    L({ id: 'bash', name: 'Bash', ext: 'sh', cmt: '#', semi: '', style: 'kw', bash: true,
      op: { and: '-a', or: '-o', not: '!', eq: '-eq', ne: '-ne', lt: '-lt', gt: '-gt', le: '-le', ge: '-ge',
        cat: '', mod: '%', pow: '^' },
      ty: { Integer: 'integer', Real: 'number', String: 'string', Boolean: 'boolean', Void: '' },
      z: { String: '""', Boolean: '0' }, bool: ['1', '0'],
      k: { i: 'if [[ {c} ]]; then', e: 'else', ei: 'fi', w: 'while [[ {c} ]]; do', ew: 'done',
        f: 'for (({v} = {a}; {v} <= {b}; {v} += {s})); do', ef: 'done', dw: 'until [[ {c} ]]; do',
        edw: 'done', beg: '', end: '' },
      decl: '{n}={e}', out: 'echo "{e}"', read: 'read -r', incast: {},
      call: '{p} {a}', fncall: '{t}=$({p} {a})',
      fnTpl: '{n}() {\n{b}\n}', mainTpl: 'main() {\n{b}\n}',
      pre: '#!/usr/bin/env bash\n', post: '\n\nmain "$@"\n',
      F: { abs: '{0#-}', int: '{0}', len: '#{0}', char: '{0:{1}:1}', random: '$((RANDOM % {0}))',
        tostring: '{0}', tointeger: '{0}', toreal: '{0}', sqrt: 'bc -l <<< "sqrt({0})"',
        log: 'bc -l <<< "l({0})"' }, cast: 'bash' }),

    L({ id: 'powershell', name: 'PowerShell', ext: 'ps1', cmt: '#', semi: '', style: 'kw',
      op: { and: '-and', or: '-or', not: '-not ', eq: '-eq', ne: '-ne', lt: '-lt', gt: '-gt', le: '-le',
        ge: '-ge', cat: '+', mod: '%', pow: '^' },
      ty: { Integer: '[int]', Real: '[double]', String: '[string]', Boolean: '[bool]', Void: '' },
      z: { String: '""', Boolean: '$false' }, bool: ['$true', '$false'], varSig: '$',
      k: { i: 'if ({c}) {', e: '} else {', ei: '}', w: 'while ({c}) {', ew: '}',
        f: 'for ({v} = {a}; {v} -le {b}; {v} = {v} + {s}) {', ef: '}', dw: 'do {', edw: '} while (-not ({c}))' },
      decl: '${n} = {e}', out: 'Write-Output {e}', read: 'Read-Host',
      incast: { Integer: '[int] {0}', Real: '[double] {0}', Boolean: '[bool]::Parse({0})' },
      call: '{p} {a}', fncall: '${t} = {p} {a}',
      fnTpl: 'function {n} {\n    param({p})\n{b}\n}', mainTpl: 'function main {\n{b}\n}',
      post: '\n\nmain\n',
      F: { abs: '[math]::Abs({0})', int: '[math]::Truncate({0})', sqrt: '[math]::Sqrt({0})',
        ln: '[math]::Log({0})', log: '[math]::Log({0})', log10: '[math]::Log10({0})', sin: '[math]::Sin({0})',
        cos: '[math]::Cos({0})', tan: '[math]::Tan({0})', arcsin: '[math]::Asin({0})',
        arccos: '[math]::Acos({0})', arctan: '[math]::Atan({0})', len: '{0}.Length', char: '{0}[{1}]',
        size: '{0}.Length', random: 'Get-Random -Maximum {0}', tointeger: '[int] {0}', toreal: '[double] {0}',
        tostring: '[string] {0}', tofixed: ('{0}.ToString("N{1}")') }, cast: 'ps' }),

    L({ id: 'vba', name: 'VBA', ext: 'bas', cmt: "'", semi: '', lower: false, style: 'vb',
      op: { and: 'And', or: 'Or', not: 'Not ', eq: '=', ne: '<>', cat: '&', mod: 'Mod' },
      ty: { Integer: 'Long', Real: 'Double', String: 'String', Boolean: 'Boolean', Void: 'Sub' },
      z: { String: '""', Boolean: 'False' }, bool: ['True', 'False'],
      k: { i: 'If {c} Then', e: 'Else', ei: 'End If', w: 'While {c}', ew: 'Wend',
        f: 'For {v} = {a} To {b} Step {s}', ef: 'Next {v}', dw: 'Do', edw: 'Loop Until {c}', beg: '', end: '' },
      decl: 'Dim {n} As {t}: {n} = {e}', out: 'Debug.Print {e}', read: 'InputBox("Value?")',
      incast: { Integer: 'CLng({0})', Real: 'CDbl({0})', Boolean: 'CBool({0})' },
      call: 'Call {p}({a})', fncall: '{t} = {p}({a})',
      fnTpl: 'Function {n}({p}) As {t}\n{b}\n    {n} = {r}\nEnd Function',
      mainTpl: 'Sub Main()\n{b}\nEnd Sub',
      F: { abs: 'Abs({0})', int: 'Int({0})', sqrt: 'Sqr({0})', ln: 'Log({0})', log: 'Log({0})',
        log10: 'Log({0}) / Log(10)', sin: 'Sin({0})', cos: 'Cos({0})', tan: 'Tan({0})',
        arcsin: 'Atn({0} / Sqr(-{0} * {0} + 1))', arccos: 'Atn(-{0} / Sqr(-{0} * {0} + 1)) + 2 * Atn(1)',
        arctan: 'Atn({0})', len: 'Len({0})', char: 'Mid({0}, {1} + 1, 1)', size: 'UBound({0})',
        random: 'Int(Rnd * {0})', tointeger: 'CLng({0})', toreal: 'CDbl({0})', tostring: 'CStr({0})',
        tochar: 'Chr({0})', tocode: 'Asc({0})', tofixed: 'Format({0}, {1})' }, cast: 'vb' }),

    L({ id: 'vbnet', name: 'VB.NET', ext: 'vb', cmt: "'", semi: '', lower: false, style: 'vb',
      op: { and: 'AndAlso', or: 'OrElse', not: 'Not ', eq: '=', ne: '<>', cat: '&', mod: 'Mod' },
      ty: { Integer: 'Integer', Real: 'Double', String: 'String', Boolean: 'Boolean', Void: 'Void' },
      z: { String: '""', Boolean: 'False' }, bool: ['True', 'False'],
      k: { i: 'If {c} Then', e: 'Else', ei: 'End If', w: 'While {c}', ew: 'End While',
        f: 'For {v} = {a} To {b} Step {s}', ef: 'Next {v}', dw: 'Do', edw: 'Loop Until {c}', beg: '', end: '' },
      decl: 'Dim {n} As {t} = {e}', out: 'Console.WriteLine({e})', read: 'Console.ReadLine()',
      incast: { Integer: 'CInt({0})', Real: 'CDbl({0})', Boolean: 'CBool({0})' },
      call: 'Call {p}({a})', fncall: '{t} = {p}({a})',
      fnTpl: 'Function {n}({p}) As {t}\n{b}\n    Return {r}\nEnd Function',
      mainTpl: 'Sub Main()\n{b}\nEnd Sub',
      cls: ['Module Program', 'End Module'], pre: 'Imports System\n\n',
      F: { abs: 'Math.Abs({0})', int: 'Math.Truncate({0})', sqrt: 'Math.Sqrt({0})', ln: 'Math.Log({0})',
        log: 'Math.Log({0})', log10: 'Math.Log10({0})', sin: 'Math.Sin({0})', cos: 'Math.Cos({0})',
        tan: 'Math.Tan({0})', arcsin: 'Math.Asin({0})', arccos: 'Math.Acos({0})', arctan: 'Math.Atan({0})',
        len: 'Len({0})', char: 'Mid({0}, {1} + 1, 1)', size: '{0}.Length', random: 'CInt(Rnd * {0})',
        tointeger: 'CInt({0})', toreal: 'CDbl({0})', tostring: 'CStr({0})', tochar: 'Chr({0})',
        tocode: 'AscW({0})', tofixed: '{0}.ToString("F" & {1})' }, cast: 'vb' }),

    L({ id: 'pascal', name: 'Pascal', ext: 'pas', cmt: '(*', q: "'", semi: '', lower: false, style: 'pas',
      parenLogic: true,
      op: { and: 'and', or: 'or', not: 'not ', eq: '=', ne: '<>', cat: '+', mod: 'mod', pow: null },
      ty: { Integer: 'integer', Real: 'double', String: 'string', Boolean: 'boolean', Void: '' },
      z: { String: "''", Boolean: 'False' }, bool: ['True', 'False'],
      k: { i: 'if {c} then', e: 'else', ei: '', w: 'while {c} do', ew: '', f: 'for {v} := {a} to {b} do',
        ef: '', dw: 'repeat', edw: 'until {c};', beg: 'begin', end: 'end;', mid: 'end' },
      decl: '{n} := {e};', out: 'writeln({e});', read: 'readln', incast: { Integer: 'trunc(strToFloat({0}))',
        Real: 'strToFloat({0})', Boolean: '({0} = \'True\')' },
      call: '{p}({a});', fncall: '{t} := {p}({a});',
      fnTpl: 'function {n}({p}): {t}\nvar\n{d}begin\n{b}\n    {n} := {r};\nend;',
      mainTpl: 'procedure main;\nvar\n{d}begin\n{b}\nend;',
      pre: 'program Main;\n\n', post: '\n\nbegin\n  main;\nend.\n',
      F: { abs: 'abs({0})', int: 'trunc({0})', sqrt: 'sqrt({0})', ln: 'ln({0})', log: 'ln({0})',
        log10: 'log10({0})', sin: 'sin({0})', cos: 'cos({0})', tan: 'tan({0})', arcsin: 'arcsin({0})',
        arccos: 'arccos({0})', arctan: 'arctan({0})', len: 'Length({0})', char: '{0}[({1}) + 1]',
        size: 'Length({0})', random: 'random({0})', tointeger: 'trunc(strToFloat({0}))',
        toreal: 'strToFloat({0})', tostring: 'floatToStr({0})', tochar: 'chr({0})', tocode: 'ord({0}[1])',
        tofixed: 'FormatFloat(\'0.0\', {0})' }, cast: 'pas' })
  ];

  // ---------- expressions ----------
  function printExpr(node, c, prec) {
    const s = rawExpr(node, c);
    const p = node.t === 'bin' ? (PC[node.op] || 9) : 9;
    return p < (prec || 0) ? '(' + s + ')' : s;
  }
  function ref(n, c) { return (c.varSig || '') + (c.lower ? FG.normName(n) : String(n || '')); }
  function rawExpr(node, c) {
    switch (node.t) {
      case 'num': return String(node.v);
      case 'str': return c.q + String(node.v).split('\\').join('\\\\').split(c.q).join('\\' + c.q) + c.q;
      case 'bool': return node.v ? c.bool[0] : c.bool[1];
      case 'var': return ref(node.name, c);
      case 'index': return ref(node.name, c) + '[' + printExpr(node.i, c, 0) + ']';
      case 'un': {
        if (node.op === 'neg') { return '-' + printExpr(node.a, c, 8); }
        const nt = String(c.op.not).trim();
        return nt + (/^[A-Za-z]/.test(nt) ? ' ' : '') + printExpr(node.a, c, 8);
      }
      case 'bin': return binExpr(node, c);
      case 'call': return callExpr(node, c);
      default: return '';
    }
  }
  function binExpr(node, c) {
    const o = node.op;
    if (o === '^') {
      if (c.pow) { return fill(c.pow, { a: printExpr(node.a, c, 0), b: printExpr(node.b, c, 0) }); }
      if (c.op.pow === null) { return (c.powFn || 'pow') + '(' + printExpr(node.a, c, 0) + ', ' + printExpr(node.b, c, 0) + ')'; }
    }
    const op = c.op[ALIAS[o] || o] != null ? c.op[ALIAS[o] || o] : o;
    const lg = c.parenLogic && (o === '&&' || o === 'and' || o === '||' || o === 'or');
    const a = printExpr(node.a, c, lg ? 4 : PC[o]);
    const b = printExpr(node.b, c, (o === '^' || lg) ? PC[o] : PC[o] + 1);
    if (c.bash) {
      if (['==', '!=', '<', '>', '<=', '>='].includes(o)) { return a + ' ' + op + ' ' + b; }
      return '$((' + a + ' ' + op + ' ' + b + '))';
    }
    return a + ' ' + op + ' ' + b;
  }
  function callExpr(node, c) {
    if (node.name === 'eof') { return c.F.eof || 'false'; }
    const args = node.args.map((a) => printExpr(a, c, 0));
    const t = c.F[node.name];
    if (t) { return fill(t, args.reduce((m, v, i) => { m[i] = v; return m; }, {})); }
    if (node.name === 'pi') { return piName(c); }
    return node.name + '(' + args.join(', ') + ')';
  }
  function piName(c) {
    const m = { python: 'math.pi', nim: 'math.pi', js: 'Math.PI', ts: 'Math.PI', java: 'Math.PI',
      cpp: 'M_PI', cs: 'Math.PI', kotlin: 'kotlin.math.PI', swift: 'Double.pi', php: 'M_PI',
      perl: '4 * atan2(1, 1)', ruby: 'Math::PI', lua: 'math.pi', bash: '3.14159265358979',
      ps: '[math]::PI', vb: 'Math.PI', pas: 'Pi', pseudo: 'pi' };
    return m[c.cast] || 'Math.PI';
  }

  // ---------- statements ----------
  function emit(prog, c) {
    const K = c.k, pad = '    ';
    const ast = (src) => rpnToAst(FG.parse(src || ''));
    const ex = (src) => printExpr(ast(src), c, 0);
    const child = (s, seg) => s.children[seg === 'else' ? 'els' : seg] || [];

    function indent(lvl, text) { return pad.repeat(lvl) + text; }
    function seqOf(fn, list, lvl) {
      const out = [];
      for (const s of list) { out.push(...oneOf(fn, s, lvl)); }
      return out;
    }
    function blockOf(fn, list, lvl) {
      const inner = seqOf(fn, list, lvl);
      if (inner.length) { return inner; }
      return c.indent ? [indent(lvl, K.pass || 'pass')] : [indent(lvl, cmt('empty branch'))];
    }
    function cmt(t) { return c.cmt === '(*' ? '(* ' + t + ' *)' : String(c.cmt + ' ' + t).trim(); }

    function oneOf(fn, s, lvl) {
      const p = s.props || {};
      const out = [];
      const put = (t) => out.push(indent(lvl, t));
      const open = (t) => put(K.beg ? t + ' ' + K.beg : t);
      const close = () => { if (K.end) { put(K.end); } else if (K.ei) { put(K.ei); } };
      switch (s.type) {
        case 'Start': case 'End': return [];
        case 'Comment':
          return String(p.text || '').split('\n').map((t) => indent(lvl, cmt(t)));
        case 'Breakpoint':
          return [indent(lvl, cmt('breakpoint' + (p.expression ? ' if ' + p.expression : '')))];
        case 'Declare':
          if (c.style === 'pas' || c.id === 'vba' || c.id === 'vbnet' || c.id === 'pseudocode') {
            return c.style === 'pas' ? [] : [indent(lvl, fill(c.decl, {
              n: ref(p.variable, c), t: c.ty[p.type], e: p.array ? arrayLit(p) : c.z[p.type] }))];
          }
          return [indent(lvl, fill(c.decl, {
            n: ref(p.variable, c), t: c.ty[p.type], e: p.array ? arrayLit(p) : c.z[p.type] }))];
        case 'Assign': {
          const m = FG.splitAssign(p.expression);
          if (m.at < 0) { return [indent(lvl, cmt(p.expression))]; }
          const lhs = ref(m.lhs.replace(/\s+/g, ''), c);
          if (c.decl) {
            const t = c.ty[typeOf(fn, m.lhs)] || '';
            return [indent(lvl, fill(declAssign(c, lhs, t), { e: ex(m.rhs) }))];
          }
          return [indent(lvl, lhs + ' = ' + ex(m.rhs) + c.semi)];
        }
        case 'Output':
          return [indent(lvl, fill(c.out, { e: ex(p.expression) }))];
        case 'Input': {
          const t = typeOf(fn, p.variable) || 'String';
          const rd = fill(c.read, { n: ref(p.variable, c), tmp: 'line' });
          const cast = c.incast[t === 'Integer' ? 'Integer' : t === 'Real' ? 'Real' : t === 'Boolean' ? 'Boolean' : null];
          const val = cast ? fill(cast, { 0: rd }) : rd;
          if (c.id === 'bash') { return [indent(lvl, rd + ' ' + ref(p.variable, c))]; }
          if (c.id === 'pascal') { return [indent(lvl, 'readln(' + ref(p.variable, c) + ');'),
            t === 'String' ? null : indent(lvl, ref(p.variable, c) + ' := ' + fill(cast, { 0: ref(p.variable, c) }) + ';')]
            .filter(Boolean); }
          if (c.id === 'pseudocode') { return [indent(lvl, 'Input ' + ref(p.variable, c))]; }
          return [indent(lvl, fill(c.decl.indexOf('{t}') >= 0 ? '{n} = {e};' : c.decl,
            { n: ref(p.variable, c), e: val }) + (c.semi === ';' ? '' : ''))];
        }
        case 'If': {
          const cc = ex(p.expression);
          open(fill(K.i, { c: cc }));
          out.push(...blockOf(fn, child(s, 'then'), lvl + 1));
          if (child(s, 'else').length) {
            if (K.end || K.mid) { put(K.mid || K.end); }
            put(fill(K.e, { c: cc }));
            out.push(...blockOf(fn, child(s, 'else'), lvl + 1));
          }
          close();
          return out;
        }
        case 'While':
          open(fill(K.w, { c: ex(p.expression) }));
          out.push(...blockOf(fn, child(s, 'body'), lvl + 1));
          close();
          return out;
        case 'Do': {
          const cc = ex(p.expression);
          if (!K.dw) {
            put(c.indent ? 'while True:' : 'while (true) {');
            out.push(...blockOf(fn, child(s, 'body'), lvl + 1));
            put(fill('if not ({c}):' , { c: cc }));
            put(indent(lvl + 1, 'break' + (c.indent ? '' : ';')));
            if (!c.indent) { put('}'); }
            return out;
          }
          if (c.id === 'ruby') {
            put(K.dw);
            out.push(...blockOf(fn, child(s, 'body'), lvl + 1));
            put(fill('break if !({c})', { c: cc }));
            put('end');
            return out;
          }
          if (K.edw.indexOf('until') === 0 || K.edw.indexOf('Loop') === 0) {
            put(K.dw);
            out.push(...blockOf(fn, child(s, 'body'), lvl + 1));
            put(fill(K.edw, { c: cc }));
            return out;
          }
          put(fill(K.dw, { c: cc }));
          out.push(...blockOf(fn, child(s, 'body'), lvl + 1));
          put(fill(K.edw, { c: cc }));
          return out;
        }
        case 'For': {
          const v = ref(p.variable, c);
          const a = ex(p.start), b = ex(p.end), st = ex(p.step || '1');
          if (c.typed && !isDeclared(fn, p.variable)) { put(declTyped(v, c.ty.Integer, a)); }
          open(fill(K.f, { v, a, b, s: st }));
          out.push(...blockOf(fn, child(s, 'body'), lvl + 1));
          if (K.end) { put(K.end); } else if (K.ef) { put(fill(K.ef, { v })); }
          out.push(...seqOf(fn, child(s, 'done'), lvl));
          return out;
        }
        case 'Call': {
          if (/^turtle\./i.test(String(p.name || ''))) {
            return [indent(lvl, cmt('turtle ' + String(p.name).slice(7) + '(' + (p.args || []).map((a) => ex(a)).join(', ') + ')'))];
          }
          const target = prog.functions.find((f) => FG.normName(f.name) === FG.normName(p.name || 'Main'));
          const args = (p.args || []).map((a) => ex(a));
          const nm = callName(p.name, c);
          if (target && target.type !== 'Void') {
            const into = p.returnTo ? ref(p.returnTo, c) : (nm + '_result');
            if (!p.returnTo && c.typed && !isDeclared(fn, into)) {
              return [indent(lvl, fill(c.decl, { n: into, t: c.ty[target.type] || 'var', e: '0' }))];
            }
            return [indent(lvl, fill(c.fncall, { p: nm, a: args.join(', '), t: into }))];
          }
          return [indent(lvl, fill(c.call, { p: nm, a: args.join(', ') }))];
        }
        default:
          return [indent(lvl, cmt(s.type))];
      }
    }
    function arrayLit(p) {
      const n = ex(p.size || '0'), d = c.z[p.type];
      if (c.id === 'java' || c.id === 'csharp') { return 'new ' + (c.ty[p.type] || 'var') + '[' + n + ']'; }
      if (c.id === 'cpp') { return 'std::vector<' + (c.ty[p.type] || 'int') + '>(' + n + ', ' + d + ')'; }
      if (c.indent) { return '[' + d + ' for _ in range(' + n + ')]'; }
      if (c.style === 'vb') { return 'New ' + (c.ty[p.type] || 'Object') + '(' + n + '-1)'; }
      if (c.id === 'pascal') { return ''; }
      return '[' + d + '] * ' + n;
    }
    function declTyped(n, t, e) { return fill(c.decl, { n, t, e }) + (c.semi === '' ? '' : ''); }
    function declAssign(cc, lhs, t) {
      if (cc.typed) { return lhs + ' = {e}' + cc.semi; }
      if (cc.style === 'pas') { return lhs + ' := {e};'; }
      if (cc.style === 'vb') { return lhs + ' = {e}'; }
      if (cc.indent) { return lhs + ' = {e}'; }
      return lhs + ' = {e}' + cc.semi;
    }
    function callName(nm, cc) {
      if (/^Turtle\./i.test(nm || '')) { return (cc.lower ? 'turtle_' : 'Turtle_') + FG.normName(String(nm).split('.')[1]); }
      return cc.lower ? FG.normName(nm || 'main') : (nm || 'Main');
    }
    function isDeclared(fn, name) {
      const n = FG.normName(String(name).replace(/\s*\[[^\]]*\]$/, ''));
      let yes = false;
      FG.walk(fn.body, (s) => { if (s.type === 'Declare' && FG.normName(s.props.variable) === n) { yes = true; } });
      if (!yes) { yes = fn.params.some((p) => FG.normName(p.name) === n); }
      return yes;
    }
    function typeOf(fn, name) {
      const n = FG.normName(String(name).replace(/\s*\[[^\]]*\]$/, ''));
      for (const p of fn.params) { if (FG.normName(p.name) === n) { return p.type; } }
      if (fn.returnVar === n) { return fn.type; }
      let t = '';
      FG.walk(fn.body, (s) => {
        if (s.props && s.props.variable && FG.normName(s.props.variable) === n && s.props.type) { t = s.props.type; }
      });
      return t || 'Integer';
    }
    function declarations(fn) {
      const seen = {}, rows = [];
      FG.walk(fn.body, (s) => {
        if (s.type === 'Declare' || s.type === 'For' || s.type === 'Input') {
          const n = ref(s.props.variable, c);
          if (!n || seen[n]) { return; }
          seen[n] = 1;
          rows.push(pad + n + ': ' + (c.ty[s.props.type || (s.type === 'Input' ? 'String' : 'Integer')] || 'var') + ';');
        }
      });
      for (const p of fn.params) { /* params are in the signature */ }
      return rows.length ? rows.join('\n') + '\n' : '';
    }
    function paramOf(p) {
      const n = ref(p.name, c);
      if (c.style === 'pas') { return (p.ref ? 'var ' : '') + n + ': ' + (c.ty[p.type] || 'integer'); }
      if (c.style === 'vb') { return (p.ref ? 'ByRef ' : 'ByVal ') + n + ' As ' + (c.ty[p.type] || 'Object'); }
      if (c.id === 'pseudocode') { return p.name; }
      if (c.id === 'powershell') { return (c.ty[p.type] || '') + ' ' + n; }
      if (c.indent) { return n; }
      if (c.id === 'perl') { return '$' + FG.normName(p.name); }
      return (c.ty[p.type] || '') + ' ' + n;
    }
    function emitFn(fn) {
      const body = seqOf(fn, fn.body, 1);
      const name = c.lower ? FG.normName(fn.name) : fn.name;
      const ps = fn.params.map(paramOf).join(c.id === 'powershell' ? ', ' : ', ');
      const rt = fn.type === 'Void' ? (c.ty.Void || 'void') : (c.ty[fn.type] || fn.type);
      const d = declarations(fn);
      const tpl = (fn.name === 'Main' ? c.mainTpl : c.fnTpl).replace('var\n', d ? 'var\n' : '');
      const head = fill(tpl, { n: name, p: ps, t: rt, b: body.join('\n'), r: ref(fn.returnVar || name + '_result', c), d });
      return head;
    }

    const parts = prog.functions.map(emitFn);
    let text = parts.join('\n\n');
    if (c.cls) {
      text = c.cls[0] + '\n' + text.split('\n').map((l) => l.trim() ? pad + l : '').join('\n') + '\n' + c.cls[1];
    }
    return (c.pre || '') + text + (c.post || '');
  }

  window.CG = { LANGS, emit, rpnToAst, printExpr };
})();
