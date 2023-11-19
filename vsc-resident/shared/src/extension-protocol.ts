import { IpcMessage } from "./search-protocol"

export interface ExtensionMessage {}

export class WorkspaceActivationRequest implements ExtensionMessage {
    /**
     * Command to be invoked from the workspace to communicate with the UI
     */
    uiCommandId: string = ""
}

export class WorkspaceActivationResponse implements ExtensionMessage {
    /**
     * Command to be invoked from the UI to communicate with the workspace
     */
    messageCommandId: string = ""
    routedMessageCommandId: string = ""
}

export class IpcMessageSet implements ExtensionMessage {
    messages: IpcMessage[] = []
}
