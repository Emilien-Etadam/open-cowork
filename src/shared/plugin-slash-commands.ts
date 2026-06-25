/** Serializable plugin slash command metadata (IPC + catalog). */
export interface PluginSlashCommandInfo {
  pluginId: string;
  pluginName: string;
  /** Command name without leading slash (e.g. "do"). */
  name: string;
  /** Resolved slash invocation (e.g. "/do" or "/my-plugin:do" on collision). */
  command: string;
  description: string;
}
