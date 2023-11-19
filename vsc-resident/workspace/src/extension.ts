import * as vscode from 'vscode';
import * as child from 'child_process';
import {
	TypedMessage, RegisterFileRequest, UnregisterFileRequest, SearchCodeRequest, SearchCodeResponse, SearchParams,
	GetFileExtractsRequest, GetFileExtractsResponse, FilePositionsData, DirectoryEntry, FileEntry, IpcMessage, IpcRequest, IpcProtocols
} from 'shared/search-protocol';
import {IpcMessageSet, WorkspaceActivationRequest, WorkspaceActivationResponse} from 'shared/extension-protocol';
import * as ndjson from 'ndjson';
import { request } from 'http';

class SearchEngine {
	constructor(private readonly extensionUri : vscode.Uri) { }

	public onMessageReceived?: (msg: IpcMessage) => void;

	private proc? : child.ChildProcess;
	private requestId: number = 0;

	public start() {
		const jsonBridgePath = vscode.Uri.joinPath(this.extensionUri, 'engine', 'JsonBridge.exe');
		const proc = child.spawn(jsonBridgePath.fsPath, [], {
			windowsHide: true
		});
		this.proc = proc;
		proc.on('error', (err) => {
			vscode.window.showErrorMessage("Search engine failed: "+err);
		});
		proc.stdout.pipe(ndjson.parse()).on('data', (msg: IpcMessage) => {
			if(this.onMessageReceived) { this.onMessageReceived(msg); };
		});
		proc.stderr.pipe(process.stderr);
	}

	public sendMessage(msg: IpcMessage) {
		this.proc?.stdin?.write(JSON.stringify(msg)+"\n");
	};

	public dispose()
	{
		this.proc?.kill();
		this.proc = undefined;
	}
}

class RoutedMessageHandlerContext
{
	private responses: IpcMessageSet;
	promise!: Promise<IpcMessageSet>;
	private resolve():void;
	private reject():void;
	constructor(private readonly baseRequestId: number, private readonly requestCount: number){
		this.responses = new IpcMessageSet;
		this.responses.messages = new Array(requestCount).fill(null);
		this.promise = new Promise((resolve, reject)=>{
			this.resolve = ()=>{resolve(this.responses);};
			this.reject = reject;
		});
	}

	setResponse(response: IpcMessage)
	{
		this.responses.messages[response.RequestId - this.baseRequestId] = response;
		if(this.responses.messages.every((msg) => msg !== null))
		{
			this.resolve();
		}
	}
}

class Extension
{
	routedMessageHandlers: {[id:number]:RoutedMessageHandlerContext} = {};

	activate(context: vscode.ExtensionContext)
	{
		let searchEngine : SearchEngine;
	
		let uiCommandId = "";
		const messageHandlerId = 'vsc-resident-workspace.onMessageReceived';
		context.subscriptions.push(vscode.commands.registerCommand(messageHandlerId, async (msgSet: IpcMessageSet) => {
			for (const msg of msgSet.messages) {
				searchEngine?.sendMessage(msg);
			}
		}));
	
		const routedMessageHandlerId = 'vsc-resident-workspace.onRoutedMessageReceived';
		context.subscriptions.push(vscode.commands.registerCommand(routedMessageHandlerId, (msgSet: IpcMessageSet) : Promise<IpcMessageSet> => {
			if(msgSet.messages.length === 0)
			{
				return Promise.resolve(new IpcMessageSet);
			}

			let ctx = new RoutedMessageHandlerContext(msgSet.messages[0].RequestId, msgSet.messages.length);
			for (const msg of msgSet.messages) {
				this.routedMessageHandlers[msg.RequestId] = ctx;
				searchEngine?.sendMessage(msg);
			}
			return ctx.promise;
		}));

		context.subscriptions.push(vscode.commands.registerCommand('vsc-resident-workspace.activate', (req: WorkspaceActivationRequest) => {
			uiCommandId = req.uiCommandId;

			if(searchEngine)
			{
				searchEngine.dispose();
				context.subscriptions.splice(context.subscriptions.indexOf(searchEngine));
			}

			searchEngine = new SearchEngine(context.extensionUri);
			context.subscriptions.push(searchEngine);
		
			searchEngine.start();
			
			searchEngine.onMessageReceived = m => {
				const routedMessageCtx = this.routedMessageHandlers[m.RequestId];
				if(routedMessageCtx)
				{
					routedMessageCtx.setResponse(m);
					delete this.routedMessageHandlers[m.RequestId];
				}
				else
				{
					const msgSet = new IpcMessageSet;
					msgSet.messages.push(m);
					vscode.commands.executeCommand(uiCommandId, msgSet);
				}
			};
	
			const response = new WorkspaceActivationResponse;
			response.messageCommandId = messageHandlerId;
			response.routedMessageCommandId = routedMessageHandlerId;
			return response;
		}));
	}
}

export function activate(context: vscode.ExtensionContext) {
	const extension = new Extension();
	extension.activate(context);
}

export function deactivate() {}
