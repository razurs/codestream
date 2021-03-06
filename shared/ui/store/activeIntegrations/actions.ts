import { action } from "../common";
import { ActiveIntegrationsActionType, ActiveIntegrationData } from "./types";

export { reset } from "../actions";

export function updateForProvider<T extends ActiveIntegrationData>(
	providerId: string,
	data: Partial<T>
) {
	return action(ActiveIntegrationsActionType.UpdateForProvider, { providerId, data });
}

export function deleteForProvider(providerId: string, providerTeamId?: string) {
	return action(ActiveIntegrationsActionType.DeleteForProvider, { providerId, providerTeamId });
}
