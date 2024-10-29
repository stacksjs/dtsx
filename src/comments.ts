/**
 * Removes leading comments from code
 */
export function removeLeadingComments(code: string): string {
  const lines = code.split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index].trim()
    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line === '') {
      index++
    }
    else {
      break
    }
  }
  return lines.slice(index).join('\n')
}

/**
 * Clean single line comments and whitespace from a string
 */
export function cleanComments(input: string): string {
  return input
    // Remove single line comments
    .replace(/\/\/[^\n]*/g, '')
    // Clean up empty lines that may be left after comment removal
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
}
