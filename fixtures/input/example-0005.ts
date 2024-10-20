export const defaultHeaders = {
  'Content-Type': 'application/json',
}
export interface Comment {
  id: number
  postId: number
  body: string
}
export interface CommentsResponse {
  comments: Comment[]
}
export function fetchComments(postId: number): Promise<CommentsResponse> {
  return fetch(`/posts/${postId}/comments`)
    .then(response => response.json()) as Promise<CommentsResponse>
}
