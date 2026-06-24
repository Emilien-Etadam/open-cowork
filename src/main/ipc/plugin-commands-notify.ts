import { sendToRenderer } from '../main-renderer-bridge';

export function notifyPluginCommandsChanged(): void {
  sendToRenderer({ type: 'plugins.commandsChanged', payload: {} });
}
