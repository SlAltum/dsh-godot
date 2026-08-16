/**
 * Branch-focused tests for the built-in GDScript formatter: edge inputs the
 * upstream snapshot suite does not exercise (leading blank lines, dense
 * parameter-list operators, symbol-after-dot, doc comments). Expected
 * outputs are pinned from the migrated formatter's behavior (verified
 * against the source plugin's rule table).
 */

import { describe, expect, it } from 'vitest'
import { formatGdscript, type FormatterOptions } from '../src/gdscript-format.ts'

const defaults: FormatterOptions = { maxEmptyLines: 2, denseFunctionParameters: false, spacesBeforeEndOfLineComment: 1 }
const dense: FormatterOptions = { ...defaults, denseFunctionParameters: true }
const twoSpaces: FormatterOptions = { ...defaults, spacesBeforeEndOfLineComment: 2 }

describe('formatGdscript branch coverage', () => {
  it('drops leading and trailing blank lines', async () => {
    await expect(formatGdscript('\n\nvar x = 1\n', defaults)).resolves.toBe('var x = 1')
  })

  it('spaces a symbol that follows a dot', async () => {
    await expect(formatGdscript('var a = b.  -c\n', defaults)).resolves.toBe('var a = b. - c')
  })

  it('densifies negative and positive literals in parameter lists', async () => {
    const input = 'func f(a = -1, b = +2):\n\treturn a + -b\n'
    await expect(formatGdscript(input, dense)).resolves.toBe('func f(a=-1, b=+2):\n\treturn a + -b')
  })

  it('keeps spaces around percent in dense parameter lists', async () => {
    await expect(formatGdscript('func f(a = 5 % 2):\n\tpass\n', dense)).resolves.toBe('func f(a=5 % 2):\n\tpass')
  })

  it('keeps spaces around a plus between expressions in dense parameter lists', async () => {
    await expect(formatGdscript('func f(a = b + c):\n\tpass\n', dense)).resolves.toBe('func f(a=b + c):\n\tpass')
  })

  it('densifies colon-equals in parameter lists', async () => {
    await expect(formatGdscript('func f(a := 1):\n\tpass\n', dense)).resolves.toBe('func f(a:=1):\n\tpass')
  })

  it('densifies a negative literal after equals but keeps spacing after variables', async () => {
    await expect(formatGdscript('func f(a = -x):\n\tpass\n', dense)).resolves.toBe('func f(a=-x):\n\tpass')
    // A minus after a variable stays spaced (the operator itself is not a
    // parameter-scope token, so dense rules do not apply to its neighbors).
    await expect(formatGdscript('func f(a - -b):\n\tpass\n', dense)).resolves.toBe('func f(a - -b):\n\tpass')
  })

  it('formats var declarations with type annotations and inference', async () => {
    await expect(formatGdscript('var  x  :  int\n', defaults)).resolves.toBe('var x: int')
    await expect(formatGdscript('var  x  :=  5\n', defaults)).resolves.toBe('var x := 5')
  })

  it('keeps nodepaths tight inside array literals', async () => {
    await expect(formatGdscript('var a = [ $Node2D ]\n', defaults)).resolves.toBe('var a = [$Node2D]')
  })

  it('handles unary operator sequences after equals', async () => {
    await expect(formatGdscript('var a = + -b\n', defaults)).resolves.toBe('var a = +-b')
  })

  it('removes spaces inside call parentheses', async () => {
    await expect(formatGdscript('super(  1  )\n', defaults)).resolves.toBe('super(1)')
  })

  it('keeps a one-space gap before doc comments', async () => {
    await expect(formatGdscript('var x = 1 ## doc\n', defaults)).resolves.toBe('var x = 1 ## doc')
  })

  it('uses the configured gap before end-of-line comments', async () => {
    await expect(formatGdscript('var x = 1 # hi\n', twoSpaces)).resolves.toBe('var x = 1  # hi')
    await expect(formatGdscript('var x = 1 # hi\n', defaults)).resolves.toBe('var x = 1 # hi')
  })
})
