/**
 * Comment formatting utilities for DTS output
 */

/**
 * Format comments for DTS output
 */
export function formatComments(comments: string[] | undefined, keepComments: boolean = true): string {
  if (!keepComments || !comments || comments.length === 0) {
    return ''
  }

  // Fast path: single comment (most common case)
  if (comments.length === 1)
    return comments[0].trim() + '\n'

  // Multiple comments: join with newlines
  let result = ''
  for (let i = 0; i < comments.length; i++) {
    if (i > 0) result += '\n'
    result += comments[i].trim()
  }
  return `${result}\n`
}
