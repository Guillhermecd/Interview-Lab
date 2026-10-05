export const DASHBOARD_PATH = '/dashboard';
export const CHAT_PATH = '/chat';

// What a screen may hand to the chat when sending the user there.
export interface ChatLocationState {
  // Written in the composer, for the user to review and send.
  question?: string;
}
