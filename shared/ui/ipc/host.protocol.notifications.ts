import { NotificationType } from "vscode-jsonrpc";
import { Range } from "vscode-languageserver-types";
import { EditorMetrics, EditorSelection, IpcRoutes } from "./webview.protocol.common";

type ConfigState = any;

/* The following events are expected to be provided from the extension */

export interface HostDidChangeActiveEditorNotification {
	editor?: {
		fileName: string;
		languageId?: string;
		uri: string;
		metrics?: EditorMetrics;
		selections: EditorSelection[];
		visibleRanges: Range[];
		lineCount?: number;
	};
}
export const HostDidChangeActiveEditorNotificationType = new NotificationType<
	HostDidChangeActiveEditorNotification,
	void
>(`${IpcRoutes.Webview}/editor/didChangeActive`);

export type HostDidChangeConfigNotification = Partial<ConfigState>;
export const HostDidChangeConfigNotificationType = new NotificationType<
	HostDidChangeConfigNotification,
	void
>(`${IpcRoutes.Webview}/config/didChange`);

export interface HostDidChangeEditorSelectionNotification {
	uri: string;
	selections: EditorSelection[];
	visibleRanges: Range[];
	lineCount?: number;
}
export const HostDidChangeEditorSelectionNotificationType = new NotificationType<
	HostDidChangeEditorSelectionNotification,
	void
>(`${IpcRoutes.Webview}/editor/didChangeSelection`);

export interface HostDidChangeEditorVisibleRangesNotification {
	uri: string;
	selections: EditorSelection[];
	visibleRanges: Range[];
	lineCount?: number;
}
export const HostDidChangeEditorVisibleRangesNotificationType = new NotificationType<
	HostDidChangeEditorVisibleRangesNotification,
	void
>(`${IpcRoutes.Webview}/editor/didChangeVisibleRanges`);

export interface HostDidChangeFocusNotification {
	focused: boolean;
}
export const HostDidChangeFocusNotificationType = new NotificationType<
	HostDidChangeFocusNotification,
	void
>(`${IpcRoutes.Webview}/focus/didChange`);

export interface HostDidLogoutNotification {}
export const HostDidLogoutNotificationType = new NotificationType<HostDidLogoutNotification, void>(
	`${IpcRoutes.Webview}/didLogout`
);
