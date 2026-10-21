/** Remove JSONC comments and trailing commas without changing string contents. */
export function normalizeJsonConfig(_jsonText: string): string {
  let result = ''
  let position = 0
  let stringQuote = 0

  while (position < _jsonText.length) {
    const char = _jsonText.charCodeAt(position)
    if (stringQuote) {
      result += _jsonText[position]
      if (char === 92 /* \\ */ && position + 1 < _jsonText.length) {
        result += _jsonText[position + 1]
        position += 2
        continue
      }
      if (char === stringQuote) stringQuote = 0
      position++
      continue
    }

    if (char === 34 /* " */) {
      stringQuote = char
      result += _jsonText[position++]
      continue
    }
    if (char === 47 /* / */ && _jsonText.charCodeAt(position + 1) === 47 /* / */) {
      position += 2
      while (position < _jsonText.length && _jsonText.charCodeAt(position) !== 10 /* \n */ && _jsonText.charCodeAt(position) !== 13 /* \r */) position++
      continue
    }
    if (char === 47 /* / */ && _jsonText.charCodeAt(position + 1) === 42 /* * */) {
      position += 2
      while (position + 1 < _jsonText.length && !(_jsonText.charCodeAt(position) === 42 && _jsonText.charCodeAt(position + 1) === 47)) {
        if (_jsonText.charCodeAt(position) === 10) result += '\n'
        position++
      }
      position = Math.min(position + 2, _jsonText.length)
      continue
    }
    if (char === 44 /* , */) {
      let next = position + 1
      while (next < _jsonText.length) {
        while (next < _jsonText.length && _jsonText.charCodeAt(next) <= 32) next++
        if (_jsonText.charCodeAt(next) === 47 && _jsonText.charCodeAt(next + 1) === 47) {
          next += 2
          while (next < _jsonText.length && _jsonText.charCodeAt(next) !== 10 && _jsonText.charCodeAt(next) !== 13) next++
          continue
        }
        if (_jsonText.charCodeAt(next) === 47 && _jsonText.charCodeAt(next + 1) === 42) {
          next += 2
          while (next + 1 < _jsonText.length && !(_jsonText.charCodeAt(next) === 42 && _jsonText.charCodeAt(next + 1) === 47)) next++
          next = Math.min(next + 2, _jsonText.length)
          continue
        }
        break
      }
      const nextChar = _jsonText.charCodeAt(next)
      if (nextChar === 93 /* ] */ || nextChar === 125 /* } */) {
        position++
        continue
      }
    }

    result += _jsonText[position++]
  }

  return result
}

