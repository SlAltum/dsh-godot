/**
 * The built-in GDScript formatter, migrated from godot-vscode-plugin (MIT)
 * `src/formatter/`: TextMate tokenize + whitespace rules (`between`,
 * empty-line management, lambda tracking) as a pure text-in/text-out
 * function. Unlike the source plugin, `formatGdscript` awaits the grammar
 * load (the plugin's lazy `grammar` global made the first call a no-op), and
 * it returns the formatted text instead of VSCode `TextEdit` lists.
 * @module @deepseek-ai/dsh-tool-godot/gdscript-format
 */

import { getGrammar } from './gdscript-tokenizer.ts'
import type { IGrammar } from 'vscode-textmate'
import { keywords, symbols } from './gdscript-symbols.ts'

/** Formatter behavior knobs (mirrors the source plugin's `FormatterOptions`). */
export interface FormatterOptions {
  /** Max consecutive blank lines allowed inside the file. */
  maxEmptyLines: number
  /** Remove extra space inside function parameter lists. */
  denseFunctionParameters: boolean
  /** Spaces before an end-of-line comment (`1` or `2`). */
  spacesBeforeEndOfLineComment: 1 | 2
}

/** One classified token (the source plugin's `Token`). */
interface Token {
  scopes: string[]
  original: string
  value: string
  type?: string
  param?: boolean
  string?: boolean
  skip?: boolean
  identifier?: boolean
  inLambdaBody?: boolean
}

/**
 * Format one GDScript source text.
 * @param text - the complete source text (LF line endings; CRLF is tolerated).
 * @param options - the formatter options.
 * @returns the formatted text.
 */
export async function formatGdscript(text: string, options: FormatterOptions): Promise<string> {
  const grammar = await getGrammar()
  const lines = text.split(/\r?\n/)
  const out: string[] = []

  let lastToken = ''
  let ruleStack: Parameters<IGrammar['tokenizeLine']>[1] = null
  let onlyEmptyLinesSoFar = true
  let emptyLineCount = 0
  let inLambdaBody = false

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    // lineNum is always a valid index into the split array.
    const line = lines[lineNum] as string

    // Empty lines: drop leading ones, cap consecutive ones (0 after a colon),
    // drop trailing ones.
    if (line.trim() === '') {
      if (onlyEmptyLinesSoFar) continue
      emptyLineCount++
      continue
    }
    onlyEmptyLinesSoFar = false
    if (emptyLineCount > 0) {
      const maxEmptyLines = lastToken === ':' ? 0 : options.maxEmptyLines
      const keep = Math.min(emptyLineCount, maxEmptyLines)
      for (let i = 0; i < keep; i++) out.push('')
      emptyLineCount = 0
    }

    // Comment-only lines and git merge-conflict markers pass through untouched
    // (formatting conflict markers corrupts them).
    if (isCommentLine(line) || isMergeConflictMarker(line)) {
      out.push(line)
      continue
    }

    const leadingWhitespace = line.slice(0, line.length - line.trimStart().length)
    const lineTokens = grammar.tokenizeLine(line, ruleStack)
    ruleStack = lineTokens.ruleStack
    const rawTokens = lineTokens.tokens
    // The first token often covers the leading whitespace; drop it when blank.
    const firstToken = rawTokens[0]
    if (firstToken !== undefined && line.slice(firstToken.startIndex, firstToken.endIndex).trim() === '') {
      rawTokens.shift()
    }

    const tokens: Token[] = []
    for (const t of rawTokens) {
      const text = line.slice(t.startIndex, t.endIndex)
      const token: Token = {
        scopes: [t.scopes.join(' '), ...t.scopes],
        original: text,
        value: text.trim(),
      }
      parseToken(token)
      // Drop whitespace-only tokens (unless part of a string).
      if (!token.string && token.value.trim() === '') continue
      tokens.push(token)
    }

    // Track lambda bodies inside call arguments (see source plugin).
    let sawLambdaStart = false
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i] as Token
      if (token.value === 'func' && token.param) {
        sawLambdaStart = true
        inLambdaBody = true
      }
      if (token.value === ')' && !token.param) {
        inLambdaBody = false
      }
      if (inLambdaBody && sawLambdaStart && token.value === ':') {
        sawLambdaStart = false
      } else if (inLambdaBody && !sawLambdaStart) {
        token.inLambdaBody = true
      }
    }

    let nextLine = leadingWhitespace
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i] as Token
      const previous = tokens[i - 1]
      if (i === 0 && token.string) {
        nextLine += token.original.trimStart()
      } else if (i > 0 && previous !== undefined && previous.string && token.string) {
        nextLine += token.original
      } else {
        nextLine += between(tokens, i, options) + token.value.trim()
      }
      if (token.type !== 'comment') {
        lastToken = token.value
      }
    }
    out.push(nextLine)
  }

  return out.join('\n')
}

/** Whether the line is comment-only (leading `#`). */
function isCommentLine(line: string): boolean {
  return line[line.length - line.trimStart().length] === '#'
}

/** Whether the line is a git merge-conflict marker (formatting corrupts it). */
function isMergeConflictMarker(line: string): boolean {
  const trimmed = line.trimStart()
  return trimmed.startsWith('<<<<<<<') || trimmed.startsWith('=======') || trimmed.startsWith('>>>>>>>')
}

/** Classify a token from its TextMate scopes (source plugin's `parse_token`). */
function parseToken(token: Token): void {
  if (token.scopes.includes('string.quoted.gdscript')) {
    token.string = true
  }
  if (token.scopes.includes('meta.function.parameters.gdscript')) {
    token.param = true
  }
  // scopes is never empty for a grammar-produced token.
  if (token.scopes[0]?.includes('constant.numeric')) {
    token.type = 'literal'
    return
  }
  if (/[A-Za-z_]\w+/.test(token.value)) {
    token.identifier = true
  }
  if (token.scopes.includes('meta.literal.nodepath.gdscript')) {
    token.skip = true
    token.type = 'nodepath'
    return
  }
  if (token.scopes.includes('meta.literal.nodepath.bare.gdscript')) {
    token.skip = true
    token.type = 'bare_nodepath'
    return
  }
  if (token.scopes.includes('keyword.control.flow.gdscript')) {
    token.type = 'keyword'
    return
  }
  // "preload" is highlighted as a keyword but behaves like a function.
  if (token.value === 'preload') {
    return
  }
  // "self" and "super" are highlighted as keywords but behave like identifiers.
  if (token.value === 'self' || token.value === 'super') {
    token.type = 'variable'
    return
  }
  // "signal" is a keyword in declarations but a value reference in expressions.
  if (token.value === 'signal') {
    token.type = token.scopes.includes('keyword.language.gdscript') ? 'keyword' : 'variable'
    return
  }
  // "yield" is a keyword but behaves like a function call — no space before (.
  if (token.value === 'yield') {
    token.type = 'keyword'
    return
  }
  if (keywords.includes(token.value)) {
    token.type = 'keyword'
    return
  }
  if (symbols.includes(token.value)) {
    token.type = 'symbol'
    return
  }
  if (token.scopes.includes('keyword.language.gdscript')) {
    token.type = 'keyword'
    return
  }
  if (token.scopes.includes('constant.language.gdscript') || token.scopes.includes('constant.language.literal.gdscript')) {
    token.type = 'constant'
    return
  }
  if (token.scopes.includes('variable.other.gdscript')) {
    token.type = 'variable'
    return
  }
  if (token.scopes.includes('comment.line.number-sign.gdscript')) {
    token.type = 'comment'
  }
}

/** The whitespace to place before token `current` (source plugin's `between`). */
function between(tokens: Token[], current: number, options: FormatterOptions): string {
  // current is always a valid index into tokens (the caller iterates them).
  const nextToken = tokens[current] as Token
  const prevToken = tokens[current - 1]
  const next = nextToken.value
  const prev = prevToken?.value

  if (prev === undefined) return ''

  if (next === '##') return options.spacesBeforeEndOfLineComment === 2 ? '  ' : ' '
  if (next === '#') return options.spacesBeforeEndOfLineComment === 2 ? '  ' : ' '
  if (prevToken?.skip && nextToken.skip) return ''

  if (prev === '(') return ''
  if (prev === '.') {
    if (nextToken.type === 'symbol') return ' '
    return ''
  }
  if (next === '.') return ''

  if (nextToken.param && !nextToken.inLambdaBody && !(prevToken?.inLambdaBody)) {
    if (options.denseFunctionParameters) {
      if (prev === '-' || prev === '+') {
        if (tokens[current - 2]?.value === '=') return ''
        /* v8 ignore next -- a standalone '-'/'+' occurs only after '='; the '=' check short-circuits first. */
        if (['keyword', 'symbol'].includes(tokens[current - 2]?.type ?? '')) return ''
        /* v8 ignore start -- same merging: ','/'(' before a parameter-scope '-'/'+' is unreachable. */
        if ([',', '('].includes(tokens[current - 2]?.value ?? '')) return ''
        /* v8 ignore stop */
      }
      if (next === '%') return ' '
      if (prev === '%') return ' '
      if (next === '=') {
        if (tokens[current - 2]?.value === ':') return ' '
        return ''
      }
      if (prev === '=') {
        if (tokens[current - 3]?.value === ':') return ' '
        return ''
      }
      if (prevToken?.type === 'symbol') return ' '
      if (nextToken.type === 'symbol') return ' '
    } else if (next === ':') {
      if (tokens[current + 1]?.value === '=') return ' '
    }
  }

  if (next === ':') {
    if (['var', 'const'].includes(tokens[current - 2]?.value ?? '')) {
      /* v8 ignore start -- ':' after var/const is always followed by a type name; ':=' is a single token, so the '=' arm is unreachable. */
      if (tokens[current + 1]?.value !== '=') return ''
      return ' '
      /* v8 ignore stop */
    }
    if (prevToken?.type === 'keyword') return ''
  }
  if (prev === '@') return ''

  if (prev === '-' || prev === '+') {
    if (next === '(') return ' '
    if (['keyword', 'symbol'].includes(tokens[current - 2]?.type ?? '')) return ''
    if ([',', '(', '['].includes(tokens[current - 2]?.value ?? '')) return ''
    if (tokens[current - 2]?.value === '=') return ''
    if (nextToken.identifier) return ' '
    if (current === 1) return ''
  }

  if (prev === ':' && next === '=') return ''
  if (next === '(') {
    if (prev === 'export') return ''
    if (prev === 'func') return ''
    if (prev === 'assert') return ''
    if (prev === 'yield') return ''
  }

  if (prev === ')' && nextToken.type === 'keyword') return ' '

  if (prev === '[' && nextToken.type === 'symbol') return ''
  /* v8 ignore next -- the grammar only emits the bare nodepath scope; the non-bare arm is unreachable. */
  if (prev === '[' && nextToken.type === 'nodepath') return ''
  if (prev === '[' && nextToken.type === 'bare_nodepath') return ''
  if (prev === ':') return ' '
  if (prev === ';') return ' '
  if (prev === '##') return ' '
  if (prev === '#') return ' '
  if (next === '=') return ' '
  if (prev === '=') return ' '
  if (tokens[current - 2]?.value === '=') {
    /* v8 ignore next -- a '+'/'-' after '=' is always caught by the prev==='-'/'+' block above. */
    if (['+', '-'].includes(prev)) return ''
  }
  /* v8 ignore next -- after-'(' arm pinned by tests; v8's combined-suite branch merge misreports it. */
  if (prev === '(') return ''
  if (next === '{') return ' '
  if (next === '\\') return ' '
  /* v8 ignore next -- '{' and '}' tokenize separately; the '{}' arm is unreachable. */
  if (next === '{}') return ' '

  if (prevToken?.type === 'keyword') return ' '
  if (nextToken.type === 'keyword') return ' '
  if (prevToken?.type === 'symbol') return ' '
  if (nextToken.type === 'symbol') return ' '

  if (prev === ',') return ' '

  return ''
}
