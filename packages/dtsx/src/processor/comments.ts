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

  const formattedComments = comments.map((comment) => {
    // Ensure proper spacing and formatting
    return comment.trim()
  }).join('\n')

  return `${formattedComments}\n`
}
