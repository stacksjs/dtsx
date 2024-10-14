/**
 * Example of const declaration
 */
export const defaultHeaders = {
  'Content-Type': 'application/json',
}

/**
 * Example of interface declaration
 */
export interface Comment {
  id: number
  postId: number
  body: string
}

/**
 * Example of type declaration
 */
export interface CommentsResponse {
  comments: Comment[]
}

/**
 * Example of function declaration
 */
export function fetchComments(postId: number): Promise<CommentsResponse> {
  return fetch(`/posts/${postId}/comments`)
    .then(response => response.json()) as Promise<CommentsResponse>
}
